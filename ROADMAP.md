# Irodori Table Roadmap

Irodori Table aims to be a fast, open-source, cross-platform SQL GUI for people who live in databases all day. The north star is TablePlus-level lightness and directness, with the openness, keyboard control, dialect coverage, and automation depth that current clients still miss.

## Non-Negotiables

- Rust-first core with a Tauri desktop shell for Windows, macOS, and Linux.
- Irodori-authored code is dual-licensed as `MIT OR 0BSD` by default so users can choose familiar MIT terms or the almost-no-conditions 0BSD path.
- First-class SQL databases from the start: PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, and Oracle Database.
- Architecture must grow beyond classic SQL: YugabyteDB/distributed SQL, InfluxDB/time-series, Neo4j/graph, document, key-value, search, warehouse, and local embedded sources should fit through adapter contracts instead of one-off UI forks.
- Keep crate boundaries earned by real implementation. Avoid placeholder crates
  for future architecture; start new areas inside the owning app/crate and split
  only when there is a stable shared API or independent release/test boundary.
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
- Long-running batch work is first-class: huge local index builds, ML dataset/evaluation runs, knowledge refreshes, imports/exports, bulk edits, and source scans run through cancellable, checkpointed jobs with progress, logs, resource limits, and headless/API access.
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
- A5:SQL Mk-2 (public site / behavior reference; see
  `docs/reference-a5sql.md`): Oracle-aware workflows, SQL completion depth,
  explain plans, SQL designer ideas, result comparison, Excel evidence export,
  ERD/table-definition-document flows, and read-only / AI-disabled safety modes.
- Beekeeper Studio: first client to beat quickly. Use it as an OSS baseline for feature coverage, but surpass it on speed, keyboard control, Vim depth, proxy chains, Oracle priority, and completion.
- DataGrip: deep SQL IDE benchmark for inspections, refactoring, schema-aware completion, diff/compare, Git, keymaps, and optional AI.
- DBeaver and DbVisualizer: broad database coverage, data transfer, admin/security, AI/MCP direction, CLI, and enterprise workflow benchmarks.
- DbGate, pgAdmin, MySQL Workbench, Oracle SQL Developer, SSMS, HeidiSQL, SQuirreL SQL, OmniDB, PopSQL: additional workflow and coverage references.
- MongoDB Compass, Studio 3T, RedisInsight, Neo4j Browser/Workspace/Query, InfluxDB UI/Data Explorer, ArangoDB Web UI, Couchbase UI, Grafana data-source workflows: source-specific GUI references for document, KV, graph, time-series, multi-model, and observability-oriented workflows.
- VS Code MSSQL extension: important replacement-path benchmark now that Azure Data Studio is retired.
- VS Code SQLTools and vscode-mssql: session-to-connection binding, command-driven workflows, result handling, driver boundaries, and editor integration patterns.
- Current DB clients broadly: DBeaver, DataGrip, VS Code MSSQL, SSMS, Oracle SQL Developer, pgAdmin, MySQL Workbench, HeidiSQL, DB Browser for SQLite.
- RSQL (`rust-dd/rsql`, public README / behavior reference until license terms
  are explicit; see `docs/reference-rsql.md`): high-performance PostgreSQL
  client reference for Tauri v2 + React + Rust, canvas/WebGL result grids,
  server-side cursor pagination, packed IPC, dual query/metadata pools, query
  history, record view, result diffing, PostGIS maps, EXPLAIN visualization, and
  database performance dashboards. Do not copy code unless a compatible license
  is verified.
- Apache Superset (Apache-2.0) and `awesome-business-intelligence`: BI reference
  surfaces for SQL Lab-to-chart workflows, no-code x/y/metric mappings, dashboards,
  local/materialized analytical datasets, and chart usage patterns. Use them for
  product requirements and clean-room implementation planning; keep Irodori's
  desktop-first result workflow compact instead of cloning a web BI suite.
- DuckDB and DuckDB UI (`ref/duckdb-ui-main`, MIT): embedded analytical SQL, local-first exploration, Parquet/Iceberg reads, and a lightweight in-process UI; MIT lets us adapt code with attribution and license tracking.
- Kibana (`ref/kibana-main`, Elastic License 2.0 / SSPL / AGPL-3.0 — source-available): primary behavioral benchmark for Elasticsearch/OpenSearch because current general DB clients are weak for search sources. Study Discover, data views, field stats, filter/query composition, saved searches, Dev Tools console, mappings, aliases, data streams, index lifecycle/status cues, explain/profile, and observability-adjacent exploration; behavior-only, no code adaptation into the permissive core.
- Zed (`zed-industries/zed`, GPL-3.0/AGPL-3.0 with some Apache-2.0 crates — copyleft): a fast Rust-native desktop editor; reference for GPUI rendering, input latency, multibuffer/pane models, and Rust app structure. Study architecture; do not copy copyleft code into the core.
- Fast Rust desktop apps broadly (Zed, WezTerm, Lapce, Helix): performance and architecture references for startup time, rendering, and large-document handling.

