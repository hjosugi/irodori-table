# Irodori Table Roadmap

Irodori Table aims to be a fast, open-source, cross-platform SQL GUI for people who live in databases all day. The north star is TablePlus-level lightness and directness, with the openness, keyboard control, dialect coverage, and automation depth that current clients still miss.

## Non-Negotiables

- Rust-first core with a Tauri desktop shell for Windows, macOS, and Linux.
- Irodori-authored code is dual-licensed as `MIT OR 0BSD` by default so users can choose familiar MIT terms or the almost-no-conditions 0BSD path.
- First-class SQL databases from the start: PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, and Oracle Database.
- Architecture must grow beyond classic SQL: YugabyteDB/distributed SQL, InfluxDB/time-series, Neo4j/graph, document, key-value, search, warehouse, and local embedded sources should fit through adapter contracts instead of one-off UI forks.
- A reference policy that separates proprietary clean-room study from license-compatible OSS code study. OSS code can inform implementation when license, attribution, and compatibility are explicit.
- Rust types remain idiomatic `snake_case`, JSON/TypeScript boundaries use `camelCase`, and command/extension payloads are generated from Rust instead of duplicated by hand.
- Fully remappable keybindings, plus preset maps for TablePlus-like, VS Code-like, JetBrains-like, and Vim-heavy workflows.
- Serious Vim mode: normal/insert/visual modes, counts, registers, macros, marks, text objects, search, command-line mode, custom mappings, and predictable editor integration.
- Schema-aware completion that understands dialect, aliases, CTEs, subqueries, functions, procedures, parameters, and recent user context.
- Deterministic completion must be excellent offline; AI completion is optional, provider-based, and never a requirement for the core editor experience.
- Connection through direct sockets, SSH tunnels, SOCKS/HTTP proxies, and ordered multi-hop proxy chains.
- Organized editor workspace: tab groups/folders, named sessions, connection-bound editors, arbitrary panes, persisted layouts.
- VS Code-compatible theme ingestion where possible, with an internal normalized theme model.
- GPU-aware rendering for hot paths such as editor text, result grids, scrolling, selection, and pane redraws, with a reliable CPU/software fallback.
- Bounded-memory result handling: stream rows (never buffer whole result sets), cap pages by default, and offer optional disk offload so huge results never exhaust RAM the way some clients do. Add automatic parallelism (chunked fetch, parallel introspection/export) for large workloads.
- Extension development is first-class: documented manifest, typed APIs, local dev mode, capability-scoped permissions, and `MIT OR 0BSD` official templates.
- Current product research is tracked continuously so Irodori learns from highly rated clients without cloning their protected expression.
- A local SQLite knowledge base stores official DB specs, release notes, product research, AI integration notes, and implementation facts for future features and bug fixes.
- World-class SQL editing is a north star: the editor surface aims to beat current clients on writing speed, navigation, refactoring, and feedback, not merely match them.
- Export and import are first-class and format-rich: CSV/TSV with header on/off and delimiter control, SQL INSERT/UPSERT scripts, JSON/NDJSON, and Avro/Parquet, with easy dump/restore per dialect.
- Lakehouse and table formats are in scope: Apache Iceberg is the priority target, reachable through standard catalogs (Hive Metastore, AWS Glue, REST) and AWS S3 Tables, with object stores treated as first-class.
- A headless local data API is supported: Irodori can run a local server to read and safely edit table data over HTTP for scripting, tests, and external tools.
- Bilingual from early: ja/en localization (i18n) is built in, not bolted on.
- Automated testing is first-class: unit, ephemeral-database integration, generated-binding golden checks, and headless UI smoke tests run in CI.
- Hover-to-inspect everywhere: schemas, objects, and columns reveal type, keys, DDL, comments, and a quick sample without leaving the editor.

## Reference Surface

