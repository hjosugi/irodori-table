# Data verification & super-fast diff

Design for a cross-engine **data verification** and **fast data-diff** capability:
prove two tables (possibly on different engines/versions) hold the same data,
and when they don't, show *where* — fast, and legibly.

Status: **design** (greenfield). Nothing here is built yet. The goal is to land
the boundaries before code so it can grow into its own crate (and, per the
"repo分けてもいい" call, eventually its own repo) without churning the desktop app.

## Why this is its own thing

This is not "schema diff" (that already exists — `irodori-sql/src/schema.rs`
`diff_schemas()`), and it's more than "generate migration SQL" (that also exists
— `irodori-sql/src/migration.rs`). Those two stop at *generating SQL*. Nothing in
the codebase **executes** a comparison and **reconciles** results. That execution
+ reconciliation + presentation layer is the new capability.

Driving use cases (from the field): migrating PG↔Oracle↔Snowflake↔Hive↔MySQL,
verifying a version upgrade didn't drift data, and the daily "did my `DELETE`
land exactly the rows I meant" check. Hive/Snowflake extraction + compare is
named as the genuinely painful part, so the design optimizes for **heterogeneous
sources** and **large tables** first.

## What already exists (reuse, don't reinvent)

| Capability | Where | Reuse as |
| --- | --- | --- |
| Cross-engine row-hash SQL (Oracle `STANDARD_HASH`, MySQL/Snowflake `SHA2`, Trino `MD5(TO_UTF8)`, PG/Hive/Duck `MD5`) | `irodori-sql/src/migration.rs` `row_hash_expression()` (≈308–333) | the **fingerprint primitive** — make it `pub` |
| Cross-engine value normalization (CAST→text, NULL token, whitespace/case) | `migration.rs` `normalized_column_value()` (≈696–720) | the **canonicalization primitive** — make it `pub`, extend for the gaps below |
| Keyed FULL OUTER JOIN diff SQL (+ MySQL anti-join emulation) | `migration.rs` `keyed_diff_sql()` (≈415–525) | the **same-engine fast path** |
| Dialect quoting/placeholders | `irodori-sql/src/dialect.rs` `trait SqlDialect` | identifier/literal rendering |
| Info-schema metamodel (keys, columns) | `irodori-sql/src/metamodel.rs` | auto-pick key/compare columns |
| Bounded streaming + cancellation | `src-tauri/src/db/stream.rs` `StreamCtx` | pull manifests without OOM |
| Disk spill to temp SQLite + windowed paging | `src-tauri/src/db/spill.rs` `ResultStore` | hold million-row manifests off-heap |
| Headless read-only API + audit + guard | `crates/irodori-server/src/server.rs` `ApiServer::dispatch` | expose `/v1/diff` |
| Cell value type | `src-tauri/src/db/query.rs` `Cells = Vec<serde_json::Value>` | the comparison unit |

The first two rows are the crux: the **hard cross-engine SQL already works** and
is tested in `migration.rs`. We lift those into reusable primitives instead of
re-deriving per-engine hashing.

## Strategy: three tiers, cheapest first

Comparing whole tables row-by-row over the wire is the naive (slow) approach. The
design is a **hierarchy that exits as early as possible** — most "are these
equal?" questions resolve without moving the data.

```
Tier 0  COUNT + table fingerprint   →  O(1) network, answers "equal?" for the common case
Tier 1  chunked fingerprints        →  O(chunks), localizes mismatch to key-ranges
Tier 2  keyed row reconciliation     →  O(mismatching rows), exact row/cell diff
```

### Tier 0 — table fingerprint (fast equality)

Push down, per source, one query:

```sql
select count(*)                              as row_count,
       <agg-of-row-hash>                      as table_fingerprint
from <table> where <partition_predicate>;
```

`table_fingerprint` is an **order-independent** aggregate of per-row hashes
(e.g. `SUM`/`BIT_XOR` over the numeric form of `row_hash_expression`, or
`MD5(STRING_AGG(row_hash ORDER BY key))` where cheap). Order-independence matters
because heterogeneous engines won't return rows in the same order. If both
`row_count` and `table_fingerprint` match → **tables are equal, zero rows moved.**
This is the 90% path for "did the upgrade drift?" checks.

### Tier 1 — chunked fingerprints (localize)

When Tier 0 differs, split the key space into N **deterministic buckets** and
fingerprint each bucket independently (one grouped query per side):

