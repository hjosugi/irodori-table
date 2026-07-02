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
- Lakehouse and table formats are in scope: Apache Iceberg is the priority target, reachable through standard catalogs (Hive Metastore, AWS Glue, REST) and AWS S3 Tables.
- A headless local data API is supported: Irodori can run a local server to read and safely edit table data over HTTP for scripting, tests, and external tools.
- Bilingual from early: ja/en localization (i18n) is built in, not bolted on.
- Automated testing is first-class: unit, ephemeral-database integration, generated-binding golden checks, and headless UI smoke tests run in CI.
- Hover-to-inspect everywhere: schemas, objects, and columns reveal type, keys, DDL, comments, and a quick sample without leaving the editor.

## Reference Surface

- TablePlus: interaction speed, query/editor ergonomics, shortcut feel, object browser expectations, and lightweight mental model.
- A5:SQL Mk-2 (public site / behavior reference; see
  `https://hjosugi.github.io/irodori-docs/reference-a5sql.html`): Oracle-aware workflows, SQL completion depth,
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
  are explicit; see `https://hjosugi.github.io/irodori-docs/reference-rsql.html`): high-performance PostgreSQL
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
- drawDB (`drawdb-io/drawdb`, AGPL-3.0 — copyleft/source-available): behavioral
  reference for the visual database-design surface — multi-table ER editing,
  inline column/key editing, relationship drawing, and SQL forward-engineering
  (diagram → ordered `CREATE`/`ALTER` script that creates the database). Study
  the UX and feature behavior only; implement independently and do not copy
  copyleft code into the permissive core.
- Zed (`zed-industries/zed`, GPL-3.0/AGPL-3.0 with some Apache-2.0 crates — copyleft): a fast Rust-native desktop editor; reference for GPUI rendering, input latency, multibuffer/pane models, and Rust app structure. Study architecture; do not copy copyleft code into the core.
- Fast Rust desktop apps broadly (Zed, WezTerm, Lapce, Helix): performance and architecture references for startup time, rendering, and large-document handling.

## Architecture Direction

- Desktop shell: Tauri v2, with Rust commands for privileged/local work and a web UI for editor and layout.
- This repository is the app only. Shared Rust foundations live in sibling
  repos consumed as version-tagged Git dependencies (crates.io for `typeship`):
  - `typeship` (`hjosugi/typeship`): Rust-to-TypeScript command/API generation
    consumed from crates.io so Serde `camelCase` JSON and frontend types never
    drift.
  - `irodori-sql` (`hjosugi/irodori-sql`, `v0.3.0`): SQL dialect metadata,
    parameter detection, information-schema/metamodel helpers, and schema-diff
    primitives.
  - `irodori-kit` (`hjosugi/irodori-kit`, `v0.5.0`): the foundation workspace —
    `irodori-core` (connection/workspace model, command registry, keybinding
    resolver), `irodori-connection`, `irodori-proxy` (direct/SSH/SOCKS/HTTP and
    multi-hop transports), `irodori-secure-store` (OS keychain + encrypted
    config), `irodori-security`, `irodori-completion` (parser-aware
    deterministic completion), `irodori-generate` (local/provider SQL
    generation), `irodori-extension` (extension host contract), `irodori-io`
    (export/import encoders + dump/restore), and `irodori-server` (optional
    headless HTTP data API) — plus `packages/extension-sdk` (TypeScript SDK,
    manifest schema, templates) and the packaging templates.
  - `irodori-knowledge` (`hjosugi/irodori-knowledge`, `v0.3.0`):
    `irodori-knowledge` (local SQLite knowledge base), `irodori-jobs`
    (cancellable/checkpointed job runtime), and `irodori-error`.
- Areas without a stable shared API stay app-local until a split pays for
  itself: DB adapters/datasource contracts (`src-tauri/src/db`), AI chat
  providers, graph/time-series helpers, ML experiments, and i18n catalogs.
