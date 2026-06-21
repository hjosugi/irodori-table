# Irodori sample databases

Real databases in containers so connection, query, and scale behavior can be
tested against actual engines — not mocks. Verified with podman and Docker.

## Quick start

```bash
# start postgres (55432) + mysql (55306), wait for ready, print env
scripts/dev-db.sh up

# run the Rust integration tests against them
scripts/dev-db.sh test

# stop and remove
scripts/dev-db.sh down
```

`docker compose -f samples/compose.yaml up -d` works too. Extra wire-compatible
engines (CockroachDB on 26257, MariaDB on 13306) start with `--profile extra`;
the Oracle spike target (heavy, ~2 GB) with `--profile oracle`.

Verified: Irodori connects to and queries **PostgreSQL, MySQL, MariaDB, and
CockroachDB** real instances. YugabyteDB, Redshift, TimescaleDB, and TiDB use the
same Postgres/MySQL wire drivers (`db::DbEngine`).

## What you get

- **postgres** `localhost:55432` — user/pass/db = `irodori`/`irodori`/`samples`
- **mysql** `localhost:55306` — user/pass/db = `irodori`/`irodori`/`samples`
- **oracle** (compose `oracle` profile) `localhost:55521` — service `FREEPDB1`

Each starts with the demo schema in `samples/<engine>/01_samples.sql`:
`customers`, `orders`, `invoice_lines`, and a `recent_revenue` view.

## Scale / performance seed

`scripts/dev-db.sh seed postgres` (or `mysql`) generates:

- one big `events` table — `ROWS` rows (default **10,000,000**)
- `TABLES` extra catalog tables (default **100**) to exercise the object browser

```bash
ROWS=10000000 TABLES=100 scripts/dev-db.sh seed postgres
```

Postgres uses `generate_series` (≈40 s for 10M here); MySQL uses a digit
cross-join. Both are one-shot; the data lives in the container volume.

## What the tests prove

`apps/desktop/src-tauri/tests/integration_db.rs` (env-gated; skipped unless
`IRODORI_PG_URL`/`IRODORI_MYSQL_URL` are set) drives the real Tauri command code
(`db::connect_impl` / `db::run_query_impl`) and asserts:

- connect + server version for PostgreSQL and MySQL
- seeded demo rows return correctly
- a full scan of the 10M-row `events` table returns a **bounded 10k page with
  `truncated=true` in tens of ms** — large retrieval stays light, instead of
  buffering every row into memory (the TablePlus problem).

## Known limits (tracked in docs/implementation-backlog.md)

- Value decoding currently goes through sqlx's `Any` driver, which only covers
  int/bigint/text/bool/bytes. Decimals, dates/timestamps, json, and arrays need
  the per-engine native pools (EXEC-009) — the Beekeeper-informed refactor.
- Streaming is capped per page (EXEC-002); optional **disk offload** for very
  large windows (EXEC-010) and **auto-parallel** fetch/introspection/export
  (EXEC-011) are planned.
- Oracle connects through a future pure-Rust thin driver (SRC-004a); the compose
  `oracle` service is only a target for that spike.
