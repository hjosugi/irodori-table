# Feature Matrix

This is a seed matrix for roadmap planning. It captures capability goals in our own words and keeps implementation independent. Backlog/status notes mirror `docs/implementation-backlog.md`; "landed" or "implemented" means the scoped backlog item says so, not that every related product workflow is complete.

Legend: P0 = first usable product, P1 = daily-driver quality, P2 = advanced/polish, Later = defer.

| Area | Capability | Priority | Reference Signals / Backlog Status |
| --- | --- | --- | --- |
| Platforms | Windows, macOS, Linux desktop builds | P0 | Tauri, Beekeeper parity goal |
| Platforms | i18n (ja/en) message catalogs | P1 | User requirement |
| Local API | Headless local data API: list sources, query, read tables, safe permissioned write | P2 | API-001/API-002/API-004; user requirement |
| Quality | Automated tests: unit, ephemeral-DB integration, golden bindings, headless UI | P0 | QA release gates; browser smoke landed, full Tauri smoke still tracked |
| Core DBs | SQLite, PostgreSQL | P0 | Minimum vertical slice |
| Core DBs | MySQL/MariaDB, SQL Server | P1 | Backlog P1 daily-driver adapters; keep per-engine parity/status in SRC tickets |
| Core DBs | Oracle Database | P1 | User requirement, A5:SQL, Beekeeper paid support |
| Core DBs | DuckDB | P1 | Backlog SRC-006; embedded analytics and lakehouse execution option |
| Core DBs | YugabyteDB YSQL | P2 | Backlog SRC-005; PostgreSQL-compatible path first, distributed affordances later |
| Core DBs | CockroachDB, ClickHouse, BigQuery, Redshift, Firebird, Trino/Presto, Snowflake, TiDB, Databricks/Spark SQL | P2 | Backlog SRC-007/SRC-011; current distributed SQL, warehouse, and analytics landscape |
| Engines (landed/verified pieces) | PostgreSQL, MySQL, MariaDB, CockroachDB verified against real Docker instances; ClickHouse/BigQuery/Snowflake HTTP clients; MongoDB/Redis/Cassandra adapters; YugabyteDB/Redshift/TimescaleDB/TiDB routed through existing wire drivers; SQLite and DuckDB local paths | P0-P2 | Implementation-progress snapshot only; first-class UX, metadata, auth, and cross-platform contracts remain tracked by SRC tickets |
| Source Families | InfluxDB and time-series sources | P2 | User requirement, InfluxDB 3 SQL/time-series workflows |
| Source Families | Neo4j and graph sources | P2 | User requirement, Neo4j Browser graph workflow |
| Source Families | MongoDB, Redis, Cassandra/ScyllaDB, Couchbase, DynamoDB, Elasticsearch/OpenSearch, ArangoDB, Memgraph | P2 | Modern non-relational client landscape |
| Source Families | Apache Iceberg + lakehouse catalogs (Hive Metastore, Glue, REST, JDBC), AWS S3 Tables | P2 | User requirement, Iceberg prioritized |
| Source Families | Object stores (S3/GCS/Azure), Delta Lake/Hudi later, DuckDB/DataFusion/Trino execution | P2 | Lakehouse expansion |
| Cloud Auth | Snowflake full auth: password, key-pair/JWT, OAuth, external browser/SSO, MFA, PAT | P2 | SRC-011; password/JWT client pieces landed, full auth matrix remains the target |
| Connections | Direct host/port, Unix socket where relevant, local file DBs | P0 | Baseline |
| Connections | SSH tunnel | P1 | Current client baseline |
| Connections | SOCKS5/HTTP CONNECT proxy | P1 | User requirement |
| Connections | Multi-hop proxy chain | P1 | User requirement, differentiator |
| Security | OS keychain-backed secrets | P0 | Baseline safety |
| Security | Privacy/redaction mode | P1 | Screenshare/log safety |
| Performance | Virtualized editor and result-grid rendering | P0 | Large SQL files and large result sets |
| Performance | GPU-aware rendering path with software fallback | P1 | WezTerm-style performance reference |
| Performance | Compare Tauri WebView vs native Rust GUI/GPU surfaces | P0 | Avoid painting ourselves into a slow UI corner |
| Batch Jobs | Long-running job runtime with progress, cancellation, checkpoint/resume, logs, artifacts, and resource budgets | P1 | JOB-001 core runtime + desktop/API model landed; JOB-004 migrates real workflows onto it |
| Batch Jobs | Huge local index construction for knowledge, source, metadata, query-history, and implementation-note search | P1 | JOB-002; required large-workload foundation |
| Baseline | Quickly beat Beekeeper Studio OSS daily-driver workflow | P0 | First competitive checkpoint |
| Baseline | Track Snowsight-style generic database client parity gaps across desktop, local API, and future hosts | P1 | Cross-platform product requirements, not desktop-only widgets; statuses below follow backlog |
| Editor | Run current statement, selection, all statements | P0 | TablePlus, Beekeeper, SQLTools |
| Editor | Cancel running query | P0 | TablePlus-like core workflow |
| Editor | Multiple result sets | P0 | TablePlus/Beekeeper baseline |
| Editor | Query parameters | P1 | Beekeeper, SQLTools |
| Editor | Query history and saved queries | P0 | TablePlus, Beekeeper, SQLTools |
| Editor | Tab folders/groups and named sessions | P1 | User requirement |
| Editor | Arbitrary split panes and persisted layout | P1 | User requirement, TablePlus split panes |
| Editor | Multiple cursors | P1 | Modern editor baseline |
| Editor | SQL formatter hooks | P1 | Current client baseline |
| Editor | Serious Vim mode | P1 | User requirement |
| Keybindings | Fully remappable shortcuts with scopes and conflict UI | P0 | User requirement |
| Keybindings | Presets for TablePlus-like, VS Code-like, JetBrains-like, Vim-heavy | P1 | Power-user adoption |
| Completion | Product-wired schema-aware autocomplete: tables, columns, schemas, keywords | P0 | Desktop editor wired and smoke-tested from live metadata; CMPL-002A remains open for shared service/API parity and broader SQLite/PostgreSQL/MySQL fixtures |
| Completion | Aliases, CTEs, subqueries, functions, procedures | P1 | A5:SQL signal, user requirement |
| Completion | Dialect-aware ranking and insert behavior | P1 | Daily-driver quality |
| Completion | Join suggestions, signatures, generated column lists | P1 | DataGrip-level baseline |
| Completion | Offline deterministic completion without AI | P0 | User requirement |
| Completion | Optional AI assistance | P1 | DataGrip, DBeaver, DbVisualizer, research watchlist; off by default |
| Completion | Copilot-style inline autocomplete and patch suggestions | P1 | AI-004 open; optional/off by default; shared provider/context contract across desktop, MCP-compatible clients, and future hosts |
| AI | Query Magics command layer | P1 | Desktop deterministic baseline landed; command-palette equivalents, audit/history structure, and run-to-file magic remain open |
| AI | AI Shell with local/OpenAI-compatible providers | P1 | Optional privacy-preserving assistance |
| AI | MCP bridge for Copilot-compatible workflows | P1 | AI-003; expose scoped schema/search/explain/query tools instead of desktop-only Copilot coupling |
| AI/ML | ML dataset, evaluation, ranking, and provider/model benchmark pipeline | P1 | JOB-003; ML is required infrastructure, while user-facing AI remains optional/off by default |
| Knowledge | Local SQLite source/fact store | P0 | Implementation and bug-fix memory |
| Knowledge | Automated official-doc/release-note refresh | P1 | Keep DB dialect knowledge current |
| Knowledge | Per-dialect feature extraction | P1 | Completion and compatibility planning |
| Type Bridge | Rust-to-TypeScript generated command/API types | P0 | Prevent Rust/TS drift, keep JSON camelCase |
| Type Bridge | Generated typed Tauri command wrappers | P0 | Safer frontend command usage |
| Type Bridge | Extension SDK type/schema generation | P1 | Easy extension development |
| Browser | Schemas, tables, views, columns, indexes | P0 | Baseline |
| Browser | Functions, procedures, triggers, packages | P1 | Oracle/enterprise needs |
| Results | Virtualized result grid, including wide columns and 1M-row benchmark | P0 | Row, wide-column, and lazy 1M-row virtualization are wired/tested; very-large scrollbar scaling remains future perf hardening |
| Results | Copy, CSV export, multi-column sort, quick/rule filters | P0 | Desktop current-result paths wired; saved/shared/server-side filters remain open under EXEC-005A |
| Results | Advanced filters: multi-column typed predicates, ranges/value lists, saved filter state | P1 | EXEC-005A open; shared filter expression model for desktop, local API, and future hosts |
| Results | Editable result rows with safe transaction flow | P1 | EXEC-007 partial/skeleton; complete inline editing still needs shared permission/capability contracts |
| Results | Run-to-file for huge result sets | P1 | Large data workflow |
| Export | CSV/TSV with header on/off and delimiter/quote control | P0 | User requirement |
| Export | SQL INSERT/UPSERT script export (with/without schema) | P1 | User requirement |
| Export | JSON/NDJSON, Avro, Parquet export | P2 | User requirement |
| Import | CSV/TSV import with mapping and preview | P1 | IO-006 |
| Import | JSON/NDJSON, Avro, Parquet import | P2 | IO-003/IO-004/IO-005 |
| Browser | Hover inspect: type, keys, DDL, comment, row-count, sample | P1 | User requirement |
| Backup | Dialect-aware dump/restore flows | P2 | Current client baseline |
| Connections | Datasource folders/groups and easy inline edit | P1 | User requirement |
| Schema | Table designer for columns/indexes/constraints | P2 | ADV-003 backlog priority; current client baseline benchmark |
| Schema | Explain plan and query profile viewer | P1 | CMPL-007 open; shared explain/profile model for desktop and future hosts |
| Schema | Schema/data compare and migration script generation | P2 | DataGrip/DBeaver/DbVisualizer benchmark |
| Schema | SQL project and DDL-file data source support | P2 | VS Code MSSQL/DataGrip benchmark |
| Themes | Internal theme model | P0 | Consistent UI |
| Themes | VS Code color theme import where license permits | P1 | User requirement |
| Licensing | Irodori-authored code under MIT OR 0BSD | P0 | Familiar and fully free to copy/fork/ship |
| Extensibility | Extension manifest and TypeScript SDK | P1 | Easy extension development |
| Extensibility | Driver/theme/plugin API | P1 | Long-term ecosystem |
| Extensibility | Rust/Wasm extension path | P2 | High-performance add-ons |
| Extensibility | Data-source adapter API for SQL, time-series, graph, document, KV, search, and warehouse sources | P1 | Avoid core-only support bottleneck |
| Visualization | Schema ERD baseline: SVG/PNG image export, multi-schema bands, search/filter, deterministic layout pass | P1 | Implemented baseline; Beekeeper parity and schema comprehension, with visual QA/benchmark coverage still open |
| Visualization | Query-result graph views | P1 | ADV-004D partial; desktop has a basic graph-shaped result renderer, but explicit mappings, saved specs, and usage-oriented graph presets remain open |
| Visualization | Charts, worksheet visualizations, and dashboards from query results | P1 | ADV-004E partial; desktop has current-result bar/line/scatter charting, count/aggregate metrics, sort/limit controls, and an in-app chart window, while saved specs, dashboards, exports, and shared APIs remain open |
| Visualization | Local visualization dataset cache (SPICE-like) | P1 | ADV-004F open; materialize query results into local DuckDB/SQLite/Arrow/Parquet-backed datasets for fast re-aggregation and dashboard reuse |

