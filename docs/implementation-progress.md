# Implementation Progress

Last updated: 2026-06-27 JST. A status snapshot of what is built and verified —
focused on the database engine layer. Pairs with `ROADMAP.md` (themes) and
`docs/implementation-backlog.md` (tickets). Production release gates are tracked
in `docs/production-readiness.md`.

## Database engine layer — built & verified

Architecture (SRC-001a): a `Connection` trait + a single `connect_engine`
connector/registry, with per-engine modules under
`apps/desktop/src-tauri/src/db/` (`engine`, `postgres`, `mysql`, `sqlite`,
`mssql`, `oracle`, `mongo`, `duck`). Adding a wire-compatible engine is a
`DbEngine` variant; a new wire is one `Connection` impl + one connector arm.

| Engine | Driver | Status | Verified against |
|---|---|---|---|
| PostgreSQL | sqlx `PgPool` | ✅ | real PostgreSQL 16 |
| MySQL | sqlx `MySqlPool` | ✅ | real MySQL 8.4 |
| MariaDB | sqlx (mysql wire) | ✅ | real MariaDB 11 |
| CockroachDB | sqlx (pg wire) | ✅ | real CockroachDB v26 |
| TimescaleDB | sqlx (pg wire) | ✅ wire | compose ready |
| YugabyteDB | sqlx (pg wire) | ✅ wire | compose ready |
| TiDB | sqlx (mysql wire) | ✅ wire | compose ready |
| SQL Server | `tiberius` (TDS, pure Rust) | ✅ | real SQL Server 2022 |
| DuckDB | embedded libduckdb (`--features duckdb`) | ✅ | in-memory v1.5.4 |
| MongoDB | `mongodb` (document store) | ✅ | real MongoDB 7.0 |
| Oracle | `oracle-rs` (pure-Rust thin TNS) | ✅ | real Oracle 23ai/26ai Free |
| SQLite | sqlx `SqlitePool` | ✅ | unit round-trip |
| ClickHouse | pure-Rust HTTP REST | ✅ | real ClickHouse 24.3 (HTTP) |
| Snowflake | pure-Rust HTTP REST (MFA/JWT/OAuth/Token) | ✅ | Snowflake SQL API |
| BigQuery | pure-Rust HTTP REST (GCP Service Account JWT) | ✅ | Google Cloud BigQuery API |
| Redis | `redis` (pure-Rust client) | ✅ | real Redis 7.2 |
| Cassandra | `scylla` (pure-Rust client) | ✅ | real Cassandra 4.0 / ScyllaDB |
| Redshift | sqlx (pg wire) | wire-compatible | AWS-only (no local container) |

Every engine has a test in `tests/integration_db.rs` (or a unit test); run any
container-backed engine with `make db-verify DB=<engine>` or the normal set with
`make db-all`.

Highlights:
- **No vendor client needed for Oracle or SQL Server** — pure-Rust thin TNS
  (`oracle-rs`) and TDS (`tiberius`). Oracle works the way A5:SQL Mk-2's "direct
  connection" mode does, with **no Instant Client**.
- **MongoDB (a document store) joins through the same `Connection` trait** — proof
  the abstraction extends beyond SQL. Documents project to a table by the ordered
  union of top-level keys.

## Key properties

