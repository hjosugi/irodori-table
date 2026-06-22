# Implementation Progress

Last updated: 2026-06-22 JST. A status snapshot of what is built and verified —
focused on the database engine layer. Pairs with `ROADMAP.md` (themes) and
`docs/implementation-backlog.md` (tickets).

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
| Redshift | sqlx (pg wire) | wire-compatible | AWS-only (no local container) |

Every engine has a test in `tests/integration_db.rs` (or a unit test); run any
with `scripts/verify-db.sh <engine>` (or `all`).

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
- **Bounded memory**: every engine streams rows and caps at `max_rows` (default
  **10,000**) with a `truncated` flag, so a `select *` over a 10M-row table stays
  light instead of exhausting RAM (the TablePlus problem). Verified: a 10M-row seed,
  full scan returns the 10k page in ~77 ms.
- **Trait + registry**: the closed `EnginePool` enum is gone; connections live behind
  `Arc<dyn Connection>` and dispatch with `conn.run_query()`, not a `match`.

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
- Result grids can be exported to CSV from the desktop UI, with object/JSON values
  serialized and CSV quoting handled client-side.
- The browser build still falls back to the mock shell when Tauri APIs are absent;
  real connect/query runs inside the Tauri shell.
- The object browser now calls generated `dbListObjects` and renders live
  schema → table/view/collection → columns/indexes metadata for PostgreSQL-wire,
  MySQL-wire, SQLite, SQL Server, Oracle, DuckDB, and MongoDB connections.
- The sidebar connection UI is now a real profile editor: saved profiles live in
  localStorage, password fields are session-only and are not persisted, profiles
  can be created/selected/saved/deleted, URL/DSN and structured host/port/user
  modes are both available, and Test/Connect/Disconnect are wired to the backend.
- In-memory databases are first-class for local work: SQLite `:memory:` is wired
  through structured profiles and verified by a unit test; DuckDB `:memory:` is
  available when the `duckdb` feature is built.

## Test & sample infrastructure

- **Per-DB compose**: `samples/<engine>/compose.yaml` (one file per engine), plus
  Oracle/MongoDB targets. `scripts/verify-db.sh <engine>|all` does up → test → down.
- **Scale/perf seed**: `scripts/dev-db.sh seed postgres` generates `ROWS` (default
  10M) rows + `TABLES` (default 100) tables.
- **Syntax reference**: `docs/engine-syntax-reference.md` — connection + query syntax
  and dialect quirks for every engine.

## References studied (clean-room, license-aware)

- DBeaver (Apache-2.0, vendored `ref/dbeaver-ce` — adaptable with attribution),
  Beekeeper (GPL — behavior only), Outerbase (AGPL — behavior), Zequel (Elastic
  License 2.0 — behavior), TablePlus / A5:SQL Mk-2 (behavior). Lessons (DatabaseClient
  trait + registry, wire⇄dialect split, precision-safe value handlers, lazy metadata,
  cancellation) are tracked in the backlog.

## Coordination

- **typebridge** (Rust→TypeScript type bridge) is a sibling project at
  `/mnt/data/workspace/typebridge`, wired as a dev-dependency; the
  `export_typescript_bindings` test renders the desktop TS boundary through it. See
  `docs/type-bridge-handoff.md`.

## Not done yet (next)

- **Connection manager polish**: OS keychain-backed secrets and richer diagnostics
  still need Rust-side storage/transport work; UI currently persists non-secret
  profile fields locally.
- **Object browser expansion**: richer per-engine metadata remains (routines,
  triggers/packages, comments, row estimates, Mongo nested fields, DuckDB indexes),
  but the first schema/table/column/index pass is wired.
- **H2**: deferred for now. The production path is likely H2's PostgreSQL-wire
  server mode first, with native/JDBC-style H2 access considered later only if a
  suitable Rust bridge is chosen.
- **SRC-001a remaining**: per-engine `SqlDialect` (identifier quoting / keywords /
  paging), a generic `information_schema` metamodel, a two-tier lazy metadata cache,
  and a cancellation token.
- **Refinements**: Oracle NUMBER → integer representation, date/timestamp formatting,
  and `fetch_more` pagination; SQL Server precision-safe decimals/temporals; rich
  array decoding.
- **Beyond the engine layer** (per ROADMAP): export/import (CSV/TSV/INSERT/JSON/Avro/
  Parquet), proxy/SSH transports, schema-aware completion, optional AI/MCP, the
  extension SDK, and the editor.