## Reference Projects In Workspace

- `.irodori-local/ref/beekeeper-studio-master/`: use docs, public behavior, and license-aware OSS code review as a broad SQL GUI baseline. Local `LICENSE.md` says GPLv3-or-later for Community Edition and excludes `src-commercial` under a separate commercial license.
- `.irodori-local/ref/vscode-sqltools-dev/`: use docs, public behavior, and MIT-licensed code review for connection-bound sessions, command workflows, query params, and editor expectations.
- `.irodori-local/ref/vscode-mssql-main/`: use docs, public behavior, and MIT-licensed code review for SQL Server workflows and VS Code integration patterns.
- `.irodori-local/ref/budibase-master/`: lower-priority reference for app-builder style data browsing and admin UI patterns; verify license before code-level adaptation.
- `.irodori-local/ref/duckdb-ui-main/`: MIT-licensed DuckDB UI; reference for local-first analytical exploration and lightweight in-process data browsing. MIT permits code-level adaptation with attribution and license tracking.
- `.irodori-local/ref/kibana-main/`: source-available under Elastic License 2.0 / SSPL / AGPL-3.0; reference Discover and Dev Tools console behavior only — do not adapt code into the permissive core.
- `zed-industries/zed` (GitHub, not in `.irodori-local/ref/`): copyleft (GPL-3.0/AGPL-3.0 with some Apache-2.0 crates); study Rust desktop architecture, GPUI rendering, and input latency — learning only, no copyleft code in the core.
- `outerbase/studio` (GitHub, AGPL-3.0): lightweight web/Electron DB GUI (SQLite/Turso/D1, beta MySQL/PostgreSQL); reference for a staged-edit data grid, no-SQL schema editor, function-hint completion, and large-table rendering. Copyleft — behavior/architecture only, no code in the core.
- `.irodori-local/ref/dbeaver-ce` (Apache-2.0): the universal-DB benchmark (200+ engines); reference for a data-driven driver registry, generic+override metamodel, precision-safe value handlers, lazy metadata, and per-engine SQL dialects. Permissive — adaptable with attribution (avoid its 2 EPL files).
- `zequel-labs/zequel` (Elastic License 2.0): Electron/Vue client; reference for a virtual-scrolled in-cell-edit grid, ER diagrams, and broad engine + import/export coverage. Source-available — behavior only.

Do not copy implementation from these directories into Irodori Table unless license compatibility, attribution, and adaptation scope are explicit.

Current market/research scan:

- `docs/db-client-market-scan-2026-06-21.md`
- `docs/completion-and-ai-strategy.md`
- `docs/knowledge-base.md`
- `docs/data-source-coverage-strategy.md`
- `docs/type-bridge-handoff.md`
