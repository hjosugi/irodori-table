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

The UI should keep one familiar workbench while changing the specialized panes per source type.

## Coverage Tiers

### P0: First Usable Core

- SQLite
- PostgreSQL

These prove connection management, editor execution, object browser, result grid, history, keybindings, themes, and command palette.

### P1: Daily Driver SQL And Enterprise

- MySQL/MariaDB
- SQL Server
- Oracle Database
- YugabyteDB YSQL
- CockroachDB
- DuckDB
- Redis
- MongoDB

YugabyteDB should start through its PostgreSQL-compatible YSQL surface, then add distributed-database affordances such as tablets, regions, follower reads, query diagnostics, xCluster, and node/session visibility where public APIs allow it.

### P2: Broader Modern Workloads

- InfluxDB and other time-series engines
- Neo4j and graph databases
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

### Later: Specialized/Managed And Visual Heavy Features

- BI-style dashboards
- ERD and graph exploration beyond query-result visualization
- long-running monitoring consoles
- admin dashboards for every distributed engine

These are valuable, but they should not delay the editor, completion, result handling, connection, proxy, and extension foundations.

## Source-Type UI Requirements

### Relational And Distributed SQL

- SQL editor with dialect-aware completion.
- Object browser for databases, schemas, tables, views, indexes, constraints, routines, triggers, packages, extensions, and jobs.
- Result grid with streaming, cancellation, copy/export, safe editing, and explain/profile.
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

Add these to `knowledge/sources.json` so future implementation and bug fixes can query a local snapshot.

## Design Guardrails

- Do not force non-SQL data into a fake relational model.
- Do not make graph and time-series support depend on dashboard/visualization features.
- Keep every source keyboard-first: editor, command palette, object browser, result focus, history, and quick open.
- Make adapters extension-friendly so uncommon databases do not require core releases forever.
- Keep protocol and driver choices swappable; some sources will use native Rust clients, some JDBC/ODBC bridges, some HTTP APIs, and some official CLIs or cloud APIs.
- Preserve the same security model across all sources: keychain secrets, proxy chains, TLS, privacy mode, audit-friendly logs, and permission-scoped extensions.
