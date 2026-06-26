# Irodori sample databases

Real databases in containers, **one compose file per engine** under
`samples/<engine>/compose.yaml`, so every supported database can be stood up and
verified on its own. Verified with podman and Docker.

## Root commands

Run sample databases from the repository root. The targets choose Podman when
available, otherwise Docker; override with `ENGINE_BIN=docker` or
`ENGINE_BIN=podman`.

```bash
make db-up DB=postgres     # start one DB and print the test env var / DSN
make db-verify DB=postgres # up -> connect/query integration test -> down
make db-all                # normal bootable set, in turn
make db-down DB=postgres   # stop + remove one DB
```

Use `db-up` when you want a database to stay running for manual desktop testing.
Use `db-verify` when you want the harness to clean up after a connection/query
test.

## Direct script

```bash
scripts/verify-db.sh postgres      # up -> test -> down for one engine
scripts/verify-db.sh all           # normal bootable set, in turn
scripts/verify-db.sh up postgres   # just start it; prints the env line
scripts/verify-db.sh down postgres # stop + remove
```

`verify-db.sh` brings up the engine's compose, runs the Rust integration test
that connects **through Irodori's own `db::*` code** (`tests/integration_db.rs`),
then stops the container.

PostgreSQL also has `samples/postgres/compose.host.yaml` for Linux/Podman
setups where bridge networking is unavailable. `verify-db.sh postgres` retries
with that host-network compose automatically if the normal bridge compose fails.

## Engine matrix

| Engine | Wire / driver | Compose | Host port | Irodori status |
|---|---|---|---|---|
| PostgreSQL | postgres (sqlx) | `postgres/` | 55432 | ✅ verified |
| MySQL | mysql (sqlx) | `mysql/` | 55306 | ✅ verified |
| MariaDB | mysql wire | `mariadb/` | 55307 | ✅ verified |
| TimescaleDB | postgres wire | `timescaledb/` | 55433 | ✅ (postgres wire) |
| CockroachDB | postgres wire | `cockroachdb/` | 55257 | ✅ verified |
| YugabyteDB | postgres wire (YSQL) | `yugabytedb/` | 55434 | ✅ (postgres wire) |
| TiDB | mysql wire | `tidb/` | 54000 | ✅ (mysql wire) |
| SQL Server | TDS (tiberius) | `sqlserver/` | 51433 | ✅ verified |
| Oracle | thin TNS | `oracle/` | 55521 | ✅ verified individually; slow/heavy |
| MongoDB | document (`mongodb` crate) | `mongodb/` | 57017 | ✅ verified |
| SQLite | file (sqlx) | — | — | ✅ embedded, no container |
| DuckDB | embedded | — | — | ✅ `--features duckdb`, no container |
| Redshift | postgres wire | — (AWS-only) | — | ✅ wire-compatible; point at a real cluster |

## Sample schema

Auto-seeded engines load `samples/<engine>/01_samples.sql` (MariaDB and
TimescaleDB reuse the MySQL/Postgres files). The PostgreSQL fixture includes
the transactional demo tables `customers`, `orders`, `invoice_lines`, and
`recent_revenue`, plus a richer browsing demo: `countries`, `producers`,
`cheeses`, `stores`, `reviews`, and `cheese_summary`. CockroachDB, YugabyteDB,
TiDB, and SQL Server are not auto-seeded; their checks run a self-contained
query.

## Scale / performance seed

`scripts/dev-db.sh` runs its own pg+mysql for **bulk seeding** (verified at 10M
rows + 100 tables, with bounded-memory streaming):

```bash
scripts/dev-db.sh up postgres
ROWS=10000000 TABLES=100 scripts/dev-db.sh seed postgres
scripts/dev-db.sh test postgres
scripts/dev-db.sh down postgres
```

## Notes

- DuckDB's `bundled` build compiles libduckdb (C++) and is heavy; link a
  system/prebuilt libduckdb to skip the C++ compile.
- Oracle uses the pure-Rust thin TNS path, no Instant Client. It is kept out of
  `make db-all` because the container is slow and heavy; run
  `make db-verify DB=oracle` explicitly.
- MongoDB is a document store. Its query path accepts collection names or JSON
  collection/filter objects, not SQL.
