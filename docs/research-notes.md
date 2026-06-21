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

## Platform And Editor References

- Tauri v2 is the default desktop shell candidate because it targets small, fast, secure cross-platform apps and lets Rust own application logic while the UI uses a web frontend: https://v2.tauri.app/
- Tree-sitter is a parser generator and incremental parsing library designed to update syntax trees as a source file changes; this maps well to SQL editor highlighting, selection, outline, and completion context: https://tree-sitter.github.io/tree-sitter/
- Tree-sitter highlighting uses queries such as highlights, locals, and injections, so an Irodori theme/token pipeline should not assume TextMate-only scopes: https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html
- VS Code themes separate workbench colors, syntax colors, TextMate themes, and semantic token colors. VS Code-compatible import should normalize these into Irodori's own theme model: https://code.visualstudio.com/api/extension-guides/color-theme
- WezTerm is a useful performance reference because it is a Rust, GPU-accelerated, cross-platform terminal emulator and multiplexer: https://github.com/wezterm/wezterm
- WezTerm's WebGPU front end documents GPU acceleration across platform backends such as Metal, Vulkan, and DirectX 12; Irodori should study the rendering lesson, not copy implementation: https://wezterm.org/config/lua/config/front_end.html

## Paper Watchlist

- Text-to-SQL survey work is directly relevant to schema-aware completion, especially schema linking, database-content retrieval, and prompt/context construction for large schemas: https://arxiv.org/html/2408.05109v6
- SQL issue debugging research is relevant to optional query-repair assistance, but any AI feature should be opt-in, privacy-aware, and explainable before it enters the core workflow: https://arxiv.org/html/2506.18951v4

## Design Implications

- Completion should be split into deterministic local intelligence first, optional AI second.
- The metadata cache should model relationships, aliases, recent query context, CTEs, subqueries, functions/procedures, and dialect-specific object kinds.
- Theme import should treat VS Code compatibility as an adapter, not as the internal source of truth.
- Tree-sitter should be evaluated per dialect; SQL grammar quality varies, and Oracle/PLSQL may need separate parsing strategy.
- GPU acceleration is most likely to matter for editor text, result-grid scrolling, selection painting, minimap/overview widgets, and very large query output; the app still needs a stable software path for remote desktops, older GPUs, and driver quirks.
- Tauri should not be treated as irreversible. Before the editor/grid architecture hardens, benchmark Tauri WebView rendering, WebView canvas/WebGPU rendering, and native Rust GUI/GPU surfaces with realistic data sizes.
- Beekeeper should be beaten quickly by matching the OSS daily-driver baseline, then overtaking it on responsiveness, shortcuts, Vim, multi-hop proxying, Oracle readiness, and completion quality.
- Extension APIs should be designed early so drivers, themes, result renderers, commands, keybindings, proxy transports, and SQL dialect intelligence do not become hard-coded core-only features.
- Legal safety is a product requirement: proprietary behavior can inform feature goals clean-room style; OSS code can inform implementation only under verified license rules compatible with a permissive `MIT OR 0BSD` core.
