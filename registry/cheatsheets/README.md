# Engine Cheatsheets

One page per database that answers, fast: **how do I connect from Irodori, what is
the query model, and what are the per-engine quirks I will trip on.** These are the
human-facing, copy-pasteable companion to the deeper
<https://hjosugi.github.io/irodori-docs/engine-syntax-reference.html>
(driver/decoding internals) and
[`registry/data-source-support-status.md`](../data-source-support-status.md)
(coverage).

Each cheatsheet is meant to be **generated** from the local knowledge base
(`knowledge/irodori-knowledge.sqlite`) once the generator lands; until then a page
may be hand-seeded (marked `<!-- seed -->`). The generation contract and the
automatic data collection that feeds it are specified in
<https://hjosugi.github.io/irodori-docs/cheatsheet-autodoc-plan.html>.

## Index

| Cheatsheet | Engine(s) covered | Status |
|---|---|---|
| [neo4j.md](neo4j.md) | Neo4j (graph, Bolt/Cypher); Memgraph extension notes | Seed (flagship graph/Bolt page) |
| [postgres.md](postgres.md) | PostgreSQL (+ Cockroach/Yugabyte/Redshift/Timescale/Neon; H2 wire notes) | Generated (`knowledge/cheatsheets/postgres.json`) |
| _mysql.md_ | MySQL / MariaDB / TiDB | Planned |
| _sqlite.md_ | SQLite | Planned |
| _oracle.md_ | Oracle | Planned |
| _sqlserver.md_ | SQL Server | Planned |
| _duckdb.md_ | DuckDB / MotherDuck | Planned |
| _mongodb.md_ | MongoDB | Planned |
| _redis.md_ | Redis | Planned |
| _cassandra.md_ | Cassandra / ScyllaDB | Planned |
| _clickhouse.md_ | ClickHouse | Planned |
| _snowflake.md_ | Snowflake | Planned |
| _bigquery.md_ | BigQuery | Planned |
| _bigtable.md_ | Bigtable | Planned |
| _influxdb.md_ | InfluxDB | Planned |
| _questdb.md_ | QuestDB | Planned |

New cheatsheets are added only for engines that are at least **Wired** in
`registry/data-source-support-status.md`. An engine that is "Recognized, no connector"
or "Not registered" gets a row in the support-status doc, not a cheatsheet, until
it can actually connect.

## Maintenance queue

Seed the next pages in the same order as the support-status table, prioritizing
engines with verified or wired query paths and enough source coverage in
`knowledge/sources.json`: `duckdb.md`, `mongodb.md`, `redis.md`,
`cassandra.md`, `clickhouse.md`, `snowflake.md`, `bigquery.md`, `bigtable.md`,
and `influxdb.md`.

Some sibling connector implementations can run ahead of the root registry. Until
`knowledge/engines.json` and `registry/data-source-support-status.md` promote an
engine to Wired/Extension, keep those details as related notes under the nearest
wired cheatsheet instead of publishing a standalone page.

## Page format (the template every cheatsheet follows)

Keep sections in this order so the generator can produce them deterministically and
so readers build muscle memory:

1. **At a glance** — wire/driver, default port, query language, Irodori support
   status, and a one-line "what makes this engine different".
2. **Connect** — Irodori connection fields *and* the raw URL/DSN form, with a
   minimal working example.
3. **Query model** — what you type, what comes back, row cap behavior.
4. **Essential statements** — a tight, runnable set of the 80%-case queries.
5. **Introspection** — how to list objects the way Irodori's object browser does.
6. **Irodori-specific behavior** — mapping/quirks unique to how *this app* handles
   the engine (decoding, object-browser mapping, what's not implemented yet).
7. **Gotchas** — the small number of things that actually bite people.
8. **Sources** — the `knowledge/sources.json` ids the page was generated from.

The **Sources** footer is load-bearing: it ties each page back to the official docs
in the knowledge registry so a refresh can detect when a page is stale.

Human-facing mdBook pages that are not required as table-repo generator
snapshots live in `hjosugi/irodori-docs` under `src/cheatsheets/`.
