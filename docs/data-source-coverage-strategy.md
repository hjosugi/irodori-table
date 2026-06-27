# Data Source Coverage Strategy

Last checked: 2026-06-21 JST.

Irodori Table should become a general high-performance database workbench, not only a SQL table browser. SQL databases stay the first vertical slice, but the architecture must allow distributed SQL, time-series, graph, document, key-value, search, warehouse, and local embedded sources.

## Direction

The core abstraction should be `data source adapter`, not just `SQL driver`.

Each adapter declares:

- connection profile schema;
- transport needs, including direct, TLS, SSH, SOCKS/HTTP, and proxy chains;
- query language and parser strategy;
- introspection model;
- result shapes: table, document, graph, time-series frame, key-value set, stream, or binary/file;
- editable operations and safety rules;
- completion providers;
- explain/profile support;
- import/export capabilities.

The UI should keep one familiar workbench while changing the specialized panes per source type. Snowsight-style parity gaps must be designed as shared product capabilities, not as desktop-only widgets: schema-aware autocomplete, optional Copilot-style inline help/MCP, explain/query profile, advanced filters, inline editing, query-result graph views, and charts/dashboards need reusable contracts that desktop, local API, and future hosts can share.

## Coverage Tiers

### P0: First Usable Core

- SQLite
- PostgreSQL

These prove connection management, editor execution, object browser, result grid, history, keybindings, themes, and command palette.

### P1: Daily Driver SQL And Enterprise

- MySQL/MariaDB
- SQL Server
- Oracle Database
- DuckDB

This tier stays focused on daily-driver relational workflows and enterprise SQL coverage. DuckDB is included early because it doubles as a local analytics engine and lakehouse execution option. Wire-compatible or partially landed adapters can exist before this tier is complete, but first-class source UX remains tracked by the backlog ticket for each source.

Oracle is a roadmap non-negotiable, so its connection story must be as easy as the rest. The target is a **thin driver**: a pure-Rust implementation of the Oracle Net/TNS protocol that needs no Oracle Instant Client — the same approach that makes A5:SQL Mk-2's "direct connection" mode (and the JDBC Thin / python-oracledb thin / node-oracledb thin drivers) client-free. The user supplies a connection descriptor (host/port/service), not a `tnsnames.ora` plus a client install.

