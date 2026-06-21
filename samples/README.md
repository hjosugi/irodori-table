# Irodori sample databases

Real databases in containers, **one compose file per engine** under
`samples/<engine>/compose.yaml`, so every supported database can be stood up and
verified on its own. Verified with podman and Docker.

## Verify an engine (up → connect/query test → down)

```bash
scripts/verify-db.sh postgres      # one engine
scripts/verify-db.sh all           # all bootable engines, in turn
scripts/verify-db.sh up postgres   # just start it; prints the env line
scripts/verify-db.sh down postgres # stop + remove
```

`verify-db.sh` brings up the engine's compose, runs the Rust integration test
that connects **through Irodori's own `db::*` code** (`tests/integration_db.rs`),
then stops the container.

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
| Oracle | thin TNS | `oracle/` | 55521 | ⏳ driver pending — target only |
| MongoDB | document (`mongodb` crate) | `mongodb/` | 57017 | ⏳ driver pending (SRC-012) |
| SQLite | file (sqlx) | — | — | ✅ embedded, no container |
| DuckDB | embedded | — | — | ✅ `--features duckdb`, no container |
| Redshift | postgres wire | — (AWS-only) | — | ✅ wire-compatible; point at a real cluster |

## Sample schema

Auto-seeded engines load `samples/<engine>/01_samples.sql` (MariaDB and
TimescaleDB reuse the MySQL/Postgres files): `customers`, `orders`,
`invoice_lines`, and the `recent_revenue` view. CockroachDB, YugabyteDB, TiDB,
and SQL Server are not auto-seeded; their checks run a self-contained query.

## Scale / performance seed

`scripts/dev-db.sh` runs its own pg+mysql for **bulk seeding** (verified at 10M
rows + 100 tables, with bounded-memory streaming):

```bash
scripts/dev-db.sh up
ROWS=10000000 TABLES=100 scripts/dev-db.sh seed postgres
scripts/dev-db.sh test
scripts/dev-db.sh down
```

## Notes

- DuckDB's `bundled` build compiles libduckdb (C++) and is heavy; link a
  system/prebuilt libduckdb to skip the C++ compile.
- Oracle uses a future pure-Rust thin TNS driver (no Instant Client), the way
  A5:SQL Mk-2's direct mode works; the compose service is only a connection target.
- MongoDB is a document store, so it needs the `mongodb` crate and a
  document-oriented query/result path — not the SQL `run_query` (SRC-012).