- TablePlus: interaction speed, query/editor ergonomics, shortcut feel, object browser expectations, and lightweight mental model.
- A5:SQL Mk-2: Oracle-aware workflows, SQL completion depth, explain plans, query design ideas, ERD as a later-stage reference.
- Beekeeper Studio: first client to beat quickly. Use it as an OSS baseline for feature coverage, but surpass it on speed, keyboard control, Vim depth, proxy chains, Oracle priority, and completion.
- DataGrip: deep SQL IDE benchmark for inspections, refactoring, schema-aware completion, diff/compare, Git, keymaps, and optional AI.
- DBeaver and DbVisualizer: broad database coverage, data transfer, admin/security, AI/MCP direction, CLI, and enterprise workflow benchmarks.
- DbGate, pgAdmin, MySQL Workbench, Oracle SQL Developer, SSMS, HeidiSQL, SQuirreL SQL, OmniDB, PopSQL: additional workflow and coverage references.
- MongoDB Compass, Studio 3T, RedisInsight, Neo4j Browser/Workspace/Query, InfluxDB UI/Data Explorer, ArangoDB Web UI, Couchbase UI, Grafana data-source workflows: source-specific GUI references for document, KV, graph, time-series, multi-model, and observability-oriented workflows.
- VS Code MSSQL extension: important replacement-path benchmark now that Azure Data Studio is retired.
- VS Code SQLTools and vscode-mssql: session-to-connection binding, command-driven workflows, result handling, driver boundaries, and editor integration patterns.
- Current DB clients broadly: DBeaver, DataGrip, VS Code MSSQL, SSMS, Oracle SQL Developer, pgAdmin, MySQL Workbench, HeidiSQL, DB Browser for SQLite.
- DuckDB and DuckDB UI (`ref/duckdb-ui-main`, MIT): embedded analytical SQL, local-first exploration, Parquet/Iceberg reads, and a lightweight in-process UI; MIT lets us adapt code with attribution and license tracking.
- Kibana (`ref/kibana-main`, Elastic License 2.0 / SSPL / AGPL-3.0 — source-available): Discover data exploration and Dev Tools console as a search/observability query-and-browse reference; behavior-only, no code adaptation into the permissive core.
- Zed (`zed-industries/zed`, GPL-3.0/AGPL-3.0 with some Apache-2.0 crates — copyleft): a fast Rust-native desktop editor; reference for GPUI rendering, input latency, multibuffer/pane models, and Rust app structure. Study architecture; do not copy copyleft code into the core.
- Fast Rust desktop apps broadly (Zed, WezTerm, Lapce, Helix): performance and architecture references for startup time, rendering, and large-document handling.

## Architecture Direction

- Desktop shell: Tauri v2, with Rust commands for privileged/local work and a web UI for editor and layout.
- Core crates:
  - `irodori-core`: connection model, workspace model, command registry, keybinding resolver.
  - `irodori-data-sources`: per-source adapters behind stable traits for SQL, time-series, graph, document, KV, search, cloud warehouse, and local embedded engines.
  - `irodori-proxy`: direct, SSH, SOCKS/HTTP, and multi-hop transport composition.
  - `irodori-secure-store`: OS keychain integration and encrypted local config.
- Supporting crates:
  - `irodori-typebridge`: Rust-to-TypeScript command/API generation so Serde `camelCase` JSON and frontend types never drift.
  - `irodori-sql`: dialect metadata, parser hooks, introspection cache, formatter/linter adapters.
  - `irodori-graph`: Cypher/graph metadata, result graph model, and graph-completion hooks.
  - `irodori-timeseries`: time range model, frame/downsampling model, and time-series query helper hooks.
  - `irodori-completion`: parser-aware deterministic completion, ranking, snippets, signature help, and optional provider hooks.
  - `irodori-ai`: opt-in AI provider abstraction, local model support, audit log, redaction, and MCP bridge.
  - `irodori-knowledge`: local SQLite-backed source snapshots, extracted facts, implementation notes, and search over DB/client specs.
  - `irodori-io`: shared export/import encoders — CSV/TSV (header toggle, delimiter/quote control), SQL INSERT/UPSERT, JSON/NDJSON, Avro, Parquet — plus dump/restore orchestration.
  - `irodori-server`: optional headless/local HTTP API exposing read and safe-write data operations over the same adapter, proxy, and security model (study PostgREST and DuckDB httpserver patterns, implement independently).
  - `irodori-i18n`: ja/en message catalogs with a normalized localization model (ICU MessageFormat / Project Fluent style), wired through both Rust and the web UI.
