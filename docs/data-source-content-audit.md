# Data-source content audit (connectors, snippets, keywords)

A correctness audit of the per-engine **completion keywords**, **SQL snippets**,
**connector catalog**, and **cheatsheets** against each database's **official
documentation**. Verified across all 36 catalog engines (2026-06-28). Read-only
audit — this document records findings; fixes are tracked at the end.

Audited artifacts:
- `apps/desktop/src/sql/completion-keywords.json` — per-dialect keyword lists.
- `apps/desktop/src/sql/default-snippets.json` — engine-grouped snippet source
  (`snippets.ts` is the loader/validator; snippets are **engine-scoped**, not
  one flat set).
- `docs/extension-marketplace/catalog.json` — connector metadata.
- `docs/cheatsheets/` — per-engine cheatsheets.

## Verdict

Not "complete/perfect." The snippet **dialect-grouping engine is genuinely
well-designed** and correct for most engines, but there are three systemic
problems and a list of per-engine errors. Honestly perfect today: roughly
DuckDB, MotherDuck, PostgreSQL, SQLite.

## Systemic findings

1. **All 36 connector repos were empty stubs marked `verified:true`.** Every
   `github.com/hjosugi/irodori-extension-*` returned "This repository is empty"
   (0 commits) yet `catalog.json` listed each `verified:true`, `version:"0.1.0"`,
   `runtime:"native"`. There is also no extension host wired in the app yet, so
   nothing loads. → `verified:true` is unsubstantiated; set `false` until the
   repos carry real code (population is now in progress under
   `../irodori-extensions/`).
2. **Keyword completion is not gated by SQL-applicability.** Snippets are
   correctly gated (`sqlSnippetEngines` / `isSqlSnippetEngine`), so non-SQL
   stores get no SQL snippets. But `dialect.ts` routes non-SQL stores to
   `StandardSQL` and `completion.ts keywordList()` returns `COMMON_KEYWORDS`
   (SELECT/JOIN/INSERT/**RETURNING**/UNION) for any engine — leaking SQL
   completion to 8 non-SQL stores: MongoDB, Redis, DynamoDB, Cassandra,
   ScyllaDB, Bigtable, Couchbase, ArangoDB.
3. **`common[]` leaks `returning` and `limit` to every dialect.** Both are
   invalid for MySQL (no RETURNING), SQL Server (`OUTPUT`/`TOP`), Oracle
   (`RETURNING INTO`/`FETCH FIRST`), Firebird, and Spanner (`THEN RETURN`).

## What is correct (verified)

- Snippet engine-groups handle dialects well: PG/SQLite `ON CONFLICT`, MySQL
  `ON DUPLICATE KEY UPDATE`, Oracle/SQL Server/Snowflake/Redshift/BigQuery
  `MERGE`, SQLite `group_concat` checksum fallback (no `md5()`), ClickHouse
  correctly excluded from upsert/merge (no UPSERT/MERGE).
- Non-SQL stores are correctly excluded from SQL **snippets**.
- Neo4j cheatsheet is accurate and current for Neo4j 5 Cypher
  (`CREATE CONSTRAINT … REQUIRE … IS UNIQUE`, `SHOW INDEXES`, `DETACH DELETE`,
  bolt+s URIs) — no deprecated syntax.
- Keyword lists for PostgreSQL, MySQL, SQLite, Oracle, Snowflake, BigQuery,
  Redshift, ClickHouse are accurate (if thin).
- Catalog categorizations are correct except where noted below.

## Per-engine issues (with official sources)