## Architecture Direction

- Desktop shell: Tauri v2, with Rust commands for privileged/local work and a web UI for editor and layout.
- Extracted reusable packages:
  - `typeship` (`hjosugi/typebridge`): Rust-to-TypeScript command/API generation
    consumed from crates.io so Serde `camelCase` JSON and frontend types never
    drift.
  - `irodori-sql` (`hjosugi/irodori-sql`): SQL dialect metadata, parameter
    detection, information-schema/metamodel helpers, and schema-diff primitives.
    Irodori Table consumes it as a version-tagged Git dependency (`v0.2.23`).
- Core crates:
  - `irodori-core`: connection model, workspace model, command registry, keybinding resolver.
  - `irodori-proxy`: direct, SSH, SOCKS/HTTP, and multi-hop transport composition.
  - `irodori-secure-store`: OS keychain integration and encrypted local config.
- Supporting crates:
  - `irodori-graph`: Cypher/graph metadata, result graph model, and graph-completion hooks.
  - `irodori-timeseries`: time range model, frame/downsampling model, and time-series query helper hooks.
  - `irodori-completion`: parser-aware deterministic completion, ranking, snippets, signature help, and optional provider hooks.
  - `irodori-ai`: opt-in AI provider abstraction, local model support, audit log, redaction, and MCP bridge.
  - `irodori-knowledge`: local SQLite-backed source snapshots, extracted facts, implementation notes, and search over DB/client specs.
  - `irodori-ml`: local-first ML dataset preparation, evaluation, ranking experiments, and provider/model benchmarking; user data never leaves the machine unless an explicit workspace policy allows that class of data.
  - `irodori-io`: shared export/import encoders — CSV/TSV (header toggle, delimiter/quote control), SQL INSERT/UPSERT, JSON/NDJSON, Avro, Parquet — plus dump/restore orchestration.
  - `irodori-server`: optional headless/local HTTP API exposing read and safe-write data operations over the same adapter, proxy, and security model (study PostgREST and DuckDB httpserver patterns, implement independently).
- Job runtime currently belongs in `irodori-core::jobs`. Do not split an
  `irodori-jobs` crate until at least two real workflows and the local API prove
  that an independent package boundary pays for itself.
- Areas that do not yet have a real shared API, such as datasource contracts and
  i18n catalogs, should remain modules or app-local code until the split pays for
  itself.
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

- [x] Tauri app boots on Windows, macOS, and Linux.
- [x] Connection manager supports SQLite and PostgreSQL.
- [x] Rust command payloads generate TypeScript bindings for the desktop UI.
- [x] SQL editor opens, executes current statement/selection/file, streams results, cancels queries, and shows errors.
- [x] Object browser lists schemas, tables, columns, indexes, views, functions, and procedures where available.
- [x] Result grid supports virtualization, copy, CSV/TSV export with header on/off, sorting/filtering client-side for current page, and safe read-only defaults.
- [x] Command palette and keybinding resolver exist from day one.

### Phase 1A: Beat Beekeeper Fast

- [x] Match the daily OSS baseline: connections, object browser, query tabs, current/selection/all execution, multiple result sets, query history, query parameters, editable result path, CSV export, and session restore.
- [x] Surpass it immediately where Irodori must be different: faster startup, lower idle memory, tighter keyboard flow, fully remappable shortcuts, serious Vim mode, nested proxy chains, and first-class Oracle planning.
- [x] Keep Beekeeper code review license-aware: Community Edition is GPLv3-or-later in the local reference copy, while commercial directories are off-limits unless rights are explicit.
- [x] Prefer Rust-native core paths for connection, metadata cache, query execution, cancellation, history, and proxy composition instead of cloning Electron-era architecture.

### Phase 2: Power-User Editor

- [x] Remappable keybindings with conflict detection and per-context scopes.
- [x] Vim mode reaches daily-driver quality.
- [x] Multiple cursors, snippets, bracket matching, SQL-aware selection expansion, comment toggles, format hooks.
- [x] Workspace tabs, tab folders/groups, split panes, saved sessions, per-tab connection binding.
- [x] Query history, saved queries, scratch buffers, connection-local notes.
- [x] Connection/datasource organization: folders/groups, quick inline edit, duplicate, and import/export of connection definitions (secrets excluded) — datasources should feel as easy to manage as files.
- [x] i18n scaffolding (ja/en) across editor, menus, command palette, and messages, with a normalized catalog the extension SDK can extend.