```sql
select <bucket_expr> as bucket,
       count(*)       as n,
       <agg-row-hash> as fp
from <table> where <partition_predicate>
group by <bucket_expr>;
```

`<bucket_expr>` is a stable hash-mod of the key (e.g. `abs(hashtext(key)) % :N`,
engine-mapped). Compare the two small bucket tables locally; only buckets whose
`(n, fp)` differ proceed to Tier 2. This is a **Merkle-style** localization: a
handful of differing rows in a billion-row table surfaces a handful of differing
buckets, and we only pull those. Recursable (sub-bucket) for very large tables.

### Tier 2 — keyed reconciliation (exact diff)

For each differing bucket, pull **only that key-range's** `(key, row_hash)`
manifest from each side, sorted by key, and do a streaming **sorted-merge**:

- key in source only → `SOURCE_ONLY` (deleted/missing)
- key in target only → `TARGET_ONLY` (inserted/extra)
- key in both, hash differs → `CHANGED` → pull full rows for those keys and
  produce **cell-level** diffs (which columns, old vs new value)

Manifests stream through `StreamCtx` and overflow to `ResultStore` spill, so the
merge is bounded memory even for large differing sets. Same-engine pairs can
short-circuit Tier 2 into the existing `keyed_diff_sql()` FULL OUTER JOIN
(single round trip) instead of pulling manifests.

### Sampling mode

For "good enough" confidence on huge tables: run Tier 0 plus Tier 1 on a random
**sample of buckets** (`bucket in (:subset)`), report a confidence/coverage
figure. Useful for spot-checks during a long migration.

## Cross-engine correctness (the hard part)

`normalized_column_value()` already handles CAST-to-text, NULL token, and
whitespace/case. The diff layer must extend canonicalization for the gaps
`migration.rs` currently only *warns* about (≈791–835), because they cause false
diffs across engines:

- **Numbers**: normalize scale/precision (Oracle `NUMBER` ↔ Snowflake `NUMERIC`
  ↔ PG `numeric`) to a canonical decimal string; strip trailing zeros.
- **Timestamps / timezones**: canonicalize to UTC ISO-8601 with fixed precision;
  decide TZ-naive policy explicitly.
- **Floats**: round to a configured epsilon before hashing (binary float equality
  is a trap across engines).
- **Booleans / bit**: canonical `0`/`1`.
- **Oracle empty string = NULL**: fold to the same NULL token as real NULLs.
- **Strings**: collation/charset + Unicode normalization (NFC); optional case.
- **Bytes/UUID**: canonical lowercase hex, no dashes.

Each rule is opt-in per column via a `ColumnCanon` policy so the user controls
intent (a genuine type change *should* diff). All of this stays **push-down**
(rendered into the hash SQL) so it runs in the database, not the client.

## Crate design — `irodori-diff`

New workspace crate `crates/irodori-diff`. Pure logic + SQL generation; **no DB
driver** (engine-agnostic, like `irodori-sql`). It depends on `irodori-sql`
(dialect, migration primitives, metamodel) and `serde_json` (cell values), and is
driven by an executor the host supplies.

```rust
// What to compare.
pub struct DiffSpec {
    pub source: TableRef,            // engine + qualified name
    pub target: TableRef,
    pub key_columns: Vec<String>,    // auto-filled from metamodel PK if empty
    pub compare_columns: Vec<String>,// default: all non-key columns
    pub partition_predicate: Option<String>,
    pub canon: ColumnCanonMap,       // per-column normalization policy
    pub bucket_count: u32,
    pub mode: DiffMode,              // Full | Sampled { buckets } | CountOnly
}

// The crate emits SQL; the host runs it (Tauri/db or server/Registry).
pub trait SqlExecutor {
    async fn run(&self, engine: DbEngine, sql: &str) -> Result<RowSet>; // RowSet = (cols, rows, truncated)
}

// Tiered API — each returns the plan to run next, or a verdict.
pub fn fingerprint_sql(spec: &DiffSpec, side: Side) -> String;          // Tier 0
pub fn bucket_fingerprint_sql(spec: &DiffSpec, side: Side) -> String;   // Tier 1
pub fn manifest_sql(spec: &DiffSpec, side: Side, buckets: &[u32]) -> String; // Tier 2
pub fn reconcile(source: RowStream, target: RowStream) -> DiffStream;   // sorted-merge

// Orchestrator that walks Tier 0→1→2 using an executor, short-circuiting early.
pub async fn diff_tables(exec: &dyn SqlExecutor, spec: &DiffSpec) -> Result<DiffReport>;

pub struct DiffReport {
    pub equal: bool,
    pub source_count: u64,
    pub target_count: u64,
    pub fingerprint_match: bool,
    pub changed: Vec<RowMismatch>,   // bounded / streamed for big diffs
    pub coverage: Coverage,          // full vs sampled
}
pub struct RowMismatch {
    pub key: Vec<serde_json::Value>,
    pub kind: MismatchKind,          // SourceOnly | TargetOnly | Changed
    pub cells: Vec<CellDiff>,        // for Changed: column, source, target
}
```

