# Data Source Support Status

Last generated: 2026-06-26 JST (hand-authored seed; target is auto-generation —
see <https://hjosugi.github.io/irodori-docs/cheatsheet-autodoc-plan.html>).

This is the single inventory of **what Irodori connects to today vs. what is
declared, planned, or not yet started**. The authoritative source of truth is the
`DbEngine` registry in `apps/desktop/src-tauri/src/db/engine.rs` and the connect
dispatch in `apps/desktop/src-tauri/src/db.rs`. Roadmap intent lives in
<https://hjosugi.github.io/irodori-docs/data-source-coverage-strategy.html>;
this file reconciles intent against the code.

For contract/provisioning and managed-service verification procedures, see
<https://hjosugi.github.io/irodori-docs/external-db-contract-and-verification.html>.

Status legend:

- **Wired** — has a production connect path and a dedicated adapter or a
  wire-compatible adapter it routes through.
- **Verified** — Wired *and* exercised against a real instance in
  `tests/integration_db.rs` through the sample harness (`make db-verify`).
- **Pending** — recognized by the engine enum, adapter scaffolding exists, but the
  connector intentionally returns a "not ready" result.
- **Extension** — recognized by the engine enum and published through the
  extension marketplace; the app browses `docs/extension-marketplace/catalog.json`
  and install/details stay in `docs/extension-marketplace/index.json` instead of
  being compiled into the core desktop build.
- **Recognized, extension required** — present in `DbEngine` but rejected at
  connect by `is_unimplemented_wire()` until an installable connector extension
  is present.
- **Not registered** — named in the roadmap/coverage strategy but **absent from the
  `DbEngine` enum** — i.e. not selectable in the app at all yet.

## 1. Wired engines (selectable and connectable today)

| Engine | `DbEngine` id | Wire / driver | Adapter file | Port | Maturity |
|---|---|---|---|---|---|
| PostgreSQL | `postgres` | Postgres / sqlx | `db/postgres.rs` | 5432 | Verified |
| MySQL | `mysql` | MySQL / sqlx | `db/mysql.rs` | 3306 | Verified |
| MariaDB | `mariadb` | MySQL wire / sqlx | (via `mysql.rs`) | 3306 | Verified |
| SQLite | `sqlite` | file / sqlx | `db/sqlite.rs` | — | Verified (unit) |
| Oracle | `oracle` | Thin TNS / `oracle-rs` | `db/oracle.rs` | 1521 | Verified |
| SQL Server | `sqlserver` | TDS / tiberius | `db/mssql.rs` | 1433 | Verified |
| DuckDB | `duckdb` | embedded libduckdb | `db/duck.rs` | — | Verified |
| MotherDuck | `motherduck` | DuckDB service / extension | `irodori.motherduck` | 443 | Extension |
| CockroachDB | `cockroachdb` | Postgres wire / sqlx | (via `postgres.rs`) | 26257 | Verified |
| YugabyteDB (YSQL) | `yugabytedb` | Postgres wire / sqlx | (via `postgres.rs`) | 5433 | Wired |
| Redshift | `redshift` | Postgres wire / sqlx | (via `postgres.rs`) | 5439 | Wired (AWS, no local container) |
| TimescaleDB | `timescaledb` | Postgres wire / sqlx | (via `postgres.rs`) | 5432 | Verified |
| Neon | `neon` | Postgres wire / sqlx | (via `postgres.rs`) | 5432 | Wired |
| H2 | `h2` | Postgres wire / sqlx | (via `postgres.rs`) | 5435 | Wired (experimental) |
| TiDB | `tidb` | MySQL wire / sqlx | (via `mysql.rs`) | 4000 | Wired |
| MongoDB | `mongodb` | document / mongodb | `db/mongo.rs` | 27017 | Verified |
| Neo4j | `neo4j` | Bolt / neo4rs | `db/neo4j.rs` | 7687 | Wired (graph) — see cheatsheet |
| Redis | `redis` | RESP / redis | `db/redis.rs` | 6379 | Wired (adapter) |
| Cassandra | `cassandra` | CQL / scylla driver | `db/cassandra.rs` | 9042 | Wired (adapter) |
| ClickHouse | `clickhouse` | HTTP | `db/clickhouse.rs` | 8123 | Wired (HTTP client) |
| Snowflake | `snowflake` | HTTP | `db/snowflake.rs` | 443 | Wired (password/JWT subset) |
| BigQuery | `bigquery` | HTTP | `db/bigquery.rs` | 443 | Wired (HTTP client) |
| Bigtable | `bigtable` | gRPC/HTTP | `db/bigtable.rs` | 443 | Wired (adapter) |
| InfluxDB | `influxdb` | HTTP (SQL/v3) | `db/influx.rs` | 8086 | Wired (adapter) |
| ScyllaDB | `scylladb` | CQL / scylla driver | (via `cassandra.rs`) | 9042 | Wired (CQL-compatible) |
| QuestDB | `questdb` | Postgres wire / sqlx | (via `postgres.rs`) | 8812 | Wired |

> Maturity is a coverage signal, not a UX guarantee. "Wired (adapter)" means the
> connect/query path exists; first-class browsing, completion, editing,
> explain/profile, and visualization per source remain tracked by SRC tickets.

## 2. Pending (recognized, scaffolded, returns "not ready")

None today. If an adapter has a dedicated `Wire` but intentionally returns a
not-ready error, list it here instead of mixing it with production connectors.

## 3. Recognized, extension required (in the enum, rejected at connect)

These appear in `DbEngine` but `is_unimplemented_wire()` rejects them before a
connection is opened. Most public connector targets ask the user to install
the matching installable connector from `docs/extension-marketplace/index.json`.

| Engine | `DbEngine` id | Family | Closest existing wire | Note |
|---|---|---|---|---|
| Memgraph | `memgraph` | Graph (Bolt/Cypher) | `Neo4j` | Installable connector; can reuse the Neo4j/Bolt path internally. |
| Qdrant | `qdrant` | Vector | — | Installable vector connector extension. |
| Milvus | `milvus` | Vector | — | Installable vector connector extension. |
| Pinecone | `pinecone` | Vector (HTTP) | — | Installable vector connector extension. |
| Cloud Spanner | `cloudSpanner` | Distributed SQL / Google API | `CloudSpanner` | Installable connector; Spanner SQL/catalog handling is separate from Postgres wire. |
| Generic KV Store | `kvStore` | Key-value | `KeyValue` | Installable provider-neutral connector extension for KV systems. |
| Trino / Presto | `trinoPresto` | Federated SQL | `Jdbc` | Installable JDBC-style connector extension. |
| Firebird | `firebird` | Relational | `Jdbc` | Installable JDBC-style connector extension. |
| Databricks / Spark SQL | `databricks` | Warehouse | `Jdbc` | Installable SQL Warehouse connector extension. |
| Elasticsearch | `elasticsearch` | Search | `Search` | Installable search connector extension with index/data-stream workflows. |
| OpenSearch | `openSearch` | Search | `Search` | Installable search connector extension with index/data-stream workflows. |
| Couchbase | `couchbase` | Document | `Document` | Installable document connector extension. |
| DynamoDB | `dynamodb` | Key-value | `KeyValue` | Installable key-value connector extension. |
| ArangoDB | `arangodb` | Graph / multi-model | `Graph` | Installable graph/multi-model connector extension. |
| Apache IoTDB | `iotdb` | Time-series | `TimeSeries` | Installable time-series connector extension. |
| Apache Hive | `hive` | Lakehouse / catalog | `Jdbc` | Installable Hive/Hive Metastore connector extension. |
| Amazon Athena | `athena` | Lakehouse / query-engine | `Lakehouse` | Installable Athena/Glue/workgroup connector extension. |
| Apache Iceberg | `iceberg` | Lakehouse | `Lakehouse` | Installable catalog-backed Iceberg connector extension. |
| AWS S3 Tables | `s3Tables` | Lakehouse | `Lakehouse` | Installable managed Iceberg connector extension. |
| Object stores: S3 / GCS / Azure Blob | `objectStore` | Object-store | `ObjectStore` | Installable object-store browser/source connector extension. |
| Delta Lake | `deltaLake` | Lakehouse | `Lakehouse` | Installable Delta Lake connector extension. |
| Apache Hudi | `hudi` | Lakehouse | `Lakehouse` | Installable Hudi connector extension. |

## 4. Not registered (roadmap intent, not in the engine enum yet)

Named in the public data-source coverage strategy / feature matrix but
**not selectable in the app** — adding any of these starts with a new `DbEngine`
variant + `Wire` + adapter.

All roadmap sources currently promoted into the registry are listed above. Keep this section for future coverage-strategy ideas that are not selectable in the app yet.

## 5. Managed wire-compatible targets

These should not become separate `DbEngine` variants unless they need native API
surface beyond connection templates. They route through existing adapters:

| Target | Route through | Status | Product work |
|---|---|---|---|
| Supabase Postgres | `postgres` | Covered by Postgres wire; needs preset/docs | Direct vs. pooler connection strings, SSL, RLS notes, hosted extensions such as pgvector. |
| Amazon Aurora PostgreSQL | `postgres` | Covered by Postgres wire; needs preset/docs | Writer/reader/custom endpoint hints, IAM auth, cluster topology. |
| Amazon Aurora MySQL | `mysql` | Covered by MySQL wire; needs preset/docs | Writer/reader/custom endpoint hints, IAM auth, cluster topology. |
| Google Cloud SQL for PostgreSQL | `postgres` | Covered by Postgres wire; needs preset/docs | Public/private IP, Auth Proxy, IAM DB auth, SSL cert handling. |
| Google Cloud SQL for MySQL | `mysql` | Covered by MySQL wire; needs preset/docs | Public/private IP, Auth Proxy, IAM DB auth, SSL cert handling. |
| Google Cloud SQL for SQL Server | `sqlserver` | Covered by TDS path; needs preset/docs | Public/private IP, Auth Proxy, SQL Server connection-string guidance. |

## 6. Gaps worth deciding on

- **Vector DBs are extension-first.** Qdrant/Milvus/Pinecone are registry entries
  with marketplace extensions; core still needs the shared vector source-type
  contract for collection/index browsing and similarity-search query surfaces.
- **Memgraph is extension-first.** It speaks Bolt/Cypher like Neo4j; the extension
  can reuse the Neo4j path internally before core promotes it to a wired adapter.
- **ScyllaDB** now rides the existing `cassandra.rs` CQL path; the remaining work is verification against a real ScyllaDB instance and source-specific UX polish.
- **Iceberg/lakehouse** is now extension-first: Apache Iceberg, S3 Tables, Delta
  Lake, Hudi, Hive, and Athena all have marketplace connectors. Core still needs
  shared table/catalog UX and execution-backend contracts for those extensions.

When section 1–4 membership changes, it should be regenerated from the registry,
not hand-edited — see
<https://hjosugi.github.io/irodori-docs/cheatsheet-autodoc-plan.html>.