- Primary path: inherit and harden the permissively licensed `oracle-rs` crate (MIT/Apache-2.0, pure Rust, Tokio, TLS/Wallet) rather than writing the TNS stack from scratch. It is young (v0.1; many enterprise features still "planned"), so a spike (SRC-004a) must validate it against real Oracle 19c/23ai before Oracle becomes first-class. This may grow into its own crate/sub-project, like the type bridge.
- Clean-room note: A5:SQL Mk-2 is closed source (the author's GitHub confirms it is not public) and its direct mode uses the commercial UniDAC component, so we study the *approach* (thin TNS), never A5/UniDAC code. `oracle-rs` is permissive and may be adapted with attribution.
- Optional fallback: thick OCI via the ODPI-C `oracle` crate behind a build feature, for environments that already have the Instant Client and need full OCI features.

### P2: Broader Modern Workloads

- InfluxDB and other time-series engines
- Neo4j and graph databases
- YugabyteDB YSQL
- CockroachDB
- Cassandra/ScyllaDB and wide-column stores
- ClickHouse
- BigQuery
- Snowflake
- Redshift
- Trino/Presto
- Firebird
- Elasticsearch/OpenSearch
- Couchbase
- DynamoDB
- TiDB
- Databricks/Spark SQL
- Apache Hive
- Apache IoTDB
- QuestDB
- TimescaleDB
- ArangoDB
- Memgraph
- Redis
- MongoDB

YugabyteDB should start through its PostgreSQL-compatible YSQL surface, then add distributed-database affordances such as tablets, regions, follower reads, query diagnostics, xCluster, and node/session visibility where public APIs allow it.

MongoDB, Redis, Cassandra, CockroachDB, ClickHouse, BigQuery, Snowflake, and wire-compatible engines may have landed adapter pieces before the full source experience is done. Treat those as implementation progress snapshots, not completion of native browsing, editing, completion, explain/profile, visualization, or cross-platform contracts.

### Priority Within P2: Lakehouse And Cloud Warehouse Auth

- Apache Iceberg is the priority lakehouse target. Reach it through catalogs — Hive Metastore, AWS Glue, REST, and JDBC — and through AWS S3 Tables. Treat object stores (S3, GCS, Azure Blob) as first-class connection backends.
- Execution options: embeddable engines (DuckDB, Apache DataFusion) for local reads, or Trino/Presto and warehouse-native engines for pushdown. Add Delta Lake and Apache Hudi after Iceberg.
- Snowflake needs full authentication coverage, not just password: key-pair (JWT), OAuth, external-browser/SSO, MFA/passcode, and programmatic access tokens, with warehouse/role/database context switching.
- Apache Hive stays in scope mainly as a catalog/metastore source for Iceberg and legacy warehouses.
- Elasticsearch/OpenSearch are the first search sources. Treat them as a deep source family, not a thin REST endpoint, because current general DB clients are weak here. Study Kibana Discover and Dev Tools console for behavior: data views, index/data-stream browsing, mappings and field capabilities, filter/query composition, saved searches, request history, explain/profile, shard/index health cues, and JSON/ES|QL-style authoring. Kibana is a behavior-only reference because it is source-available under Elastic License 2.0 / SSPL / AGPL.

### Managed Wire-Compatible Targets

Some hosted services should be supported as connection templates over existing
adapters instead of adding duplicate engine variants:

- Supabase Postgres routes through the PostgreSQL adapter. Product work is around
  direct vs. pooler connection strings, SSL, RLS-aware docs, hosted extension
  discoverability, and connection-limit guidance.
- Amazon Aurora routes through PostgreSQL or MySQL depending on cluster engine.
  Product work is around writer/reader/custom endpoint guidance, IAM auth,
  cluster topology, serverless scaling context, and AWS Performance Insights links.
- Google Cloud SQL routes through PostgreSQL, MySQL, or SQL Server. Product work
  is around public/private IP, Cloud SQL Auth Proxy, IAM database auth, SSL certs,
  and instance metadata.

### Shared Visual Model, Heavy Consoles Later

- P1 shared query-result graph, chart, worksheet visualization, and dashboard definition model (open; not implemented). Plan the serializable model/API early enough to shape result frames, filters, saved queries, exports, and extension visualizers across desktop, local API, and future hosts.
- Advanced ERD analysis/authoring beyond the current schema ERD baseline.
- Full graph exploration workspace beyond query-result graph visualization.
- BI-dashboard polish beyond the shared result-to-visualization model.
- Long-running monitoring consoles.
- Admin dashboards for every distributed engine.

These are valuable, but they should not delay the editor, completion, result handling, connection, proxy, source-adapter, and extension foundations. The visual/dashboard model is early product architecture; heavy managed/admin console coverage is later product depth.

## Source-Type UI Requirements

### Relational And Distributed SQL

- SQL editor with dialect-aware completion. Desktop schema/table/column completion is wired from live metadata; shared completion service/API parity and broader per-engine fixtures remain a P0 cross-platform gap.
- Object browser for databases, schemas, tables, views, indexes, constraints, routines, triggers, packages, extensions, and jobs.
- Result grid with streaming, cancellation, copy/export, safe editing, advanced filters, and explain/profile. Inline editing is partial/skeleton today, advanced filters are not implemented, and explain/query profile is open P1 work.
- Distributed SQL add-ons: regions, replicas, shards/tablets/ranges, session/lock insight, follower reads, consistency notes, and topology-aware warnings.

### Time-Series

- SQL or native query editor, depending on the engine.
- Time range picker bound to query templates without forcing dashboard-first UX.
- Result table plus time-series frame model.
- Fast downsampling/preview for huge ranges.
- Retention policy, bucket/measurement/table, tag/field, and partition browser.
- Query helpers for windows, aggregates, selectors, gap filling, derivative/difference, and calendar-aware grouping.

InfluxDB 3 should be treated as a first-class time-series source with SQL support, not as a generic PostgreSQL clone.

### Graph

- Cypher or native graph query editor.
- Schema/introspection for labels, relationship types, properties, constraints, indexes, procedures, and functions.
- Results can be table, graph, path, scalar, or mixed records.
- Graph visualization starts with query-result graph rendering; full graph workspace features can come later.
- Completion must understand labels, relationship types, variables, path patterns, procedures, and property keys.

Neo4j should be the first graph benchmark because Neo4j Browser defines a common developer expectation: write Cypher, run queries, view tabular results, and visualize node/relationship results.

### Document, KV, And Search

- Query/editor surface for native syntax and JSON-like pipelines.
- Collection/keyspace/index browser.
- Document viewer/editor with patch preview.
- Safe bulk edit flow and export.
- Completion for fields, operators, aggregation stages, commands, and index names.

## Research Targets

Track both database-specific tools and broad clients:

- TablePlus, A5:SQL Mk-2, DataGrip, DBeaver, DbVisualizer, Beekeeper Studio, DbGate, SQLTools, VS Code MSSQL, pgAdmin, MySQL Workbench, Oracle SQL Developer, SSMS, HeidiSQL, SQuirreL SQL, OmniDB, PopSQL.
- MongoDB Compass, Studio 3T, RedisInsight, Neo4j Browser, Neo4j Workspace/Query, InfluxDB UI/Data Explorer, ArangoDB Web UI, Couchbase Capella UI, Cassandra/ScyllaDB tools, Grafana data-source workflows.

Use these products to identify expected behavior, not to copy protected expression.

## Official Sources To Track

- YugabyteDB docs and release notes: https://docs.yugabyte.com/
- YugabyteDB YSQL API: https://docs.yugabyte.com/stable/api/ysql/
- InfluxDB 3 SQL docs: https://docs.influxdata.com/influxdb3/core/query-data/sql/
- InfluxDB 3 client libraries: https://docs.influxdata.com/influxdb3/core/reference/client-libraries/v3/
- Neo4j Browser docs: https://neo4j.com/docs/browser/
- Neo4j Cypher docs: https://neo4j.com/docs/cypher-manual/current/
- DBeaver supported database list: https://dbeaver.com/databases/
- DataGrip feature reference: https://www.jetbrains.com/datagrip/features/
- Apache Iceberg spec and REST catalog: https://iceberg.apache.org/spec/ and https://iceberg.apache.org/concepts/catalog/
- AWS S3 Tables (managed Iceberg): https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables.html
- Snowflake authentication options: https://docs.snowflake.com/en/user-guide/admin-security-fed-auth-overview and https://docs.snowflake.com/en/user-guide/key-pair-auth
- DuckDB SQL and extensions (incl. Iceberg/Parquet): https://duckdb.org/docs/

Add these to `knowledge/sources.json` so future implementation and bug fixes can query a local snapshot.

## Design Guardrails

- Do not force non-SQL data into a fake relational model.
- Do not make graph and time-series support depend on dashboard/visualization features.
- Keep every source keyboard-first: editor, command palette, object browser, result focus, history, and quick open.
- Make adapters extension-friendly so uncommon databases do not require core releases forever.
- Keep protocol and driver choices swappable; some sources will use native Rust clients, some JDBC/ODBC bridges, some HTTP APIs, and some official CLIs or cloud APIs.
- Preserve the same security model across all sources: keychain secrets, proxy chains, TLS, privacy mode, audit-friendly logs, and permission-scoped extensions.
