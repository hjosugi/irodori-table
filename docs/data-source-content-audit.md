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
| QuestDB | Gets `del`/`delop`/`softdel`/`touch` but does **not** support row-level DELETE and constrains UPDATE → invalid SQL; missing signature `SAMPLE BY`/`LATEST ON`/`ASOF JOIN` snippets | questdb.com/docs/concepts/deep-dive/sql-extensions/ |
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

- **Cheatsheets: only 2 of 36 engines** (postgres, neo4j). MySQL/MariaDB/SQLite/
  SQL Server listed "Planned"; Oracle/Firebird/all others absent.
- **Connectors: 0 of 36 implemented** at audit time (empty repos).

## Recommended fixes (low-risk, data-file edits)

1. Remove `returning`/`limit` from `completion-keywords.json` `common[]`; move to
   the engines that actually support them.
2. Athena keyword `format = 'iceberg'` → `'table_type'='ICEBERG'`; add Trino +
   Athena to `mergeEngines`.
3. Drop Snowflake/Redshift from the SAVEPOINT (`sp`) snippet; reclassify BigQuery
   as transaction-capable.
4. Remove QuestDB from the DELETE-bearing `dmlEngines` path; add `SAMPLE BY`/
   `ASOF JOIN` snippets.
5. Add a `firebird` keyword entry; add Firebird to `mergeEngines`/
   `returningEngines`; add MariaDB to `returningEngines`.
6. Remove hallucinated lakehouse keyword tokens (Delta `time travel`, Hudi
   `compaction`/`recordkey`, Iceberg `expire_snapshots`/`rewrite_data_files`,
   S3 Tables `table bucket`); document that formats are queried via an engine.
7. (Larger) Gate keyword completion by SQL-applicability so non-SQL stores stop
   receiving SQL keywords (`completion.ts`/`dialect.ts`).
8. Set `catalog.json` `verified:false` until the connector repos carry real code.
