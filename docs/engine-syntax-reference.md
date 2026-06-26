# Engine Connection & Query Reference

For every database Irodori supports: how to connect, the query model, and the
driver/dialect quirks. This doubles as the basis for the per-engine `SqlDialect`
(SRC-001a) and as a reference for extension authors. All engines go through the
same `Connection` trait (`apps/desktop/src-tauri/src/db/`).

Related docs: `docs/data-source-support-status.md` is the coverage inventory (what
connects today vs. what is declared/planned); `docs/cheatsheets/` holds the
task-oriented, copy-pasteable per-engine pages; `docs/cheatsheet-autodoc-plan.md`
covers how both get auto-generated. This file stays the deep driver/decoding
reference.

## Coverage at a glance

| Engine | Wire / driver | Default port | Query model | Test (`tests/integration_db.rs` / unit) | Container |
|---|---|---|---|---|---|
| PostgreSQL | postgres / sqlx | 5432 | SQL | `postgres_samples` | `samples/postgres` |
| MySQL | mysql / sqlx | 3306 | SQL | `mysql_samples` | `samples/mysql` |
| MariaDB | mysql wire / sqlx | 3306 | SQL | `mariadb_connect` | `samples/mariadb` |
| TimescaleDB | postgres wire / sqlx | 5432 | SQL | `timescaledb_samples` | `samples/timescaledb` |
| CockroachDB | postgres wire / sqlx | 26257 | SQL | `cockroachdb_connect` | `samples/cockroachdb` |
| YugabyteDB | postgres wire (YSQL) / sqlx | 5433 | SQL | `yugabytedb_connect` | `samples/yugabytedb` |
| TiDB | mysql wire / sqlx | 4000 | SQL | `tidb_connect` | `samples/tidb` |
| SQL Server | TDS / tiberius | 1433 | SQL | `sqlserver_samples` | `samples/sqlserver` |
| DuckDB | embedded libduckdb | — | SQL | `duckdb_in_memory` | none (embedded) |
| MongoDB | document / mongodb | 27017 | documents | `mongo_samples` | `samples/mongodb` |
| SQLite | file / sqlx | — | SQL | `sqlite_connect_and_query_round_trip` (unit) | none (file) |
| Oracle | thin TNS / `oracle-rs` | 1521 | SQL | `oracle_samples` | `samples/oracle` |
| Redshift | postgres wire / sqlx | 5439 | SQL | — (AWS-only, no local container) | — |

Run them with `make db-verify DB=<engine>` or `make db-all`. Env-gated tests
skip unless the matching `IRODORI_*` variable is set; the sample harness sets it
per engine.

## Connection syntax

Irodori accepts either structured fields (`host`/`port`/`user`/`password`/
`database`) or a raw `url`/DSN that overrides them.

| Engine | URL / DSN form |
|---|---|
| PostgreSQL & wire-compatible | `postgres://user:pass@host:5432/db` |
| CockroachDB (insecure) | `postgres://root@host:26257/defaultdb?sslmode=disable` |
| YugabyteDB (YSQL) | `postgres://yugabyte@host:5433/yugabyte?sslmode=disable` |
| MySQL / MariaDB / TiDB | `mysql://user:pass@host:3306/db` |
| SQLite | `sqlite://path/to.db?mode=rwc` or `sqlite::memory:` |
| SQL Server (ADO) | `server=tcp:host,1433;User Id=sa;Password=…;TrustServerCertificate=true` |
| DuckDB | a file path or `:memory:` (in `database`/`url`) |
| MongoDB | `mongodb://user:pass@host:27017/db?authSource=admin` |
| Oracle | structured `host`/`port`/`user`/`password`/service fields |

## Per-engine notes

### PostgreSQL (+ CockroachDB, YugabyteDB, Redshift, TimescaleDB)
- **Driver:** sqlx native `PgPool`. The wire-compatible engines reuse it; only the
  default port and a few catalog quirks differ (modeled later by the metamodel).
- **Version:** `select version()`.
- **Identifier quoting:** ANSI double quotes — `"My Col"`; escape `"` by doubling.
- **Paging:** `LIMIT n OFFSET m`.
- **Decoding:** `NUMERIC`→string (exact, via `BigDecimal`), `TIMESTAMPTZ`→RFC3339,
  `TIMESTAMP/DATE/TIME`→string, `JSON/JSONB`→object, `UUID`→string,
  `BYTEA`→`\xHEX`, bool/ints/floats native.