### Phase 2A: Extension SDK

- [x] Draft and stabilize `irodori.extension.json`.
- [x] Ship a TypeScript extension SDK with typed command, keybinding, result-grid, theme, and SQL dialect APIs.
- [x] Generate extension SDK types from Rust/schema definitions through the same type bridge used by the desktop UI.
- [x] Provide `MIT OR 0BSD` extension templates and examples.
- [x] Add local extension development mode with watch reload, logs, fake database fixtures, and permission inspection.
- [x] Keep Rust/Wasm extension paths available for high-performance drivers, renderers, and parsers.

### Phase 3: Completion And Intelligence

- [x] Metadata cache with invalidation, background refresh, and permissions-aware introspection.
- [x] Use the local knowledge base to track dialect features, syntax changes, driver behavior, deprecations, and bug-fix references.
- [x] Completion for tables, columns, aliases, CTEs, subquery columns, functions, procedures, schemas, keywords, variables, file paths, and connection names.
- [x] Dialect-aware ranking and insert behavior, including optional keyword casing.
- [x] Signature help, join suggestions, generated column lists, overload-aware function/procedure completion, and explain/analyze command helpers.
- [x] Hover inspection: schema/object/column hovers show type, nullability, keys, indexes, DDL, comments, and a row-count estimate plus quick sample, driven by the metadata cache.
- [ ] AI provider API remains optional: local model, OpenAI-compatible, Anthropic/Gemini/Azure/Bedrock-style providers, and Copilot-compatible MCP bridge.
- [x] Explain-plan entry points and plan-aware hints.
- [ ] Optional local/remote AI assistance only after privacy, auditability, and opt-in controls are solid.

### Phase 4: Database Coverage

- [x] MySQL/MariaDB and SQL Server reach parity with PostgreSQL/SQLite basics.
- [x] Oracle Database becomes first-class: connection profiles, service/SID handling, wallets where feasible, explain plans, packages/procedures, PL/SQL execution ergonomics.
- [/] Add YugabyteDB, CockroachDB, DuckDB, BigQuery, ClickHouse, Redshift, Firebird, Trino/Presto, Redis, MongoDB, Snowflake, InfluxDB, Neo4j, Cassandra/ScyllaDB, Couchbase, DynamoDB, Elasticsearch/OpenSearch, TiDB, Databricks/Spark SQL, Apache IoTDB, QuestDB, TimescaleDB, ArangoDB, and Memgraph by adapter maturity.
- [ ] Treat YugabyteDB first through PostgreSQL-compatible YSQL, then add distributed-database affordances such as regions, tablets, follower reads, diagnostics, and topology awareness.
- [ ] Treat InfluxDB as a time-series source with SQL/native-query helpers, time range ergonomics, retention/bucket metadata, and downsampling.
- [ ] Treat Neo4j as the first graph source with Cypher completion, label/relationship/property introspection, tabular results, and query-result graph rendering.
- [ ] Lakehouse and table formats, with Apache Iceberg prioritized: query Iceberg tables through Hive Metastore, AWS Glue, REST, and JDBC catalogs and via AWS S3 Tables; treat object stores (S3/GCS/Azure) as first-class; add Delta Lake and Apache Hudi later. Use embeddable engines (DuckDB, Apache DataFusion) or Trino/Presto as execution options.
- [ ] Snowflake with full authentication coverage: password, key-pair (JWT), OAuth, external-browser/SSO, MFA/passcode, and programmatic access tokens, plus warehouse/role/database context switching.
- [x] Format-rich export/import: CSV/TSV (header on/off, delimiter/quote control), SQL INSERT/UPSERT scripts (with or without schema/DDL), JSON/NDJSON, Avro, and Parquet; clipboard-friendly subsets; dialect-aware dump/restore.
- [ ] Editable results, table designer, indexes/constraints UI, and backup/restore hooks where each dialect permits.

### Phase 5: Network And Security

- [x] SSH tunnel support with key/password/agent flows.
- [x] SOCKS5 and HTTP CONNECT proxy support.
- [x] Multi-hop proxy chains with named reusable hops.
- [x] Per-connection secret storage through OS keychain.
- [x] Connection diagnostics, audit log, privacy mode, and redaction-safe screenshots/log export.

### Phase 6: Advanced Workflows

- [ ] Schema compare and migration preview.
- [ ] Data compare and safe bulk edit workflow.
- [/] ERD and graph views after core editor/query/browser workflows are excellent.
- [ ] Plugin API for drivers, themes, formatters, and result visualizers.
- [ ] Extension registry support after the local SDK is solid.
- [ ] Team/workspace sync only after local-first UX is strong.

