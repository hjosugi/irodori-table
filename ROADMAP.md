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
- Extension development is first-class: documented manifest, typed APIs, local dev mode, capability-scoped permissions, and `MIT OR 0BSD` official templates.
- Current product research is tracked continuously so Irodori learns from highly rated clients without cloning their protected expression.
- A local SQLite knowledge base stores official DB specs, release notes, product research, AI integration notes, and implementation facts for future features and bug fixes.

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
- UI: compact operational interface, no landing-page feel. Object browser, editor, results, inspector, and command palette are first-screen citizens.
- Editor engine: evaluate Monaco, CodeMirror 6, and a native/Tree-sitter-backed path before committing. Vim quality and completion architecture decide.
- Parsing: Tree-sitter for incremental structure where grammars are strong; dialect-specific fallbacks where they are not.
- GUI/rendering: keep Tauri as the default shell candidate, but run a serious spike against native Rust GUI/GPU paths for hot surfaces. Study WezTerm-style GPU acceleration as a performance reference, but keep the implementation independent unless license-compatible OSS code is intentionally adapted. Evaluate WebGPU/wgpu or platform GPU paths only where they clearly improve large text/grid workloads.

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
- Result grid supports virtualization, copy, CSV export, sorting/filtering client-side for current page, and safe read-only defaults.
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
- Import/export, editable results, table designer, indexes/constraints UI, backup/restore hooks where each dialect permits.

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