Hashing stays **push-down by default** (no vendored crypto). If/when we want
in-process hashing for engines lacking good hash functions, add `blake3` (fast,
non-crypto-strength is fine here) behind a feature — but push-down is the
default because it avoids moving raw data.

## Integration seams

1. **Migration Studio** gains a **"Verify"** step after "Diff": it runs
   `diff_tables` against the live source/target connections and renders the report
   (today the panel only *shows generated SQL*). The TS side gets typed bindings
   via the existing typegen path; the diff crate's request/response types are the
   contract.
2. **Tauri command** `data_diff(spec) -> DiffReport` in `src-tauri/src/db/`,
   backed by an `SqlExecutor` that uses the existing connection pool + `StreamCtx`
   + `ResultStore` for manifests.
3. **Headless API**: `POST /v1/diff` on `irodori-server` (`ApiServer::dispatch`),
   reusing the `Registry` to reach both sources, the read-only `guard`, and the
   audit log. Returns `DiffReport` JSON. Enables CI/automation ("fail the
   migration job if `equal == false`").

## UI — make the diff legible

The complaint is "diffがわかりにくい". Presentation tiers mirror the algorithm:

- **Summary**: equal/not, counts per side, % rows changed, fingerprint match,
  coverage (full vs sampled), elapsed.
- **Bucket heatmap**: key-space buckets colored by mismatch density — drill into
  a hot bucket.
- **Row list**: `SOURCE_ONLY` / `TARGET_ONLY` / `CHANGED`, keyed, virtualized
  (reuse the result-grid virtualization).
- **Cell diff**: for a `CHANGED` row, side-by-side with only the differing cells
  highlighted (red/green), values rendered with the same formatter as the grid.
- **Export**: the diff as SQL (reconciliation `UPDATE`/`INSERT`/`DELETE` to make
  target match source) or as a report.

## Performance notes

- Tiers 0/1 are **O(1)/O(buckets)** network — the whole point is to *not* pull
  rows to answer equality.
- Bucket queries across both sides run **in parallel** (independent connections).
- Tier 2 pulls only differing key-ranges; manifests are `(key, hash)` only
  (narrow), full rows fetched solely for `CHANGED` keys.
- Everything is cancellable (reuse the query cancel token) and memory-bounded
  (spill), so a diff on a billion-row table can't OOM or hang the app.

## Phased plan

1. **Primitives**: make `row_hash_expression`, `normalized_column_value`,
   `keyed_diff_sql` `pub` in `irodori-sql`; add the canonicalization extensions
   (numeric/timestamp/float/oracle-empty). Unit-test SQL rendering per engine.
2. **Crate skeleton**: `crates/irodori-diff` with `DiffSpec`/`DiffReport`,
   `fingerprint_sql`/`bucket_fingerprint_sql` (Tier 0/1) + `SqlExecutor` trait.
   Tests with a SQLite executor on synthetic data.
3. **Tier 2 reconcile**: streaming sorted-merge + cell diff; same-engine
   fast-path via `keyed_diff_sql`.
4. **Tauri command + Verify panel** (single live source↔target).
5. **Headless `/v1/diff`** + a CLI verb for CI.
6. **Sampling mode + bucket heatmap UI**; cross-engine canonicalization hardening
   driven by real PG/Oracle/Snowflake/Hive cases.

## Repo boundary

Start as `crates/irodori-diff` inside this workspace (fast iteration, shares
`irodori-sql`). Promote to its own repo (`hjosugi/irodori-diff`, consumed by tag
like `irodori-sql`) once the `DiffSpec`/`DiffReport`/`SqlExecutor` contract is
stable and there's an independent release/test boundary — matching the project's
"earn the crate boundary by real implementation" rule (ROADMAP, Non-Negotiables).