- UI: compact operational interface, no landing-page feel. Object browser, editor, results, inspector, and command palette are first-screen citizens.
- Editor engine: CodeMirror 6 is the shipped path — Vim mode, completion, lint, highlighting, and custom gutter/caret work build on it. Native/GPU alternatives for hot surfaces are tracked under `PERF-001`.
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
- Keep `https://hjosugi.github.io/irodori-docs/data-source-coverage-strategy.html` current as the source-family expansion plan.

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
- [x] Generate extension SDK types from Rust/schema definitions through the same `typeship` path used by the desktop UI.
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
- [/] AI provider API remains optional: local model (llama), Ollama/OpenAI-compatible, Azure, Claude, Gemini, and DeepSeek providers ship behind one abstraction shared by SQL generation and chat; a Copilot-compatible MCP bridge remains.
- [x] Explain-plan entry points and plan-aware hints.
- [/] Optional local/remote AI assistance: the streaming schema-aware chat sidebar with a cancellable read-only agent mode is live and opt-in (keys stay in the OS keychain); audit-log and redaction hardening remain.

### Phase 4: Database Coverage

- [x] MySQL/MariaDB and SQL Server reach parity with PostgreSQL/SQLite basics.
- [x] Oracle Database becomes first-class: connection profiles, service/SID handling, wallets where feasible, explain plans, packages/procedures, PL/SQL execution ergonomics.
- [/] Broad engine coverage by adapter maturity: 25+ engines have production connect paths today (DuckDB, CockroachDB, YugabyteDB, Redshift, TimescaleDB, Neon, TiDB, QuestDB, MongoDB, Neo4j, Redis, Cassandra/ScyllaDB, ClickHouse, Snowflake, BigQuery, Bigtable, InfluxDB, and more); the remaining families (vector, lakehouse, search, document, KV, federated) ship as installable connector extensions. `registry/data-source-support-status.md` is the wired/extension/planned inventory.
- [/] YugabyteDB YSQL rides the PostgreSQL wire today; distributed-database affordances such as regions, tablets, follower reads, diagnostics, and topology awareness remain.
- [/] InfluxDB: the HTTP (SQL/v3) adapter is wired; time range ergonomics, retention/bucket metadata, and downsampling remain.
- [/] Neo4j: the Bolt adapter is wired, with GDS and Memgraph notes in the knowledge base; Cypher completion depth, introspection polish, and query-result graph rendering remain.
- [/] Lakehouse and table formats are extension-first: Apache Iceberg, AWS S3 Tables, Delta Lake, Hudi, Hive, and Athena have marketplace connectors; shared catalog/table UX and execution-backend contracts (DuckDB, Apache DataFusion, Trino/Presto) remain.
- [/] Snowflake: password and key-pair (JWT) are wired; OAuth, external-browser/SSO, MFA/passcode, programmatic access tokens, and warehouse/role/database context switching remain.
- [x] Format-rich export/import: CSV/TSV (header on/off, delimiter/quote control), SQL INSERT/UPSERT scripts (with or without schema/DDL), JSON/NDJSON, Avro, and Parquet; clipboard-friendly subsets; dialect-aware dump/restore.
- [/] Editable results and the schema/ERD designer exist; table designer depth, indexes/constraints UI, and backup/restore hooks per dialect remain.

### Phase 5: Network And Security

- [x] SSH tunnel support with key/password/agent flows.
- [x] SOCKS5 and HTTP CONNECT proxy support.
- [x] Multi-hop proxy chains with named reusable hops.
- [x] Per-connection secret storage through OS keychain.
- [x] Connection diagnostics, audit log, privacy mode, and redaction-safe screenshots/log export.

### Phase 6: Advanced Workflows

- [/] Schema compare and migration preview: `irodori-sql` schema-diff primitives and the Migration Studio (source/target/diff/runbook outputs) are the first pass; live connection-to-connection compare UX remains.
- [ ] Data compare and safe bulk edit workflow.
- [/] ERD and graph views after core editor/query/browser workflows are excellent.
- [/] Plugin API for drivers: the native connector extension framework (dynamic-library host with integrity checks) is in; theme, formatter, and result-visualizer plugin surfaces remain.
- [/] Extension registry: the marketplace catalog (`registry/catalog/`) with installable connector extensions is live; publishing and update flows remain.
- [ ] Team/workspace sync only after local-first UX is strong.