### Phase 6A: Local Data API And Headless Mode

- [ ] Optional local HTTP API to list sources, run parameterized queries, read tables with pagination/filter/sort, and perform safe, permissioned writes.
- [ ] Headless mode for scripts, CI, and external tools: same adapter, proxy, and security model, no UI required.
- [ ] Read-only by default with explicit opt-in for writes, token-scoped access, per-source permission scopes, and an audit log on by default.
- [ ] Generated client types through the type bridge so external tools get typed access. Study PostgREST and DuckDB httpserver patterns; implement independently.

## Research Watchlist

- Tree-sitter incremental parsing and highlighting for editor-grade SQL structure.
- Language Server Protocol conventions for completion, diagnostics, symbols, commands, and workspace-scoped settings.
- Text-to-SQL and schema-linking papers for better completion ranking and optional AI assistance.
- SQL issue debugging and query-repair research for explainable error assistance.
- Large-result grid virtualization, streaming query results, cancellation semantics, and low-latency UI event loops.
- RSQL-style PostgreSQL performance patterns: server-side cursor pagination,
  fixed-size page caches, canvas/WebGL grids, packed result IPC, simple-query
  text paths, dual query/metadata pools, and Rust-side result diffing.
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

## Recently Burned Down

- Desktop workbench structure is no longer centered on a huge `App.tsx`: dialogs,
  results, workbench shell, command handlers, and UI state now have dedicated
  feature modules/stores.
- Theme UX has moved into Settings, with saved custom themes, VS Code-theme
  import normalization, and active-theme switching tracked by `THEME-001/002`.
- Editor controls were tightened: Run Current sits at the editor corner, split
  controls are icon-only, and the user-facing pane split is capped to the simple
  two-pane workflow.
- Git graph hardening has moved past the baseline: commit search, branch/remote/tag
  ref filters, selection details, keyboard navigation, provider badges, and repo
  accent colors are wired as a workbench view.
- SQL hover-to-inspect is live in the editor: object/column hovers expose
  definitions, keys, indexes, comments, row counts, samples, and metadata jump.
- `JOB-001` is no longer a blank crate-sized task: the shared runtime foundation
  lives in `irodori-core::jobs` with progress, cancellation, logs, artifacts,
  retry/concurrency fields, budgets, checkpoints, desktop commands, and server
  DTO reuse.
- `EXEC-004B` is closed: lazy 1M-row virtualization coverage exists alongside
  wide-column virtualization. Future work moves to renderer-path benchmarks and
  very-large scrollbar scaling only if larger fixtures require it.

## Immediate Next Steps

- Keep `docs/clean-room.md`, `docs/feature-matrix.md`,
  `docs/production-readiness.md`, and `docs/implementation-backlog.md` aligned,
  but avoid mixing unrelated parallel edits into release commits.
- Finish `THEME-001b`: convert remaining hardcoded workbench/result/sidebar
  colors to normalized theme variables so imported/saved themes affect the whole
  shell, not just the editor and chrome.
- Finish `THEME-002`: wire file import, custom theme naming, save/delete, and
  Settings-based switching on top of the normalized VS Code importer.
- Continue Git graph hardening with commit-specific actions: copy hash/subject,
  open remote commit URLs, show per-commit file summaries/diffs, and expose branch
  checkout/create/delete affordances from the selected ref context.
- Close the workspace basics before adding more pane complexity: query tab CRUD,
  per-tab connection binding, saved queries, history search, and a drawer/modal
  detail view with full SQL, rerun, delete, and save actions.
- Advance `JOB-004` by migrating one real workflow, preferably run-to-file export
  or knowledge refresh, onto `irodori-core::jobs` to prove the runtime contract.
- Start `PERF-001` now that row, wide-column, and 1M-row virtualization gates are
  in place: compare WebView DOM, canvas/WebGPU-in-WebView, and native Rust GPU
  paths for editor and result-grid hot surfaces. Include RSQL's canvas grid,
  server-side cursor pagination, packed IPC, and dual-pool design as behavior
  benchmarks for the PostgreSQL path.
- Keep the crate layout conservative: add modules first, extract crates only when
  a stable shared API, independent test boundary, or multi-host release boundary
  is already visible.
- Continue repository slimming in dependency order: `irodori-core` only after the
  job/API contracts settle, `packages/extension-sdk` after generated extension
  API cadence stabilizes, and samples/docs-site only if their release cadence
  diverges. Keep DB adapter modules inside the desktop app until connector
  contracts are stable enough to publish independently.
- Keep CI/release discipline tight: typegen drift, frontend unit tests, browser
  smoke, Rust tests, security checks, and release notes should be green before
  each cut.