- **Quirks:** arrays decode best-effort to text today (rich array decode is a
  follow-up); CockroachDB omits some `OID`-typed system columns tools expect.

### MySQL / MariaDB / TiDB
- **Driver:** sqlx native `MySqlPool`.
- **Version:** `select version()`.
- **Identifier quoting:** backticks — `` `My Col` ``.
- **Paging:** `LIMIT n OFFSET m` (or `LIMIT m, n`).
- **Decoding:** `DECIMAL`→string, `DATETIME/TIMESTAMP/DATE`→string, `JSON`→object,
  `BLOB/BINARY`→`\xHEX`, ints/floats/strings native.
- **Quirks:** MySQL 8.4 defaults to `caching_sha2_password`; sqlx handles it over a
  non-TLS connection via the server's RSA public key. MariaDB defaults to
  `mysql_native_password`. TiDB speaks the MySQL protocol on port 4000.

### SQLite
- **Driver:** sqlx native `SqlitePool`, capped at one connection.
- **Version:** `select sqlite_version()`.
- **Quoting:** double quotes or backticks.
- **Decoding:** dynamically typed — values are decoded by trying integer, real,
  text, then blob (`\xHEX`).
- **Quirks:** single writer; `:memory:` is per-connection (use a file to share).

### SQL Server
- **Driver:** pure-Rust `tiberius` (TDS) — no SQL Server client library.
- **Version:** `select @@version` (first line kept).
- **Quoting:** brackets — `[My Col]` (or ANSI `"` with `QUOTED_IDENTIFIER ON`).
- **Paging:** `OFFSET n ROWS FETCH NEXT m ROWS ONLY` (2012+), or `TOP n`.
- **Decoding (MVP):** bool/int/float/string. Decimals currently come back as float
  (lossy) and datetimes/binary as null — precision-safe decimals and temporals are
  a tracked follow-up (EXEC-009b).
- **Quirks:** tiberius sends statements via `sp_executesql`, so local `#temp`
  tables are scoped away between calls — use `##global` temp tables, real tables,
  or (for self-contained checks) a `VALUES` table constructor:
  `select a,b from (values (1,'x')) v(a,b)`.

### DuckDB (`--features duckdb`)
- **Driver:** embedded libduckdb. The `bundled` build compiles libduckdb (C++) and
  is heavy — link a prebuilt/system libduckdb to skip the compile.
- **Version:** `select version()`.
- **Quoting:** double quotes.
- **Paging:** `LIMIT n OFFSET m`.
- **Decoding:** rich (bool/ints/uints/float/double/text/blob); other types render
  as their text form.
- **Quirks:** statements are **classified** — DDL/DML run through `execute`, only
  row-returning statements through `query`; column metadata is read *after*
  execution (DuckDB materializes the schema then). This avoids a driver panic.

### MongoDB (document store — not SQL)
- **Driver:** `mongodb` crate (pure Rust).
- **Version:** `buildInfo.version`.
- **"Query":** a bare collection name (e.g. `customers`), or a JSON object
  `{ "collection": "orders", "filter": { "tier": "gold" } }`. Documents project to
  a table by the **ordered union of top-level keys** (missing keys → null); values
  render as relaxed extended JSON (`ObjectId` → `{ "$oid": "…" }`, dates → ISO).
- **Quirks:** no SQL. Aggregation pipelines, nested-field projection, and sort are
  follow-ups (SRC-012). Auth usually needs `?authSource=admin` for the root user.

### Oracle
- **Driver:** pure-Rust **thin TNS** through `oracle-rs`; no Oracle Instant Client
  is required for the default path.
- **Connection:** descriptor `//host:1521/service`, or structured host/port/user/
  password/database fields. `database` can be a service name, `service:<name>`, or
  `sid:<name>`. Wallet paths can be supplied on the URL query as `wallet` and
  `wallet_password`.
- **Explain:** `EXPLAIN PLAN FOR ...` returns `DBMS_XPLAN.DISPLAY` output as a
  one-column result set.

## Bounded results (all engines)

Every engine streams rows and stops at `max_rows` (default **10,000**), returning
`truncated: true` when more remain — so a `select *` over a 10M-row table stays
memory-bounded instead of exhausting RAM. Full extraction is run-to-file (IO-001);
optional disk offload for very large windows is EXEC-010.
