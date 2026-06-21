# Local Knowledge Base

Irodori should keep a local, searchable memory of database specifications, release notes, DB-client product expectations, AI integration docs, and implementation notes.

The goal is to make future implementation and bug fixing less dependent on memory or scattered browser tabs.

## Storage

- Generated SQLite DB: `knowledge/irodori-knowledge.sqlite`
- Schema: `knowledge/schema.sql`
- Source registry: `knowledge/sources.json`
- Refresh script: `tools/knowledge/refresh.mjs`
- Query script: `tools/knowledge/query.mjs`

The SQLite DB is intentionally ignored by Git. The schema and source registry are tracked.

## Usage

Initialize the DB and register sources without network access:

```bash
node tools/knowledge/refresh.mjs --no-fetch
```

Fetch the first few sources:

```bash
node tools/knowledge/refresh.mjs --limit 5
```

Fetch one source:

```bash
node tools/knowledge/refresh.mjs --source sqlite-changes
```

List registered sources:

```bash
node tools/knowledge/query.mjs
```

Search snapshots:

```bash
node tools/knowledge/query.mjs "ALTER TABLE"
```

## What To Store

- Official release notes and migration notes.
- SQL syntax/reference pages.
- Non-SQL source references: Cypher, time-series SQL/native query docs, document/KV/search APIs, and distributed SQL operational metadata.
- Catalog/introspection references.
- Driver documentation and behavior changes.
- DB client feature docs and market scans.
- Source-specific GUI docs such as Neo4j Browser, InfluxDB UI/Data Explorer, MongoDB Compass, RedisInsight, and DbGate.
- AI/Copilot/MCP integration docs.
- Manual facts discovered while fixing bugs.
- Implementation notes linking a source fact to an Irodori component.

## Source Policy

- Prefer official docs and release notes.
- Store URL, source product, fetch time, and hash for every snapshot.
- Summarize implementation facts in our own words.
- Do not store proprietary docs that we do not have rights to retain.
- Do not treat scraped docs as vendored source code.

## Automation Direction

- Local: run the refresh script manually while developing.
- Scheduled: later add a weekly GitHub Actions job or local cron that refreshes sources and opens a report.
- Smarter extraction: add per-product extractors for versions, breaking changes, SQL syntax changes, new functions, deprecated features, and driver-impacting changes.
- Integration: surface relevant facts in the app when implementing a dialect feature or debugging a query issue.