| Engine | Issue | Source |
| --- | --- | --- |
| Athena | `"format = 'iceberg'"` keyword is wrong → Iceberg tables use `'table_type'='ICEBERG'`; `format` is the file format (PARQUET/ORC/AVRO) | docs.aws.amazon.com/athena/latest/ug/querying-iceberg-creating-tables.html |
| Trino, Athena | Support `MERGE INTO` but are excluded from `mergeEngines` → no upsert/merge snippet | trino.io/docs/current/sql/merge.html ; docs.aws.amazon.com/athena/latest/ug/merge-into-statement.html |
| Databricks, Trino/Presto | No `completion-keywords.json` entry at all | docs.databricks.com ; trino.io/docs |
| Snowflake, Redshift | Receive the `sp` (SAVEPOINT) snippet but neither supports SAVEPOINT | docs.snowflake.com/en/sql-reference/transactions ; docs.aws.amazon.com/redshift/latest/dg/c_SQL_commands.html |
| BigQuery | Classified `noExplicitTransactionDmlEngines` but supports `BEGIN/COMMIT/ROLLBACK TRANSACTION` | cloud.google.com/bigquery/docs/transactions |
| QuestDB | Row-level DELETE snippets were removed; time-series signatures are now covered. Remaining audit point: review generic UPDATE-oriented snippets (`upd`/`touch`/`softdel`/`updop`) against QuestDB's current DML limits before calling DML coverage complete. | questdb.com/docs/query/sql/sample-by/ ; questdb.com/docs/query/sql/asof-join/ ; questdb.com/docs/query/sql/latest-on/ |
| Firebird | No keyword entry (only `common`, incl. invalid `limit` — Firebird uses `FIRST/SKIP`/`FETCH FIRST`); supports MERGE + RETURNING but absent from `mergeEngines`/`returningEngines` (no upsert/delret) | firebirdsql.org/file/documentation/.../fblangref40-dml.html |
| MariaDB | Supports `INSERT/DELETE … RETURNING` (10.5+) but absent from `returningEngines` → `delret` never offered | mariadb.com/docs/.../insertreturning |
| Iceberg, Delta Lake, Hudi, S3 Tables | Modeled as first-class engines with their own SQL keyword dialects — these are **table formats/catalogs** accessed via an engine (Spark/Trino/DuckDB/Athena). Hallucinated keyword tokens: Delta `"time travel"` (→ `VERSION AS OF`/`TIMESTAMP AS OF`); Hudi `compaction`/`incremental query`/`recordkey` (configs, not SQL); Iceberg `expire_snapshots`/`rewrite_data_files` (Spark `CALL` procedures), `snapshot_id` (metadata column); S3 Tables `table bucket`/`namespace` (API concepts) | iceberg.apache.org/docs/latest/spark-procedures/ ; docs.delta.io ; hudi.apache.org/docs/configurations/ |
| Cassandra, ScyllaDB | Via the keyword leak, get JOIN/subquery/RETURNING/UNION — invalid in CQL (no joins/subqueries; INSERT is an implicit upsert) | cassandra.apache.org/doc/latest/cassandra/developing/cql/dml.html |
| Cloud Spanner | `returning` keyword surfaced but GoogleSQL uses `THEN RETURN`; supports upsert (`INSERT OR UPDATE`/`ON CONFLICT`) but gets no upsert snippet | cloud.google.com/spanner/docs/dml-syntax |
| ArangoDB | Catalog categories `["graph","document"]` omit `key-value` (officially multi-model document+graph+key/value) | docs.arangodb.com |
| MySQL | `upsert` uses `VALUES(col)`, deprecated since 8.0.20 (use `AS new(...)` alias) | dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-20.html |
| Oracle | Missing high-value keywords: `dual`, `decode`, `nvl2`, `rownum`, `listagg`, `pivot` | docs.oracle.com/.../sqlrf |
| SQL Server | No `OUTPUT`-clause delete-returning variant (`DELETE … OUTPUT deleted.*`) | learn.microsoft.com/.../output-clause-transact-sql |
| Non-SQL stores (Mongo/Redis/DynamoDB/Bigtable/Qdrant/Milvus/Pinecone/InfluxDB/IoTDB/Neo4j/Memgraph/ES/OpenSearch) | Not SQL — MQL/commands/PartiQL/API/Cypher/Flux/DSL/vector. SQL **snippets** correctly withheld; SQL **keywords** leak (see systemic #2) | per-vendor docs |

## Coverage gaps

- **Cheatsheets: only 3 of 36 engines in the public docs** (postgres, neo4j,
  questdb). The table repo keeps only generator snapshots it needs locally;
  QuestDB's human-facing page now lives in `irodori-docs/src/cheatsheets/`.
  MySQL/MariaDB/SQLite/SQL Server listed "Planned"; Oracle/Firebird/all others
  absent.
- **Connectors: 0 of 36 implemented** at audit time (empty repos).

## Fixes applied (2026-06-28, verified: tsc 0 / 342 tests)

- ✅ **Keyword completion gated by SQL-applicability** (`completion.ts` `keywordList`):
  non-SQL stores no longer receive SQL `SELECT/JOIN/RETURNING` keywords — they
  surface only their own dialect terms (e.g. Elasticsearch `_search`/`aggs`).
  Systemic finding #2 resolved.
- ✅ **`common.returning` removed** from `completion-keywords.json`; moved to the
  engines that support it (postgres, sqlite, duckdb, mariadb; the
  cockroachdb/yugabytedb/neon lists already had it).
- ✅ **Athena + S3 Tables** keyword `format = 'iceberg'` → `table_type = 'iceberg'`.
- ✅ **Delta** `time travel` → `version as of`/`timestamp as of`; **Hudi**
  `compaction`/`incremental query`/`recordkey` removed (left `merge into`).
- ✅ **MERGE**: added `trinoPresto`, `athena`, `firebird` to `mergeEngines`.
- ✅ **RETURNING**: added `mariadb`, `firebird` to `returningEngines`.
- ✅ **SAVEPOINT**: new `savepointEngines` group excludes Snowflake/Redshift
  (which have BEGIN/COMMIT but no SAVEPOINT); the generic `sp` snippet uses it.
- ✅ **QuestDB DELETE**: new `deleteEngines`/`limitDeleteEngines`/
  `noTxnDeleteEngines` groups exclude QuestDB from `del`/`delop` (it keeps
  SELECT/UPDATE/`softdel`, which are valid).
- ✅ **`common.limit`** filtered for `oracle`/`sqlserver`/`firebird` in
  `completion.ts` `keywordList` (`NON_LIMIT_SQL_ENGINES`) — they use
  `TOP`/`FETCH FIRST`/`FIRST..SKIP`, not `LIMIT`. (Done in code rather than
  moving `limit` across ~23 engine lists, both to avoid the churn and to avoid
  colliding with concurrent edits to `completion-keywords.json`.)
- ✅ **Firebird/Oracle/SQL Server keyword additions** (Firebird entry;
  Oracle `dual`/`decode`/`rownum`/`listagg`/`pivot`; SQL Server `output`) —
  landed via the connector/keyword work in `completion-keywords.json`.
- ✅ **BigQuery transactions**: dedicated `begin`/`tx`/`commit`/`rollback`
  snippets use `BEGIN TRANSACTION`/`COMMIT TRANSACTION`/`ROLLBACK TRANSACTION`
  without adding BigQuery to the generic `begin;` transaction group.
- ✅ **QuestDB signatures**: added `SAMPLE BY`, `LATEST ON`, and `ASOF JOIN`
  snippets for QuestDB time-series extensions.
- ✅ **QuestDB time-series expansion**: added richer `SAMPLE BY` fill/range/
  alignment and `ASOF JOIN TOLERANCE` snippets, QuestDB-specific completion
  keywords, and a hand-seeded `irodori-docs/src/cheatsheets/questdb.md`.
- ✅ **SQL Server delete-returning**: added a `delret` variant using
  `OUTPUT deleted.*`.

## Remaining (deferred — larger/owned elsewhere)

- `catalog.json` `verified:true` — the connector repos under
  `../irodori-extensions/` are now being populated (no longer empty), so the
  flag is becoming legitimate. Owned by the connector-population effort; not
  edited here.
- Public cheatsheet coverage (3/36 engines).
