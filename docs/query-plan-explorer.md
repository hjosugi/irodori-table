# Query plan explorer

Design for a cross-engine **execution-plan viewer + analyzer**: capture a query's
`EXPLAIN`, normalize it, **visualize** it legibly, **analyze** it for problems,
and **explain it in plain language** — including teaching *how to read the
metrics*. AI narration is optional; the deterministic explanation always works.

Status: **design** (greenfield — no plan handling exists today beyond
`explain analyze` appearing in completion keywords).

## Goals (from the ask)

- 実行計画を見る + 分析する — capture and analyze the plan.
- 自然言語で説明 — narrate what the plan does and why it's slow.
- 指標の味方・解説 — teach how to *read* each metric (cost, rows, loops, time…).
- 視覚的に見やすく — a flame/tree view where the hot path pops.
- 全データベース対応 — one normalized model across PG/MySQL/Oracle/SQL Server/
  SQLite/Snowflake/Hive/Trino/DuckDB…

## The core problem: every engine's EXPLAIN is different

There is no portable plan format. The design's spine is a **per-engine capture +
parser** that lowers each native format into one **normalized plan IR**, after
which visualization, analysis, and explanation are engine-agnostic.

| Engine | Capture | Native shape |
| --- | --- | --- |
| PostgreSQL (+ CRDB/Yugabyte/Timescale/Neon) | `EXPLAIN (FORMAT JSON[, ANALYZE, BUFFERS, VERBOSE]) <q>` | JSON tree, est+actual |
| MySQL / MariaDB / TiDB | `EXPLAIN FORMAT=JSON <q>` · `EXPLAIN ANALYZE <q>` (8.0.18+) | JSON / tree text |
| SQL Server | `SET SHOWPLAN_XML ON` / `SET STATISTICS XML ON` | XML showplan |
| Oracle | `EXPLAIN PLAN FOR <q>` + `DBMS_XPLAN.DISPLAY`, or `/*+ GATHER_PLAN_STATISTICS */` + `DBMS_XPLAN.DISPLAY_CURSOR` | row table / cursor stats |
| SQLite | `EXPLAIN QUERY PLAN <q>` | simplified tree |
| Snowflake | `EXPLAIN USING JSON <q>`; profile via `GET_QUERY_OPERATOR_STATS()` | JSON / operator stats |
| Trino / Presto / Hive | `EXPLAIN (FORMAT JSON) <q>` · `EXPLAIN ANALYZE` | JSON / text |
| DuckDB | `EXPLAIN [ANALYZE] <q>` (json) | JSON tree |

Each engine gets a `PlanProvider` that knows (a) the EXPLAIN SQL to issue and
(b) how to parse its output into the IR. This reuses `irodori-sql`'s
`trait SqlDialect` for identifier rendering and lives next to the existing
dialect/metamodel code.

## Normalized plan IR

```rust
pub struct QueryPlan {
    pub engine: DbEngine,
    pub analyzed: bool,            // EXPLAIN ANALYZE (actuals) vs estimate-only
    pub root: PlanNode,
    pub totals: PlanTotals,        // total cost, total actual time, planning/exec ms
    pub warnings: Vec<String>,     // capture caveats (e.g. "estimates only")
}

pub struct PlanNode {
    pub op: PlanOp,                // canonical operator (below)
    pub label: String,            // engine's raw node name, preserved
    pub relation: Option<String>, // table/index/CTE touched
    pub est: NodeEstimate,        // rows, cost (start/total), width
    pub actual: Option<NodeActual>, // rows, loops, time_ms, returned (ANALYZE only)
    pub io: Option<NodeIo>,       // buffers/blocks read, spill bytes, network
    pub detail: Vec<(String, String)>, // condition, filter, sort key, join type…
    pub children: Vec<PlanNode>,
}

pub enum PlanOp {                  // engine names mapped to one vocabulary
    TableScan, IndexScan, IndexOnlyScan, BitmapScan,
    NestedLoop, HashJoin, MergeJoin,
    Aggregate, GroupAggregate, HashAggregate, WindowAgg,
    Sort, IncrementalSort, Limit, Materialize, Memoize,
    Gather, Exchange, Subquery, CteScan, Result, ModifyTable, Other(String),
}
```

The IR carries **both** the engine's raw label *and* the canonical `PlanOp`, so
visualization stays uniform while node cards can still show native terminology.

## Analysis — deterministic heuristics first

A rule pass over the IR produces `Finding { severity, node_path, title,
explanation, suggestion }`. These are **engine-aware but deterministic** (no AI),
so analysis is reliable and offline. Starter rules:

- **Full scan of a large relation** where a predicate could be indexed → suggest
  index on the filter/join column.
- **Estimate vs actual skew** (`actual_rows / est_rows` far from 1, ANALYZE only)
  → planner mis-estimate; suggest `ANALYZE`/stats refresh; explains *why* the plan
  shape may be wrong.
- **Hot subtree**: node(s) accounting for the majority of total time/cost →
  "spend your effort here."
- **Sort/hash spilled to disk** (buffers/spill bytes) → raise work_mem / add
  index to avoid the sort.
- **Nested loop over a large outer/inner** → likely should be hash/merge join.
- **Row explosion across a join** (output ≫ inputs) → missing/incorrect join key.
- **Redundant materialize/sort**, **non-sargable predicate** (function on indexed
  column), **`SELECT *` width blowup**.

Each finding maps to a node so the UI can highlight it on the tree.

## Natural-language explanation — two layers