### Phase 6A: Local Data API And Headless Mode

- [/] Optional local HTTP API: `irodori-server` ships a transport-agnostic, unit-tested API with a hyper adapter and a built-in SQLite source; wiring the full desktop adapter registry behind it remains.
- [/] Headless mode for scripts, CI, and external tools: standalone SQLite runs work today; the same adapter, proxy, and security model across every engine remains.
- [/] Read-only by default with token-scoped access, a write-opt-in SQL guard, and an audit trail is implemented in `irodori-server`; per-source permission scopes remain.
- [ ] Generated client types through `typeship` so external tools get typed access. Study PostgREST and DuckDB httpserver patterns; implement independently.

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
- Apache Iceberg table spec, the Iceberg REST catalog, AWS S3 Tables, and catalog options (Hive Metastore, AWS Glue, JDBC); later Delta Lake and Apache Hudi.
- Object-store query engines and embeddable analytics: DuckDB, Apache DataFusion/Arrow, and Trino/Presto for lakehouse execution.
- Columnar and row interchange formats for export/import: Apache Avro, Apache Parquet, and Apache Arrow.
- Snowflake authentication and driver options: key-pair JWT, OAuth, external-browser/SSO, MFA, and programmatic access tokens.
- Local data API patterns: PostgREST, DuckDB httpserver, and SQLite-backed HTTP layers for read/write table access.
- Fast Rust desktop app architecture: Zed/GPUI rendering and input latency, plus Lapce and Helix, as performance references.
- Internationalization for Rust/TypeScript desktop apps: ICU MessageFormat and Project Fluent for ja/en catalogs.
- Test automation: ephemeral-database harnesses (containers/embedded), golden-snapshot testing for generated bindings, and headless UI testing for Tauri.

## Immediate Next Steps

- Keep `https://hjosugi.github.io/irodori-docs/clean-room.html`, `https://hjosugi.github.io/irodori-docs/feature-matrix.html`,
  `https://hjosugi.github.io/irodori-docs/production-readiness.html`, and `https://hjosugi.github.io/irodori-docs/implementation-backlog.html` aligned,
  but avoid mixing unrelated parallel edits into release commits.
- Finish `THEME-001b`: convert remaining hardcoded workbench/result/sidebar
  colors to normalized theme variables so imported/saved themes affect the whole
  shell, not just the editor and chrome.
- Finish `THEME-002`: wire file import, custom theme naming, save/delete, and
  Settings-based switching on top of the normalized VS Code importer.
- Continue Git graph hardening with commit-specific actions: copy hash/subject,
  open remote commit URLs, show per-commit file summaries/diffs, and expose branch
  checkout/create/delete affordances from the selected ref context.
- Prove the installable-connector path end-to-end: install one marketplace
  connector through the new native extension host (Memgraph over the existing
  Bolt path is the natural first) and verify the manifest, integrity, and
  permission flow.
- Settle the shared source-type contracts the extension-first families need:
  vector (collection/index browsing, similarity search) and lakehouse
  (catalog/table UX plus execution backends).
- Finish `JOB-004`: schema indexing proved the dashboard wiring; migrate
  run-to-file export or knowledge refresh onto `irodori-jobs` next.
- Start `PERF-001` now that row, wide-column, and 1M-row virtualization gates are
  in place: compare WebView DOM, canvas/WebGPU-in-WebView, and native Rust GPU
  paths for editor and result-grid hot surfaces. Include RSQL's canvas grid,
  server-side cursor pagination, packed IPC, and dual-pool design as behavior
  benchmarks for the PostgreSQL path.
- Keep the sibling repos aligned after the split: bump `irodori-kit`,
  `irodori-sql`, and `irodori-knowledge` tags together, keep
  `irodori-kit/packages/extension-sdk` in sync with generated extension API
  changes, and regenerate `registry/data-source-support-status.md` from the
  registry instead of hand-editing it.
- Keep CI/release discipline tight: typegen drift, frontend unit tests, browser
  smoke, Rust tests, security checks, and release notes should be green before
  each cut.
