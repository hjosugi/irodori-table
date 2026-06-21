# Research Notes

Last checked: 2026-06-21 JST.

## Product References

- TablePlus GitHub is mainly public issue trackers and small/plugin repositories, so use it as a public behavior/reference surface rather than source for implementation: https://github.com/TablePlus
- TablePlus docs list editor basics such as opening the query editor, current/all query execution, cancellation, and exporting SQL: https://docs.tableplus.com/query-editor/untitled
- TablePlus autocomplete suggests databases, tables, keywords, and columns, with settings for tables, keywords, schema prefixing, and keyword casing: https://docs.tableplus.com/query-editor/autocomplete
- A5:SQL Mk-2 highlights direct Oracle/PostgreSQL/MySQL/SQLite connections, Ctrl+Space SQL completion that parses statements including CTEs/subqueries, explain plans, GUI query design, ER editor, and AI assistant features: https://a5m2.mmatsubara.com/index.en.html
- Beekeeper Studio local docs and code are useful for supported database breadth, editable results, query parameters, history, transaction handling, and Vim-mode expectations. Local `LICENSE.md` says Community Edition is GPLv3-or-later and `src-commercial` is under a separate commercial license, so direct code adaptation needs compatibility review.
- SQLTools local docs and MIT-licensed code are useful for connection-bound session files, attach/detach connection behavior, command-driven query execution, bookmarks, history, and query parameter handling.
- Irodori's own code should be `MIT OR 0BSD`: MIT for familiarity, 0BSD for users who want the easiest possible copy/fork path.
- DataGrip, DBeaver, DbVisualizer, and VS Code MSSQL are now tracked in `docs/db-client-market-scan-2026-06-21.md` as current market inputs.
- YugabyteDB, InfluxDB, Neo4j, MongoDB Compass, Studio 3T, RedisInsight, DbGate, and other source-specific GUI expectations are tracked through `docs/data-source-coverage-strategy.md` and the market scan.
- Official DB docs and release notes are tracked through `knowledge/sources.json` and can be snapshotted into a local SQLite DB for implementation and bug-fix reference.

## Platform And Editor References

- Tauri v2 is the default desktop shell candidate because it targets small, fast, secure cross-platform apps and lets Rust own application logic while the UI uses a web frontend: https://v2.tauri.app/
- Tree-sitter is a parser generator and incremental parsing library designed to update syntax trees as a source file changes; this maps well to SQL editor highlighting, selection, outline, and completion context: https://tree-sitter.github.io/tree-sitter/
- Tree-sitter highlighting uses queries such as highlights, locals, and injections, so an Irodori theme/token pipeline should not assume TextMate-only scopes: https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html
- VS Code themes separate workbench colors, syntax colors, TextMate themes, and semantic token colors. VS Code-compatible import should normalize these into Irodori's own theme model: https://code.visualstudio.com/api/extension-guides/color-theme
- WezTerm is a useful performance reference because it is a Rust, GPU-accelerated, cross-platform terminal emulator and multiplexer: https://github.com/wezterm/wezterm
- WezTerm's WebGPU front end documents GPU acceleration across platform backends such as Metal, Vulkan, and DirectX 12; Irodori should study the rendering lesson, not copy implementation: https://wezterm.org/config/lua/config/front_end.html
- GitHub Copilot can be extended with MCP in supported environments, so Irodori should expose safe MCP tools before trying any direct Copilot embedding: https://docs.github.com/en/copilot/concepts/context/mcp
- `ts-rs` generates TypeScript declarations from Rust types and supports Serde compatibility, making it a strong MVP candidate for desktop command payloads: https://github.com/Aleph-Alpha/ts-rs
- `specta` exports Rust types to other languages and has TypeScript, JSON Schema, Zod, and Tauri-adjacent ecosystem pieces, making it a strong candidate if command metadata and validators become central: https://github.com/specta-rs/specta
- `typeshare` is useful as a CLI-oriented multi-language type sharing reference: https://github.com/1Password/typeshare
- `schemars` is useful when Rust types need JSON Schema output aligned with Serde behavior: https://github.com/GREsau/schemars
- YugabyteDB exposes YSQL and YCQL surfaces; Irodori should start with YSQL/PostgreSQL compatibility but keep distributed-database metadata in the adapter model: https://docs.yugabyte.com/stable/api/ysql/
- InfluxDB 3 supports SQL queries over time-series data; Irodori should model time ranges, frames, tags/fields, windows, and downsampling explicitly: https://docs.influxdata.com/influxdb3/core/query-data/sql/
- Neo4j Browser is a Cypher developer tool with tabular and graph visualization result modes; Irodori's graph support should start with query-result graph rendering before broader graph workspace features: https://neo4j.com/docs/browser/

## Paper Watchlist

- Text-to-SQL survey work is directly relevant to schema-aware completion, especially schema linking, database-content retrieval, and prompt/context construction for large schemas: https://arxiv.org/html/2408.05109v6
- SQL issue debugging research is relevant to optional query-repair assistance, but any AI feature should be opt-in, privacy-aware, and explainable before it enters the core workflow: https://arxiv.org/html/2506.18951v4

## Design Implications

- Completion should be split into deterministic local intelligence first, optional AI second.
- The metadata cache should model relationships, aliases, recent query context, CTEs, subqueries, functions/procedures, and dialect-specific object kinds.
- Deterministic completion is a P0 product requirement. AI completion is a P2 provider layer and must be optional, auditable, redacted, and permission-scoped.
- Theme import should treat VS Code compatibility as an adapter, not as the internal source of truth.
- Tree-sitter should be evaluated per dialect; SQL grammar quality varies, and Oracle/PLSQL may need separate parsing strategy.
- GPU acceleration is most likely to matter for editor text, result-grid scrolling, selection painting, minimap/overview widgets, and very large query output; the app still needs a stable software path for remote desktops, older GPUs, and driver quirks.
- Tauri should not be treated as irreversible. Before the editor/grid architecture hardens, benchmark Tauri WebView rendering, WebView canvas/WebGPU rendering, and native Rust GUI/GPU surfaces with realistic data sizes.
- Beekeeper should be beaten quickly by matching the OSS daily-driver baseline, then overtaking it on responsiveness, shortcuts, Vim, multi-hop proxying, Oracle readiness, and completion quality.
- Extension APIs should be designed early so drivers, themes, result renderers, commands, keybindings, proxy transports, and SQL dialect intelligence do not become hard-coded core-only features.
- Data-source adapter APIs should be broader than SQL drivers so time-series, graph, document, KV, search, warehouse, distributed SQL, and local embedded sources can share shell/workspace behavior while keeping native query and result models.
- Rust/TypeScript command and extension payloads should be generated from Rust/schema sources. Rust can keep `snake_case`, Serde emits `camelCase` JSON, and generated TypeScript prevents drift.
- Legal safety is a product requirement: proprietary behavior can inform feature goals clean-room style; OSS code can inform implementation only under verified license rules compatible with a permissive `MIT OR 0BSD` core.