- UI: compact operational interface, no landing-page feel. Object browser, editor, results, inspector, and command palette are first-screen citizens.
- Editor engine: evaluate Monaco, CodeMirror 6, and a native/Tree-sitter-backed path before committing. Vim quality and completion architecture decide.
- Parsing: Tree-sitter for incremental structure where grammars are strong; dialect-specific fallbacks where they are not.
- GUI/rendering: keep Tauri as the default shell candidate, but run a serious spike against native Rust GUI/GPU paths for hot surfaces. Study WezTerm-style GPU acceleration and Zed's GPUI architecture as performance references, but keep the implementation independent — Zed is copyleft, so learn from it without copying code into the permissive core. Evaluate WebGPU/wgpu or platform GPU paths only where they clearly improve large text/grid workloads.
- Engineering quality: design for automated testing from day one — pure Rust unit tests, integration tests against ephemeral databases (containerized or embedded), golden tests for generated TypeScript bindings, and headless UI smoke tests for the Tauri shell.

## Phases

### Phase 0: Product And Legal Foundation

- Write clean-room contribution rules.
- Build a feature matrix from public docs and hands-on behavior, not source copying.
- Define supported licenses for themes, snippets, icons, grammars, and drivers.
- Lock project licensing around `MIT OR 0BSD` for Irodori-authored code and extension templates.
- Seed `knowledge/sources.json` with official DB docs, release notes, DB client docs, and AI/Copilot/MCP references.
- Decide initial driver strategy for Oracle thin/thick modes and platform packaging.
- Pick the first Rust/TypeScript type generation path and document command payload rules.
- Keep `docs/data-source-coverage-strategy.md` current as the source-family expansion plan.

### Phase 1: Thin Vertical Slice

- Tauri app boots on Windows, macOS, and Linux.
- Connection manager supports SQLite and PostgreSQL.
- Rust command payloads generate TypeScript bindings for the desktop UI.
- SQL editor opens, executes current statement/selection/file, streams results, cancels queries, and shows errors.
- Object browser lists schemas, tables, columns, indexes, views, functions, and procedures where available.
- Result grid supports virtualization, copy, CSV/TSV export with header on/off, sorting/filtering client-side for current page, and safe read-only defaults.
- Command palette and keybinding resolver exist from day one.

### Phase 1A: Beat Beekeeper Fast

- Match the daily OSS baseline: connections, object browser, query tabs, current/selection/all execution, multiple result sets, query history, query parameters, editable result path, CSV export, and session restore.
- Surpass it immediately where Irodori must be different: faster startup, lower idle memory, tighter keyboard flow, fully remappable shortcuts, serious Vim mode, nested proxy chains, and first-class Oracle planning.
- Keep Beekeeper code review license-aware: Community Edition is GPLv3-or-later in the local reference copy, while commercial directories are off-limits unless rights are explicit.
- Prefer Rust-native core paths for connection, metadata cache, query execution, cancellation, history, and proxy composition instead of cloning Electron-era architecture.

### Phase 2: Power-User Editor

- Remappable keybindings with conflict detection and per-context scopes.
- Vim mode reaches daily-driver quality.
- Multiple cursors, snippets, bracket matching, SQL-aware selection expansion, comment toggles, format hooks.
- Workspace tabs, tab folders/groups, split panes, saved sessions, per-tab connection binding.
- Query history, saved queries, scratch buffers, connection-local notes.
- Connection/datasource organization: folders/groups, quick inline edit, duplicate, and import/export of connection definitions (secrets excluded) — datasources should feel as easy to manage as files.
- i18n scaffolding (ja/en) across editor, menus, command palette, and messages, with a normalized catalog the extension SDK can extend.

### Phase 2A: Extension SDK

- Draft and stabilize `irodori.extension.json`.
- Ship a TypeScript extension SDK with typed command, keybinding, result-grid, theme, and SQL dialect APIs.
- Generate extension SDK types from Rust/schema definitions through the same type bridge used by the desktop UI.
- Provide `MIT OR 0BSD` extension templates and examples.
- Add local extension development mode with watch reload, logs, fake database fixtures, and permission inspection.
- Keep Rust/Wasm extension paths available for high-performance drivers, renderers, and parsers.

### Phase 3: Completion And Intelligence

