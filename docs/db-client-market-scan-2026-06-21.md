# DB Client Market Scan

Last checked: 2026-06-21 JST.

This scan uses public product documentation and official pages where possible. It is a roadmap input, not a code-copying guide.

## Products To Track Closely

### TablePlus

Use TablePlus as the interaction benchmark: quick query editor access, run-current/run-all behavior, query cancellation, split panes, result tabs, history, keymap, and a compact object browser. Public docs show autocomplete for databases, tables, keywords, and columns, with options for schema prefixing and keyword casing.

Sources:

- https://docs.tableplus.com/query-editor/untitled
- https://docs.tableplus.com/query-editor/autocomplete

### DataGrip

Use DataGrip as the deep SQL IDE benchmark. Its strongest signals are schema-aware completion, inspections, quick fixes, refactoring, formatter customization, query history, parameterized queries, schema diff, data compare, Git integration, customizable keymaps, and optional AI assistance that understands database console context.

Sources:

- https://www.jetbrains.com/datagrip/features/
- https://www.jetbrains.com/help/datagrip/ai-assistant.html

### DBeaver

Use DBeaver as the broad database-coverage and enterprise-tooling benchmark. Strong signals: 100+ data sources, data editor, SQL editor, admin tools, visual query builder, data transfer, data compare, network/security configuration, AI chat/MCP direction, CLI tooling, and query execution-plan support.

Sources:

- https://dbeaver.com/
- https://dbeaver.com/docs/dbeaver/SQL-Editor/

### DbVisualizer

Use DbVisualizer as the mature cross-platform SQL workflow benchmark. Strong signals: context-aware autocomplete, SQL formatting, visual query builder, reusable variables/bookmarks, explain plans, inline editing, export formats, Git/version-control workflow, command-line execution, monitoring, SSH/security, and optional opt-in AI.

Sources:

- https://www.dbvis.com/features/
- https://www.dbvis.com/features/sql-editor/

### Snowsight / Snowflake Workspaces

Use Snowsight and Workspaces as the cloud-warehouse analysis benchmark, not as a claim that Irodori matches Snowflake feature-for-feature. Strong reference signals: workspace-based SQL editing, interactive result statistics and filters, query profile inspection, dashboards/charts from query results, and Snowflake Copilot inline assistance. Irodori gaps to track across platforms: user-facing schema/table/column autocomplete is not product-wired beyond keyword completion, optional Copilot-style inline suggestions are not implemented, the shared chart/dashboard model is open P1 work, explain/query profile is open P1 work, inline result editing is partial/skeleton, and advanced filters are not implemented beyond current single-column sort.

Sources:

- https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces-working
- https://docs.snowflake.com/en/user-guide/ui-snowsight-dashboards
- https://docs.snowflake.com/en/user-guide/ui-snowsight-activity
- https://docs.snowflake.com/en/user-guide/snowflake-copilot-inline

### VS Code MSSQL Extension

Azure Data Studio is retired as of 2026-02-28, and Microsoft points users to VS Code with the MSSQL extension. This makes VS Code-style workflows important: source control, CI/CD, schema compare/designer, query execution, database projects, notebooks, and GitHub Copilot integration.

Sources:

- https://learn.microsoft.com/en-us/sql/tools/whats-happening-azure-data-studio

## Source-Specific Products To Track

### Neo4j Browser / Workspace / Query

Use Neo4j tooling as the graph database benchmark. Strong signals: Cypher-first editor, table and graph result modes, node/relationship visualization, labels, relationship types, property inspection, procedures, constraints, indexes, and a workflow that does not pretend graph data is just rows.

Sources:

- https://neo4j.com/docs/browser/
- https://neo4j.com/docs/cypher-manual/current/

### InfluxDB UI / Data Explorer

Use InfluxDB as the time-series benchmark. Strong signals: time range ergonomics, measurements/tables, fields/tags, bucket/database selection, aggregate and selector functions, SQL for InfluxDB 3, downsampling, windowing, and result previews that stay fast over large ranges.

Sources:

- https://docs.influxdata.com/influxdb3/core/query-data/sql/
- https://docs.influxdata.com/influxdb3/core/reference/client-libraries/v3/

### YugabyteDB Tools

Use YugabyteDB as the distributed PostgreSQL-compatible benchmark. Start with YSQL behavior, then track distributed-specific capabilities such as topology, tablets, follower reads, xCluster, connection pooling, query diagnostics, and region/placement metadata.

Sources:

- https://docs.yugabyte.com/stable/api/ysql/
- https://docs.yugabyte.com/stable/explore/ysql-language-features/

### MongoDB Compass / Studio 3T

