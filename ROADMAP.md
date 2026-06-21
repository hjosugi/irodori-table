# Irodori Table Roadmap

Irodori Table aims to be a fast, open-source, cross-platform SQL GUI for people who live in databases all day. The north star is TablePlus-level lightness and directness, with the openness, keyboard control, dialect coverage, and automation depth that current clients still miss.

## Non-Negotiables

- Rust-first core with a Tauri desktop shell for Windows, macOS, and Linux.
- Irodori-authored code is dual-licensed as `MIT OR 0BSD` by default so users can choose familiar MIT terms or the almost-no-conditions 0BSD path.
- First-class SQL databases from the start: PostgreSQL, MySQL/MariaDB, SQLite, SQL Server, and Oracle Database.
- A reference policy that separates proprietary clean-room study from license-compatible OSS code study. OSS code can inform implementation when license, attribution, and compatibility are explicit.
- Fully remappable keybindings, plus preset maps for TablePlus-like, VS Code-like, JetBrains-like, and Vim-heavy workflows.
- Serious Vim mode: normal/insert/visual modes, counts, registers, macros, marks, text objects, search, command-line mode, custom mappings, and predictable editor integration.
- Schema-aware completion that understands dialect, aliases, CTEs, subqueries, functions, procedures, parameters, and recent user context.
- Connection through direct sockets, SSH tunnels, SOCKS/HTTP proxies, and ordered multi-hop proxy chains.
- Organized editor workspace: tab groups/folders, named sessions, connection-bound editors, arbitrary panes, persisted layouts.
- VS Code-compatible theme ingestion where possible, with an internal normalized theme model.
- GPU-aware rendering for hot paths such as editor text, result grids, scrolling, selection, and pane redraws, with a reliable CPU/software fallback.
- Extension development is first-class: documented manifest, typed APIs, local dev mode, capability-scoped permissions, and `MIT OR 0BSD` official templates.

## Reference Surface

- TablePlus: interaction speed, query/editor ergonomics, shortcut feel, object browser expectations, and lightweight mental model.
- A5:SQL Mk-2: Oracle-aware workflows, SQL completion depth, explain plans, query design ideas, ERD as a later-stage reference.
- Beekeeper Studio: first client to beat quickly. Use it as an OSS baseline for feature coverage, but surpass it on speed, keyboard control, Vim depth, proxy chains, Oracle priority, and completion.
- VS Code SQLTools and vscode-mssql: session-to-connection binding, command-driven workflows, result handling, driver boundaries, and editor integration patterns.
- Current DB clients broadly: DBeaver, DataGrip, Azure Data Studio, Oracle SQL Developer, pgAdmin, MySQL Workbench, HeidiSQL, DB Browser for SQLite.

## Architecture Direction

- Desktop shell: Tauri v2, with Rust commands for privileged/local work and a web UI for editor and layout.
- Core crates:
  - `irodori-core`: connection model, workspace model, command registry, keybinding resolver.
  - `irodori-drivers`: per-database adapters behind stable traits.
  - `irodori-proxy`: direct, SSH, SOCKS/HTTP, and multi-hop transport composition.
  - `irodori-sql`: dialect metadata, parser hooks, introspection cache, formatter/linter adapters.
  - `irodori-secure-store`: OS keychain integration and encrypted local config.
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
- Decide initial driver strategy for Oracle thin/thick modes and platform packaging.

### Phase 1: Thin Vertical Slice

- Tauri app boots on Windows, macOS, and Linux.
- Connection manager supports SQLite and PostgreSQL.
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
- Provide `MIT OR 0BSD` extension templates and examples.
- Add local extension development mode with watch reload, logs, fake database fixtures, and permission inspection.
- Keep Rust/Wasm extension paths available for high-performance drivers, renderers, and parsers.

### Phase 3: Completion And Intelligence

- Metadata cache with invalidation, background refresh, and permissions-aware introspection.
- Completion for tables, columns, aliases, CTEs, subquery columns, functions, procedures, schemas, keywords, variables, file paths, and connection names.
- Dialect-aware ranking and insert behavior, including optional keyword casing.
- Explain-plan entry points and plan-aware hints.
- Optional local/remote AI assistance only after privacy, auditability, and opt-in controls are solid.

### Phase 4: Database Coverage

- MySQL/MariaDB and SQL Server reach parity with PostgreSQL/SQLite basics.
- Oracle Database becomes first-class: connection profiles, service/SID handling, wallets where feasible, explain plans, packages/procedures, PL/SQL execution ergonomics.
- Add CockroachDB, DuckDB, BigQuery, ClickHouse, Redshift, Firebird, Trino/Presto, Redis, MongoDB, and Snowflake by adapter maturity.
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

## Immediate Next Steps

- Keep `docs/clean-room.md` enforced during every reference-driven change.
- Expand `docs/feature-matrix.md` through hands-on review of TablePlus, A5:SQL Mk-2, Beekeeper Studio, SQLTools, vscode-mssql, and major DB clients.
- Build a Beekeeper-plus checklist from OSS code/docs and mark what must be matched, exceeded, or skipped.
- Spike renderer options: Tauri WebView, canvas/WebGPU inside WebView, and native Rust GPU GUI for editor/result-grid surfaces.
- Turn `docs/extension-development.md` into a working SDK scaffold and first sample extension.
- Scaffold the Tauri/Rust workspace.
- Choose the first editor engine after a Vim-mode and completion spike.
- Implement SQLite/PostgreSQL vertical slice before broadening the adapter surface.