1. **Deterministic narrative (always on, offline).** Template the IR + findings
   into prose: *"This query scans `orders` sequentially (1.2M rows, ~78% of total
   time) because no index covers `status`, then hash-joins to `customers`. The
   planner expected 200 rows but got 48,000 — stale statistics. Biggest win: an
   index on `orders(status)`."* This is the baseline and never depends on a model.
2. **AI narration (opt-in).** Feed the normalized plan + findings to a
   `GrammarModel` provider (the existing `irodori-generate` stack:
   `LlamaSqlModel` embedded, `OllamaModel`/`OpenAiCompatModel` over HTTP,
   `CommandModel` via CLI) using **unconstrained** decoding for fluent prose and
   a tutoring "how would you fix this?" voice. Per the roadmap, AI is optional and
   audited — the deterministic narrative stands alone; AI only enriches it.

The IR (not raw EXPLAIN text) is what's fed to the model, so the prompt is small,
engine-neutral, and consistent across providers.

## Metric glossary — "指標の味方・解説"

A small, structured glossary keyed by `(engine, metric)` powers inline tooltips
and a "how to read this plan" panel:

- **cost** (PG): arbitrary units, `startup..total`; only comparable within one
  plan, not across engines.
- **rows**: estimate (and, with ANALYZE, actual); the est/actual *ratio* is the
  signal, not the absolute.
- **loops** (PG nested loop): a node's time is `actual_time × loops`.
- **actual time**: `startup..total` ms *per loop*.
- **buffers / blocks** (PG `BUFFERS`): cache vs disk reads — IO pressure.
- **width**: bytes per row — wide rows = more memory/IO.
- SQL Server cost %, MySQL `filtered`/`rows`, Oracle `Cardinality`/`Bytes`, etc.

This directly serves "指標の味方" — the user learns *what each number means and how
to act on it*, inline where the number appears.

## Visualization — make the hot path pop

A new **`ResultMode = "plan"`**, rendered in the result area alongside
`grid`/`chart`/`graph`/`webgl`/`structure` (`features/results/components/
ResultBody.tsx` dispatches on `resultMode`). A `features/query-plan/` view with:

- **Tree / flame view**: collapsible operator tree; each node sized/heat-colored
  by its share of total time (or cost when estimate-only) so the expensive
  subtree is obvious at a glance.
- **Node card**: canonical op + raw label, relation, **est vs actual rows** with a
  skew badge, time/cost %, IO/spill, and the condition/filter/sort detail.
- **Findings rail**: the heuristic findings, each clicking-through to highlight its
  node; severity-colored.
- **Explanation panel**: the deterministic narrative, with an optional "Explain
  with AI" button (only if a provider is configured) and the glossary tooltips.
- **Estimate ⇄ Actual toggle**: estimate (plain `EXPLAIN`, safe) vs actual
  (`EXPLAIN ANALYZE`, runs the query — see safety).

## Safety — `EXPLAIN ANALYZE` executes the query

Plain `EXPLAIN` is read-only and always safe. `EXPLAIN ANALYZE` **runs** the
statement — dangerous for DML. Rules:

- Classify the statement with the existing read-only guard
  (`crates/irodori-server` `guard::classify`, already used for the headless API).
- Offer ANALYZE freely for read-only queries.
- For writes: either refuse ANALYZE, or wrap in a transaction the engine can roll
  back (`BEGIN; EXPLAIN ANALYZE …; ROLLBACK;` on PG) with a loud confirm. Never
  silently execute a DML to profile it.

## Where the code lives

- **`irodori-plan` (new, engine-agnostic).** The IR, per-engine EXPLAIN SQL +
  parsers, the heuristic rules, and the deterministic narrative + glossary.
  Depends on `irodori-sql` (dialect) only; no DB driver. Start as
  `crates/irodori-plan`, promote to its own repo once the IR is stable (same
  "earn the boundary" rule as `irodori-sql`/`irodori-diff`).
- **Capture command.** Tauri `explain_query(connection, sql, { analyze }) ->
  QueryPlan` in `src-tauri/src/db/` — issues the engine's EXPLAIN via the existing
  pool and hands the output to `irodori-plan`. Headless: `POST /v1/explain`.
- **AI narration.** Reuse `irodori-generate` providers via a thin free-text
  `explain_plan(plan, provider)` path (sibling to `ai_generate_sql`), opt-in.
- **UI.** `features/query-plan/` (tree/flame view, node cards, findings rail,
  explanation + glossary), wired as `ResultMode = "plan"`; a "Explain plan"
  action/keybinding next to Run.

## Phased plan

1. **IR + PostgreSQL provider** (richest JSON, est+actual+buffers) end-to-end:
   capture → IR → tree view → 3–4 heuristics → deterministic narrative + glossary.
   This proves the whole pipe on one engine.
2. **More providers**: SQLite (`EXPLAIN QUERY PLAN`), MySQL JSON, DuckDB — fast
   wins; then SQL Server XML, Oracle DBMS_XPLAN, Snowflake/Trino.
3. **Flame heat view + findings rail polish**; estimate⇄actual toggle + ANALYZE
   safety guard.
4. **AI narration** behind the existing provider config (opt-in), feeding the IR.
5. **Headless `/v1/explain`** + a CLI verb for plan capture in automation.

## Relationship to the data-diff design

Both new capabilities are **engine-agnostic analysis crates** over the same seams
(dialect, the db read path, the headless API, optional AI providers). `irodori-diff`
([data-verification-diff.md](data-verification-diff.md)) and `irodori-plan` share
the pattern: lower heterogeneous engines into one IR, then analyze/present
uniformly. Worth keeping their crate conventions aligned.
