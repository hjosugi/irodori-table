# Engine Cheatsheets

One page per database that answers, fast: **how do I connect from Irodori, what is
the query model, and what are the per-engine quirks I will trip on.** These are the
human-facing, copy-pasteable companion to the deeper `docs/engine-syntax-reference.md`
(driver/decoding internals) and `docs/data-source-support-status.md` (coverage).

Each cheatsheet is meant to be **generated** from the local knowledge base
(`knowledge/irodori-knowledge.sqlite`) once the generator lands; until then a page
may be hand-seeded (marked `<!-- seed -->`). The generation contract and the
automatic data collection that feeds it are specified in
`docs/cheatsheet-autodoc-plan.md`.

## Index

| Cheatsheet | Engine(s) covered | Status |
|---|---|---|
| [neo4j.md](neo4j.md) | Neo4j (graph, Bolt/Cypher); Memgraph notes | Seed (flagship) |
| [postgres.md](postgres.md) | PostgreSQL (+ Cockroach/Yugabyte/Redshift/Timescale/Neon) | Generated (`knowledge/cheatsheets/postgres.json`) |
| _mysql.md_ | MySQL / MariaDB / TiDB | Planned |
| _sqlite.md_ | SQLite | Planned |
| _sqlserver.md_ | SQL Server | Planned |
| _duckdb.md_ | DuckDB | Planned |
| _mongodb.md_ | MongoDB | Planned |

New cheatsheets are added only for engines that are at least **Wired** in
`docs/data-source-support-status.md`. An engine that is "Recognized, no connector"
or "Not registered" gets a row in the support-status doc, not a cheatsheet, until
it can actually connect.

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