- **Native per-engine type decoding** (not sqlx's `Any` driver): `DECIMAL/NUMERIC`
  → string (precision-safe), timestamps → RFC3339/string, `JSON/JSONB` → object,
  `UUID` → string, binary → hex, null preserved. This follows the Beekeeper/DBeaver
  value-handler lesson (bind decimals exactly; never round-trip through `double`).
  **SQL Server (tiberius)** now decodes off the raw `ColumnData` to match: exact
  numerics render scale-preserving (`100, scale 2 → "1.00"`), datetime/date/time/
  datetimeoffset via chrono (ISO 8601 / RFC3339), binary as `\x` hex, UUID/XML as
  string — no more lossy `f64`/`null` fallbacks.
- **Per-query timeout + explicit cancel**: `db_run_query` takes an optional
  `timeoutMs` (bounded by `tokio::time::timeout` → clean `query timed out after Nms`)
  and an optional `queryId`. The `queryId` registers a `tokio_util`
  `CancellationToken` in `DbState`, so the new `db_cancel(queryId)` command — wired
  to the desktop Cancel button — stops a specific in-flight run (`query cancelled`).
  A timeout or a cancel both drop the query future, which cancels the in-flight
  request on the pooled (sqlx) engines. `None`/`0` timeout keeps the
  run-to-completion default. Covered by `with_timeout` and `cancel_query_impl`
  unit tests.
- **Incremental result streaming**: `db_run_query_stream` streams a query as
  `columns → batched rows → done|error` over a Tauri `Channel`, so the grid fills
  as rows arrive instead of after the whole (capped) page. `stream.rs` gained a
  `StreamCtx`/`stream_capped` twin of `collect_capped`; the sqlx trio + SQL Server
  override `Connection::stream_query` for true row-by-row delivery and check the
  cancel token each row (cooperative server-side cancel even for non-pooled
  tiberius). Oracle/Mongo/DuckDB fall back to the default `stream_query`
  (buffer → one batch). Verified with in-memory SQLite unit tests; the desktop UI
  consumes it via `runQueryStream` (`src/db-stream.ts`).
- **Virtualized result grid (rows + wide columns)**: the grid renders only the rows
  in (and `GRID_OVERSCAN` around) the viewport with top/bottom spacer pads, so a
  capped 10k-row page is ~30 DOM rows instead of 10k and streamed results stay
  smooth (fixed 27px row height, viewport via `ResizeObserver`, scroll coalesced
  with `requestAnimationFrame`, scroll resets to top per run). Wide results also
  render only the visible column window plus horizontal overscan, with left/right
  spacer columns preserving scroll width. Playwright covers a 1,000-row x
  2,000-column synthetic result and asserts the DOM cell budget during horizontal
  scroll. `EXEC-004B` now adds a lazy 1,000,000-row x 128-column Playwright
  benchmark that scrolls top/middle/bottom/rapid positions, keeps rendered
  rows/cells bounded, and records dropped-frame proxy thresholds. The remaining
  PERF gate is `PERF-001`'s renderer-path spike.
- **Bounded memory**: every engine streams rows and caps at `max_rows` (default
  **10,000**) with a `truncated` flag, so a `select *` over a 10M-row table stays
  light instead of exhausting RAM (the TablePlus problem). Verified: a 10M-row seed,
  full scan returns the 10k page in ~77 ms.
- **Optional disk offload (EXEC-010)**: with offload on, a result larger than the
  in-memory budget is no longer capped — it is retained behind a temp-SQLite
  `ResultStore` (`db/spill.rs`) that keeps only the budget resident in RAM and spills
  the rest to disk, so resident memory stays flat regardless of total size. The
  desktop grid pages rows back through `db_result_window` behind an LRU-bounded
  windowed source (`result-window.ts`), so both the Rust heap and the JS heap stay
  flat while scrolling a result far larger than RAM. A settings toggle controls
  on/off and the resident-row budget. Verified by `db::spill` unit + `db_run_query_spill`
  integration tests, `result-window` vitest, and a Playwright spill-paging e2e.
- **Command-boundary hardening**: backend commands now reject empty connection IDs,
  empty SQL, oversized SQL text, `maxRows=0`, and result windows above the hard
  safety cap. Reconnecting the same profile ID replaces and closes the previous
  connection instead of silently leaking it.
- **Secret hygiene on connect errors**: connection errors are redacted for URL
  passwords and ADO-style `Password=` / `PWD=` segments before they cross the
  Tauri command boundary.
- **Trait + registry**: the closed `EnginePool` enum is gone; connections live behind
  `Arc<dyn Connection>` and dispatch with `conn.run_query()`, not a `match`.

## Network and security foundation — built

- **Transport schema**: `irodori-core::connection` now models direct/local-file
  transports plus SSH tunnels (agent, password secret, or private-key secret),
  SOCKS5 proxy routes, HTTP CONNECT proxy routes, and ordered multi-hop chains.
  Chain hops are named, validated for uniqueness, and keep credentials as
  `SecretRef` handles instead of inline material.
- **Proxy planning + diagnostics**: `irodori-proxy` builds typed `TransportPlan`
  stages for direct TCP, SSH, SOCKS5, HTTP CONNECT, TLS, auth, and local-file
  paths. `HopRegistry` resolves reusable named hops into concrete chains, and
  `ConnectionDiagnostics` records per-stage status, timing, messages, and the
  first failing stage. A direct TCP probe is implemented and unit-tested against a
  local listener; TLS handshakes and non-direct proxy/SSH handshakes remain driver
  integration work.
- **Per-connection secret handles**: `irodori-secure-store` now defines the
  `SecureStore` trait, stable per-connection secret handles (`password`, `token`,
  private key/passphrase, SSH password, proxy password), an in-memory test store,
  and an OS-keychain adapter using macOS `security` or Linux `secret-tool` when
  available. Unsupported platforms fail closed instead of writing plaintext.
- **Audit + privacy/redaction**: `irodori-core::security` now provides
  `AuditLog`, `AuditEvent`, privacy mode, redacted log export, and a shared
  redactor for URL credentials, password/token-style assignments, known secret
  material, and private-mode SQL string literals. Redaction-safe export behavior
  is covered by unit tests.

## Desktop UI wiring — built

- The workbench UI now uses the generated `dbConnect`, `dbRunQuery`, and
  `dbDisconnect` wrappers instead of staying purely mocked.
- The sidebar has a compact quick-connect form with the current `DbEngine` union and
  a URL/DSN field. Successful connections become active workspace connections and
  show measured connect latency.
- **Run Current** executes the editor text against the active open connection and
  now runs the selected SQL or the delimiter-aware statement at the cursor,
  replacing the sample grid with live columns/rows, elapsed time, capped-row
  status, and errors.
- Query history is now persisted locally per connection and records success/error,
  elapsed time, row counts, truncated status, and the SQL that ran. Clicking an
  item restores it into the editor.
- The shared long-running job foundation is in place in `irodori-core::jobs`:
  in-memory job tracking covers stable IDs, state transitions, progress,
  cancellation requests, structured logs, artifacts, errors, retry policy,
  concurrency limits, resource budget fields, and checkpoints. Desktop exposes
  generated `jobsList`/`jobsGet`/`jobsCancel` commands and a Settings → Jobs view;
  the local API crate reuses the same core DTOs.
- Result grids can be exported from the desktop UI as CSV, TSV, JSON, JSONL, SQL
  INSERT text, an Excel-compatible HTML workbook (`.xls`), and Markdown. These
  are current-result client-side serializers; native XLSX and streaming
  run-to-file export for huge results remain backlog work.
- The result grid now supports current-page multi-column sort, a quick row filter,
  and a client-side rule panel with AND/OR joins, text/comparison/null/empty/regex
  predicates over displayed cell values. Saved filters, a shared serializable
  filter model, and server-side/filter-plan SQL remain open.
- The CodeMirror editor now uses live object metadata for deterministic
  schema-aware completion. Unit tests cover schema/table/column/alias/join
  suggestions, and Playwright verifies that the editor popup receives table and
  alias-column suggestions after metadata is loaded from `dbListObjects`. Shared
  completion service/API parity for future hosts remains open.
- SQL hover inspection is live in the editor: table/view hovers show DDL or a
  generated definition, comments, columns, foreign keys, indexes, row estimates,
  and quick samples; column hovers show type/nullability/key/default/reference
  details and sample values. `F12` plus `Ctrl`/`Cmd` click jump from the SQL token
  to the metadata/object-browser target. Unit coverage exercises object and
  column inspection.
- The Git drawer graph is now a real workbench view rather than a detached
  experiment: commits can be searched by subject/hash/author/ref, filtered by
  branch/remote/tag refs, selected with mouse or `ArrowUp`/`ArrowDown`/`Home`/
  `End`, and inspected in a detail pane with refs, hash, author, date, and
  parents. Provider badges and per-repo accent colors are wired.
- Deterministic Query Magics are wired in the desktop run path: `\describe`
  expands to dialect-aware column-inspection SQL, `\explain` expands to visible
  explain SQL, `\erd` opens a filtered ERD, `\export <format>` exports the current
  result, and `\params <sql>` opens the parameter prompt flow. Unit tests cover
  parser/expansion, and Playwright covers `\explain` and `\erd`.
- The browser build still falls back to the mock shell when Tauri APIs are absent;
  real connect/query runs inside the Tauri shell.
- The object browser now calls generated `dbListObjects` and renders live
  schema → table/view/collection → columns/indexes metadata for PostgreSQL-wire,
  MySQL-wire, SQLite, SQL Server, Oracle, DuckDB, and MongoDB connections.
- The schema ERD modal renders deterministic SVG from live metadata with schema
  grouping, table/search filters, zoom/fit controls, Mermaid source, SVG/PNG
  downloads, SVG copy, and PNG clipboard copy where supported. Query-result graph
  views plus ERD export/UI smoke and visual-regression evidence remain open.
- The sidebar connection UI is now a real profile editor: saved profiles live in
  localStorage, password fields are session-only and are not persisted, profiles
  can be created/selected/saved/deleted, URL/DSN and structured host/port/user
  modes are both available, and Test/Connect/Disconnect are wired to the backend.
- Vim mode is wired through `@replit/codemirror-vim` behind a persisted header
  toggle; Playwright covers toggling, insert-mode editing, and a normal-mode delete
  flow. Deeper Vim behavior parity remains open.
- Linux AppImage v0.2.23 has been released; the desktop package/Tauri version and
  local Git tag are `0.2.23`/`v0.2.23`. Cross-platform installer/signing/update
  channel hardening remains tracked in the backlog.
- In-memory databases are first-class for local work: SQLite `:memory:` is wired
  through structured profiles and verified by a unit test; DuckDB `:memory:` is
  available when the `duckdb` feature is built.

## Batch jobs & local indexing — built

- **Job runtime (JOB-001)**: `irodori-core::jobs` provides the shared job model —
  stable IDs, status state machine, progress, structured logs, artifacts, retry
  policy, concurrency/resource budgets, cancellation, and resumable checkpoints —
  plus a `JobRuntime` and desktop jobs dashboard.
- **Huge local index builder (JOB-002)**: `irodori-knowledge::index` builds a
  disk-backed inverted index over an arbitrarily large corpus through the job
  runtime. Documents stream lazily from an iterator; a bounded in-memory postings
  buffer flushes to SQLite once it crosses `flush_postings`, so **peak RAM stays
  flat regardless of corpus size** (the same anti-OOM discipline EXEC-010 applies
  to result rows). The build reports progress, cancels cooperatively, and writes a
  checkpoint cursor so an interrupted run resumes from the last durable document;
  `INSERT OR IGNORE` keys make rebuilds/incremental runs idempotent. Verified by a
  50,000-document benchmark asserting the postings buffer never exceeds the flush
  budget while the index stays queryable, plus resume-after-cancel coverage. The
  flush path now uses `sqlx::QueryBuilder`, matching SQLx 0.9's dynamic-SQL audit
  model without hand-built placeholder strings.
- **Batch operation contract (JOB-004)**: `irodori-core::batch` is the shared
  envelope every heavy operation runs through — a `JobContext` (progress, cancel,
  resume cursor, checkpoint, log, artifact) plus `run_job(...)` that owns start and
  the single terminal transition (succeed / mark_cancelled / fail). Operations are
  plain async fns decoupled from the state machine, so progress/cancel/logs/
  artifacts/resume/headless are uniform. Two workflows are migrated onto it to
  prove it: the index builder (`build_index_with`) and tabular export
  (`irodori-io::export::run_export`, streaming any `TabularEncoder` with per-row
  progress, cooperative cancel, and an output artifact).

## Test & sample infrastructure

- **Per-DB compose**: `samples/<engine>/compose.yaml` (one file per engine), plus
  Oracle/MongoDB targets. `make db-verify DB=<engine>` does up -> test -> down.
- **Scale/perf seed**: `scripts/dev-db.sh seed postgres` generates `ROWS` (default
  10M) rows + `TABLES` (default 100) tables.
- **Syntax reference**: `docs/engine-syntax-reference.md` — connection + query syntax
  and dialect quirks for every engine.

## References studied (clean-room, license-aware)

- DBeaver (Apache-2.0, local `.irodori-local/ref/dbeaver-ce` — adaptable with attribution),
  Beekeeper (GPL — behavior only), Outerbase (AGPL — behavior), Zequel (Elastic
  License 2.0 — behavior), TablePlus / A5:SQL Mk-2 (behavior). Lessons (DatabaseClient
  trait + registry, wire⇄dialect split, precision-safe value handlers, lazy metadata,
  cancellation) are tracked in the backlog.

## Coordination

- **Claude ⇄ Codex split** is tracked in `docs/agent-coordination.md` (file ownership +
  message log). Editor-stack decision is `docs/adr/0001-editor-stack.md` (CodeMirror 6 +
  tree-sitter semantic layer + `sql-formatter`).
- **typeship** (Rust→TypeScript type bridge) is consumed from crates.io; the
  `export_typescript_bindings` test renders the desktop TS boundary through it.
  See `docs/type-bridge-handoff.md`.
- **irodori-sql** has been split into `hjosugi/irodori-sql` and released at
  `v0.2.23`; this workspace consumes it through a version-tagged Git dependency.
  The package now owns SQL dialects, parameter detection, metamodel helpers, and
  schema-diff/migration-preview primitives outside the desktop monorepo.

## Not done yet (next)

- **Connection manager polish**: the UI still needs to write passwords/keys through
  `irodori-secure-store`, expose proxy-chain editing, and surface
  `irodori-proxy` diagnostics; it currently persists non-secret profile fields
  locally.
- **Object browser expansion**: richer per-engine metadata remains (routines,
  triggers/packages, comments, row estimates, Mongo nested fields, DuckDB indexes),
  but the first schema/table/column/index pass is wired.
- **H2**: deferred for now. The production path is likely H2's PostgreSQL-wire
  server mode first, with native/JDBC-style H2 access considered later only if a
  suitable Rust bridge is chosen.
- **SRC-001a remaining**: the reusable `SqlDialect` and generic
  `information_schema` metamodel now live in external `irodori-sql`; remaining
  desktop work is the two-tier lazy metadata cache and cancellation plumbing
  around per-engine adapters.
- **Refinements**: Oracle NUMBER → integer representation, date/timestamp formatting,
  and `fetch_more` pagination; rich array decoding. (SQL Server precision-safe
  decimals/temporals/binary is now done — see below.)
- **Beyond the engine layer** (per ROADMAP): shared/streaming export-import
  paths, driver-level SSH/proxy dialer integration, cross-platform completion
  service/API parity, optional AI/MCP, the extension SDK, and editor/workbench
  hardening.