- Metadata cache with invalidation, background refresh, and permissions-aware introspection.
- Use the local knowledge base to track dialect features, syntax changes, driver behavior, deprecations, and bug-fix references.
- Completion for tables, columns, aliases, CTEs, subquery columns, functions, procedures, schemas, keywords, variables, file paths, and connection names.
- Dialect-aware ranking and insert behavior, including optional keyword casing.
- Signature help, join suggestions, generated column lists, overload-aware function/procedure completion, and explain/analyze command helpers.
- Hover inspection: schema/object/column hovers show type, nullability, keys, indexes, DDL, comments, and a row-count estimate plus quick sample, driven by the metadata cache.
- AI provider API remains optional: local model, OpenAI-compatible, Anthropic/Gemini/Azure/Bedrock-style providers, and Copilot-compatible MCP bridge.
- Explain-plan entry points and plan-aware hints.
- Optional local/remote AI assistance only after privacy, auditability, and opt-in controls are solid.

### Phase 4: Database Coverage

- MySQL/MariaDB and SQL Server reach parity with PostgreSQL/SQLite basics.
- Oracle Database becomes first-class: connection profiles, service/SID handling, wallets where feasible, explain plans, packages/procedures, PL/SQL execution ergonomics.
- Add YugabyteDB, CockroachDB, DuckDB, BigQuery, ClickHouse, Redshift, Firebird, Trino/Presto, Redis, MongoDB, Snowflake, InfluxDB, Neo4j, Cassandra/ScyllaDB, Couchbase, DynamoDB, Elasticsearch/OpenSearch, TiDB, Databricks/Spark SQL, Apache IoTDB, QuestDB, TimescaleDB, ArangoDB, and Memgraph by adapter maturity.
- Treat YugabyteDB first through PostgreSQL-compatible YSQL, then add distributed-database affordances such as regions, tablets, follower reads, diagnostics, and topology awareness.
- Treat InfluxDB as a time-series source with SQL/native-query helpers, time range ergonomics, retention/bucket metadata, and downsampling.
- Treat Neo4j as the first graph source with Cypher completion, label/relationship/property introspection, tabular results, and query-result graph rendering.
- Lakehouse and table formats, with Apache Iceberg prioritized: query Iceberg tables through Hive Metastore, AWS Glue, REST, and JDBC catalogs and via AWS S3 Tables; treat object stores (S3/GCS/Azure) as first-class; add Delta Lake and Apache Hudi later. Use embeddable engines (DuckDB, Apache DataFusion) or Trino/Presto as execution options.
- Snowflake with full authentication coverage: password, key-pair (JWT), OAuth, external-browser/SSO, MFA/passcode, and programmatic access tokens, plus warehouse/role/database context switching.
- Format-rich export/import: CSV/TSV (header on/off, delimiter/quote control), SQL INSERT/UPSERT scripts (with or without schema/DDL), JSON/NDJSON, Avro, and Parquet; clipboard-friendly subsets; dialect-aware dump/restore.
- Editable results, table designer, indexes/constraints UI, and backup/restore hooks where each dialect permits.

### Phase 5: Network And Security

- SSH tunnel support with key/password/agent flows.
- SOCKS5 and HTTP CONNECT proxy support.
- Multi-hop proxy chains with named reusable hops.
- Per-connection secret storage through OS keychain.
- Connection diagnostics, audit log, privacy mode, and redaction-safe screenshots/log export.

### Phase 6: Advanced Workflows

- Schema compare and migration preview.
- Data compare and safe bulk edit workflow.
- ERD and graph views after core editor/query/browser workflows are excellent.
- Plugin API for drivers, themes, formatters, and result visualizers.
- Extension registry support after the local SDK is solid.
- Team/workspace sync only after local-first UX is strong.

### Phase 6A: Local Data API And Headless Mode

- Optional local HTTP API to list sources, run parameterized queries, read tables with pagination/filter/sort, and perform safe, permissioned writes.
- Headless mode for scripts, CI, and external tools: same adapter, proxy, and security model, no UI required.
- Read-only by default with explicit opt-in for writes, token-scoped access, per-source permission scopes, and an audit log on by default.
- Generated client types through the type bridge so external tools get typed access. Study PostgREST and DuckDB httpserver patterns; implement independently.

## Research Watchlist

