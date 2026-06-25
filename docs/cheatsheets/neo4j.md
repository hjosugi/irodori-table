<!-- seed: flagship hand-authored example of the cheatsheet format; target is generation from knowledge sources neo4j-cypher-manual + neo4j-browser-docs -->

# Neo4j Cheatsheet

## At a glance

| | |
|---|---|
| Wire / driver | Bolt / `neo4rs` (pure Rust) |
| Adapter | `apps/desktop/src-tauri/src/db/neo4j.rs` |
| Default port | 7687 (Bolt) |
| Query language | **Cypher** (not SQL) |
| Irodori status | Wired (graph) — see `docs/data-source-support-status.md` |
| What's different | Data is **nodes and relationships**, not rows. You query patterns with Cypher and get back records of nodes/relationships/scalars. |

## Connect

Irodori accepts either a raw `url` or structured fields. Defaults match the
adapter: host `127.0.0.1`, port `7687`, user `neo4j`, database `neo4j`, empty
password.

| Field | Example | Notes |
|---|---|---|
| `url` | `bolt://127.0.0.1:7687` | Overrides host/port. Use `neo4j://` for routing/cluster, `bolt+s://` / `neo4j+s://` for TLS. |
| host / port | `127.0.0.1` / `7687` | Used only when `url` is empty; adapter builds `bolt://host:port`. |
| user | `neo4j` | |
| password | `password` | |
| database | `neo4j` | The Neo4j database name (4.x+ multi-db). |

Minimal raw form: `bolt://neo4j:password@127.0.0.1:7687` (database selected
separately, defaults to `neo4j`).

## Query model

- You type **Cypher**; Irodori runs it through `Graph::execute`.
- Results become a table: **columns = the ordered union of `RETURN` keys** across
  records; each record fills known columns, missing keys → `null`.
- Node / relationship / path values render as JSON cells (their properties).
- Rows are **capped at `max_rows`** (default 10,000); the result is flagged
  `truncated: true` when more remain. Add an explicit `LIMIT` for large graphs.
- Version: Irodori reads it via `CALL dbms.components()`.

## Essential statements

```cypher
-- Read a pattern
MATCH (p:Person)-[:ACTED_IN]->(m:Movie)
WHERE m.released >= 2000
RETURN p.name AS actor, m.title AS movie
ORDER BY m.released DESC
LIMIT 25;

-- Parameters (preferred over string interpolation)
MATCH (p:Person {name: $name}) RETURN p;

-- Create / upsert
CREATE (p:Person {name: 'Ada', born: 1815});
MERGE (p:Person {name: 'Ada'})            -- match-or-create on the key
  ON CREATE SET p.born = 1815
  ON MATCH  SET p.seen = timestamp();

-- Relate
MATCH (a:Person {name:'Ada'}), (m:Movie {title:'Analytics'})
MERGE (a)-[r:ACTED_IN {role:'self'}]->(m);

-- Aggregate / collect
MATCH (p:Person)-[:ACTED_IN]->(m)
RETURN p.name, count(m) AS films, collect(m.title) AS titles
ORDER BY films DESC;

-- Pipe with WITH, expand lists with UNWIND
UNWIND [1,2,3] AS n RETURN n*n AS square;

-- Variable-length path
MATCH path = (a:Person {name:'Ada'})-[:KNOWS*1..3]-(b:Person)
RETURN b.name, length(path) AS hops;

-- Delete safely (detach removes attached relationships)
MATCH (p:Person {name:'Ada'}) DETACH DELETE p;
```

Clause order to memorize: `MATCH` → `WHERE` → `WITH` → `RETURN` → `ORDER BY` →
`SKIP` → `LIMIT`. `WITH` is the pipe between query parts (it also gates `WHERE`
after aggregation).

## Introspection

This is exactly what Irodori's object browser runs against Neo4j:

```cypher
CALL db.labels()              YIELD label              RETURN label;            -- node labels
CALL db.relationshipTypes()   YIELD relationshipType   RETURN relationshipType; -- rel types
CALL db.propertyKeys()        YIELD propertyKey        RETURN propertyKey;      -- property keys
SHOW INDEXES;                 -- indexes (4.x+)
SHOW CONSTRAINTS;             -- constraints (4.x+)
CALL dbms.components();       -- server name / version / edition
```

Indexes & constraints you will create often:

```cypher
CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name);
CREATE CONSTRAINT person_name_unique IF NOT EXISTS
  FOR (p:Person) REQUIRE p.name IS UNIQUE;
```

## Irodori-specific behavior

- **Object browser mapping** (`neo4j.rs::metadata`): node **labels are shown as
  "tables"** and **relationship types as "views"**. Their "columns" are the
  property keys, sampled with
  `MATCH (n:\`Label\`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 100`. This is
  a sampling pass, so a property that only appears on a few nodes can be missed —
  treat the column list as representative, not exhaustive.
- **Results are tabular today.** Node/relationship records show as JSON property
  cells. A query-result **graph visualization** is a planned shared capability
  (P1, see `docs/data-source-coverage-strategy.md` → Graph), not yet in the UI.
- **No SQL.** Engines like advanced filters / inline editing that assume relational
  semantics do not apply; use Cypher `SET` / `MERGE` / `DELETE`.

## Gotchas

- Use **parameters** (`$name`) instead of string-building queries — safer and lets
  the planner cache the plan.
- `MATCH ... DELETE` fails if the node still has relationships; use `DETACH DELETE`.
- Backtick labels/types with special characters: `` :`Order Line` ``.
- `MERGE` matches on the **whole pattern** — `MERGE (p:Person {name:'Ada', born:1815})`
  with a different `born` creates a *second* node. Merge on the key, then `SET`.
- Bolt over TLS needs the `+s` scheme (`bolt+s://` / `neo4j+s://`).

## Related: Memgraph

Memgraph speaks Bolt + Cypher and is in the `DbEngine` enum (`memgraph`) but is
currently **"recognized, no connector"** — most of this page applies once it is
routed through the Neo4j/Bolt adapter and verified.

## Sources

Generated from `knowledge/sources.json`:

- `neo4j-cypher-manual` — https://neo4j.com/docs/cypher-manual/current/
- `neo4j-browser-docs` — https://neo4j.com/docs/browser/