Use document database tools as references for JSON document editing, aggregation pipeline authoring, explain plans, schema sampling, index workflows, safe bulk edits, import/export, and collection-level browsing.

Sources:

- https://www.mongodb.com/products/tools/compass
- https://studio3t.com/

### RedisInsight

Use RedisInsight as the key-value and module-aware workflow benchmark: key browser, command workbench, TTL/type visibility, streams, JSON/search/vector/module features, and safe editing for production caches.

Sources:

- https://redis.io/insight/

### DbGate And Other OSS Clients

Track DbGate, SQLTools, HeidiSQL, SQuirreL SQL, OmniDB, and pgAdmin as practical OSS or partly OSS references for everyday workflows, extension models, and database coverage. Verify license compatibility before any code-level adaptation.

Sources:

- https://dbgate.org/
- https://www.pgadmin.org/

## Platform, Editor, And Tooling References

These are implementation inputs rather than product parity targets.

- Tauri v2 remains the default desktop shell candidate because Rust can own local
  work while the UI stays portable.
- CodeMirror 6 is the accepted editor host. Tree-sitter remains the semantic
  parsing layer to evaluate per dialect for outline, selection, and completion
  context; SQL grammar quality varies by dialect.
- VS Code theme import should normalize workbench colors, TextMate scopes, and
  semantic token colors into Irodori's internal theme model.
- WezTerm, Zed, Lapce, and Helix are performance references for startup time,
  input latency, modal editing, and large-document handling. Zed is copyleft, so
  use it for architecture study only.
- PostgREST and DuckDB's httpserver extension are local-data-API references.
  Irodori's server remains read-only by default and reuses the adapter/security
  model.
- `ts-rs`, `specta`, `typeshare`, and `schemars` are type-generation references.
  Irodori consumes the published `typeship` crates documented in
  `type-bridge-handoff.md`.
- `oracle-rs`, JDBC Thin, and python/node-oracledb thin modes are the Oracle
  no-Instant-Client precedents. Irodori keeps Oracle thin-first and records
  packaging decisions separately.
- GitHub Copilot's MCP support is the safer integration shape for future
  AI-assisted workflows: expose scoped schema/search/explain/query tools rather
  than coupling the desktop UI to one provider.

## Paper Watchlist

- Text-to-SQL survey work is relevant to schema linking, database-content
  retrieval, and prompt/context construction for large schemas.
- SQL issue-debugging and query-repair research is relevant to optional
  assistance, but AI features must stay opt-in, auditable, redacted, and
  permission-scoped.

## What Modern DB Clients Are Expected To Do

- Start fast, stay responsive, and handle huge result sets without UI stalls.
- Support Windows, macOS, and Linux with the same core behavior.
- Provide a compact workbench: connection list, object browser, editor, result grid, history, and command palette.
- Offer excellent keyboard control, remappable keymaps, and real Vim mode.
- Provide deterministic schema-aware completion before any AI feature exists; desktop schema/table/column suggestions are now wired and browser-tested, while the shared completion contract for local API/future hosts remains open.
- Browse and edit data safely, with transactions, generated DML, row diff, copy/export, and undo/preview where possible.
- Handle query execution well: current statement, selection, whole script, cancellation, multiple result sets, parameters, history, saved scripts, and run configurations.
- Support introspection beyond tables: schemas, views, indexes, constraints, functions, procedures, triggers, packages, sequences, materialized views, and dialect-specific objects.
- Include explain plans, SQL formatting, diagnostics, quick fixes, and query profiling where the database supports it.
- Support import/export/data transfer, including CSV/JSON/Excel/Markdown and large run-to-file workflows.
- Support secure connections: OS keychain, SSH, SSL/TLS, cloud auth, proxies, proxy chains, network profiles, and redaction/privacy mode.
- Support project workflow: SQL files, connection-bound sessions, folders/tab groups, Git, CLI automation, and extension APIs.
- Support non-relational source families without turning every source into a fake table-only UI: graph result views for graph databases, time-range/frame workflows for time-series, document editors for document stores, key browsers for KV engines, and native query-language completion everywhere.

## Irodori Differentiation

- Be lighter and faster than Java/Electron-era clients.
- Make keyboard and Vim behavior first-class instead of a preference-page afterthought.
- Treat Oracle as first-class early.
- Treat YugabyteDB, InfluxDB, and Neo4j as required architecture inputs, not late plugins glued onto a SQL-only core.
- Support nested proxy chains as a core model.
- Make the extension SDK simple enough that drivers, result renderers, themes, AI providers, and proxy transports are easy to build.
- Make AI optional and private by default; deterministic completion must remain excellent offline. Query Magics now have a deterministic desktop baseline and should keep expanding as local commands, while AI Shell remains open work and should only propose text or use explicitly scoped read-only tools.