- Tree-sitter incremental parsing and highlighting for editor-grade SQL structure.
- Language Server Protocol conventions for completion, diagnostics, symbols, commands, and workspace-scoped settings.
- Text-to-SQL and schema-linking papers for better completion ranking and optional AI assistance.
- SQL issue debugging and query-repair research for explainable error assistance.
- Large-result grid virtualization, streaming query results, cancellation semantics, and low-latency UI event loops.
- GPU text/grid rendering, retained-mode vs immediate-mode UI tradeoffs, and frame pacing for large scrollback-like workloads.
- Product market scans for DataGrip, DBeaver, DbVisualizer, TablePlus, VS Code MSSQL, and AI-assisted database workflows.
- Source-specific GUI scans for Neo4j Browser/Workspace, InfluxDB UI/Data Explorer, MongoDB Compass, RedisInsight, Studio 3T, DbGate, ArangoDB Web UI, and Grafana data-source workflows.
- Automated source monitoring for official database release notes and specs, stored in local SQLite for implementation and debugging.
- Rust/TypeScript type generation ecosystems such as `ts-rs`, `specta`, `typeshare`, and `schemars`.
- Apache Iceberg table spec, the Iceberg REST catalog, AWS S3 Tables, and catalog options (Hive Metastore, AWS Glue, JDBC); later Delta Lake and Apache Hudi.
- Object-store query engines and embeddable analytics: DuckDB, Apache DataFusion/Arrow, and Trino/Presto for lakehouse execution.
- Columnar and row interchange formats for export/import: Apache Avro, Apache Parquet, and Apache Arrow.
- Snowflake authentication and driver options: key-pair JWT, OAuth, external-browser/SSO, MFA, and programmatic access tokens.
- Local data API patterns: PostgREST, DuckDB httpserver, and SQLite-backed HTTP layers for read/write table access.
- Fast Rust desktop app architecture: Zed/GPUI rendering and input latency, plus Lapce and Helix, as performance references.
- Internationalization for Rust/TypeScript desktop apps: ICU MessageFormat and Project Fluent for ja/en catalogs.
- Test automation: ephemeral-database harnesses (containers/embedded), golden-snapshot testing for generated bindings, and headless UI testing for Tauri.

## Immediate Next Steps

- Keep `docs/clean-room.md` enforced during every reference-driven change.
- Expand `docs/feature-matrix.md` through hands-on review of TablePlus, A5:SQL Mk-2, Beekeeper Studio, SQLTools, vscode-mssql, and major DB clients.
- Build a Beekeeper-plus checklist from OSS code/docs and mark what must be matched, exceeded, or skipped.
- Keep `docs/db-client-market-scan-2026-06-21.md` and `docs/completion-and-ai-strategy.md` current as product/research inputs.
- Keep `docs/data-source-coverage-strategy.md` and `docs/type-bridge-handoff.md` current before the adapter and command surfaces harden.
- Initialize the local knowledge DB with `node tools/knowledge/refresh.mjs --no-fetch`, then add scheduled refresh automation.
- Add source snapshots for YugabyteDB, InfluxDB, Neo4j, and source-specific GUI tools.
- Spike renderer options: Tauri WebView, canvas/WebGPU inside WebView, and native Rust GPU GUI for editor/result-grid surfaces.
- Expand the Rust-generated TypeScript binding spike beyond `workspace_snapshot`, add a friendly typegen command, and check generated drift in CI.
- Turn `docs/extension-development.md` into a working SDK scaffold and first sample extension.
- Scaffold the Tauri/Rust workspace.
- Choose the first editor engine after a Vim-mode and completion spike.
- Implement SQLite/PostgreSQL vertical slice before broadening the adapter surface.
- Work `docs/implementation-backlog.md` ticket by ticket; keep it in sync with the phases above.
- Expand `docs/data-source-coverage-strategy.md` with the Iceberg/lakehouse catalog plan and Snowflake auth coverage.
- Prototype export encoders (CSV/TSV header toggle and SQL INSERT) inside the vertical slice, then add JSON/Avro/Parquet.
- Spike a read-only local data API behind a feature flag before opening write paths.
- Scaffold ja/en i18n and a test-automation harness (unit + ephemeral-DB integration + generated-binding golden check) early.
