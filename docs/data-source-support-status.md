# Data Source Support Status

Last generated: 2026-06-26 JST (hand-authored seed; target is auto-generation —
see `docs/cheatsheet-autodoc-plan.md`).

This is the single inventory of **what Irodori connects to today vs. what is
declared, planned, or not yet started**. The authoritative source of truth is the
`DbEngine` registry in `apps/desktop/src-tauri/src/db/engine.rs` and the connect
dispatch in `apps/desktop/src-tauri/src/db.rs`. Roadmap intent lives in
`docs/data-source-coverage-strategy.md` and `docs/feature-matrix.md`; this file
reconciles intent against the code.

For contract/provisioning and managed-service verification procedures, see
`docs/external-db-contract-and-verification.md`.

Status legend:

- **Wired** — has a production connect path and a dedicated adapter or a
  wire-compatible adapter it routes through.
- **Verified** — Wired *and* exercised against a real instance in
  `tests/integration_db.rs` through the sample harness (`make db-verify`).
- **Pending** — recognized by the engine enum, adapter scaffolding exists, but the
  connector intentionally returns a "not ready" result.
- **Recognized, no connector** — present in `DbEngine` but rejected at connect by
  `is_unimplemented_wire()` (`"recognized but does not have a production connector
  yet"`).
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

## 3. Recognized, no connector (in the enum, rejected at connect)

These appear in `DbEngine` but `is_unimplemented_wire()` rejects them with
*"`<Engine>` is recognized but does not have a production connector yet."*

| Engine | `DbEngine` id | Family | Closest existing wire | Note |
|---|---|---|---|---|
| Memgraph | `memgraph` | Graph (Bolt/Cypher) | `Neo4j` | Should largely reuse the Neo4j/Bolt path; just needs wiring + verification. |
| Qdrant | `qdrant` | Vector | — | Vector family has no adapter yet. |
| Milvus | `milvus` | Vector | — | Vector family has no adapter yet. |
| Pinecone | `pinecone` | Vector (HTTP) | — | Vector family has no adapter yet. |
| Trino / Presto | `trinoPresto` | Federated SQL | `Jdbc` | JDBC-style connector not implemented yet. |
| Firebird | `firebird` | Relational | `Jdbc` | JDBC-style connector not implemented yet. |
| Databricks / Spark SQL | `databricks` | Warehouse | `Jdbc` | JDBC-style connector not implemented yet. |
| Elasticsearch / OpenSearch | `elasticsearch` | Search | `Search` | Search connector and index/data-stream browser are not implemented yet. |
| Couchbase | `couchbase` | Document | `Document` | Document connector not implemented yet. |
| DynamoDB | `dynamodb` | Key-value | `KeyValue` | Key-value connector not implemented yet. |
| ArangoDB | `arangodb` | Graph / multi-model | `Graph` | Graph/multi-model connector not implemented yet. |
| Apache IoTDB | `iotdb` | Time-series | `TimeSeries` | Time-series connector not implemented yet. |
| Apache Hive | `hive` | Lakehouse / catalog | `Jdbc` | Catalog/metastore model is still pending. |
| Apache Iceberg | `iceberg` | Lakehouse | `Lakehouse` | Priority lakehouse target; catalog-backed model is still pending. |
| AWS S3 Tables | `s3Tables` | Lakehouse | `Lakehouse` | Managed Iceberg connector not implemented yet. |
| Object stores: S3 / GCS / Azure Blob | `objectStore` | Object-store | `ObjectStore` | Object browser/source connector not implemented yet. |
| Delta Lake | `deltaLake` | Lakehouse | `Lakehouse` | Lakehouse connector not implemented yet. |
| Apache Hudi | `hudi` | Lakehouse | `Lakehouse` | Lakehouse connector not implemented yet. |

## 4. Not registered (roadmap intent, not in the engine enum yet)

Named in `docs/data-source-coverage-strategy.md` / `docs/feature-matrix.md` but
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

- **Vector DBs are half-declared.** Qdrant/Milvus/Pinecone are enum variants with
  no adapter and no UI requirements in the coverage strategy. Either commit a
  vector source-type contract (collection/index browser, similarity-search query
  surface) or drop them from the enum until scoped.
- **Memgraph is the cheapest win.** It speaks Bolt/Cypher like Neo4j; promoting it
  from "recognized, no connector" to "Wired" is mostly routing `Wire::Memgraph`
  through the Neo4j adapter plus a verification container.
- **ScyllaDB** now rides the existing `cassandra.rs` CQL path; the remaining work is verification against a real ScyllaDB instance and source-specific UX polish.
- **Iceberg/lakehouse** is the largest unstarted area and the stated P2 priority;
  it needs a catalog-backed connection model, not just a wire. Apache Iceberg and
  Amazon S3 Tables should be modeled as table/catalog sources with execution
  backends, not as normal SQL engines.

When section 1–4 membership changes, it should be regenerated from the registry,
not hand-edited — see `docs/cheatsheet-autodoc-plan.md`.
