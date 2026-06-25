# Research Notes

Last checked: 2026-06-21 JST.

## Product References

- TablePlus GitHub is mainly public issue trackers and small/plugin repositories, so use it as a public behavior/reference surface rather than source for implementation: https://github.com/TablePlus
- TablePlus docs list editor basics such as opening the query editor, current/all query execution, cancellation, and exporting SQL: https://docs.tableplus.com/query-editor/untitled
- TablePlus autocomplete suggests databases, tables, keywords, and columns, with settings for tables, keywords, schema prefixing, and keyword casing: https://docs.tableplus.com/query-editor/autocomplete
- A5:SQL Mk-2 highlights direct Oracle/PostgreSQL/MySQL/SQLite connections, Ctrl+Space SQL completion that parses statements including CTEs/subqueries, explain plans, GUI query design, ER editor, and AI assistant features: https://a5m2.mmatsubara.com/index.en.html
- A5:SQL Mk-2 reaches Oracle without the Oracle Client through a *direct connection* (thin) mode that speaks Oracle Net/TNS itself (built on the commercial Delphi UniDAC component). A5 is closed source — the author's GitHub states the repo is "not public" — so Irodori studies the thin approach only, never A5/UniDAC code: https://github.com/m-matsubara
- Beekeeper Studio local docs and code are useful for supported database breadth, editable results, query parameters, history, transaction handling, and Vim-mode expectations. Local `LICENSE.md` says Community Edition is GPLv3-or-later and `src-commercial` is under a separate commercial license, so direct code adaptation needs compatibility review.
- SQLTools local docs and MIT-licensed code are useful for connection-bound session files, attach/detach connection behavior, command-driven query execution, bookmarks, history, and query parameter handling.
- Irodori's own code should be `MIT OR 0BSD`: MIT for familiarity, 0BSD for users who want the easiest possible copy/fork path.
- DataGrip, DBeaver, DbVisualizer, and VS Code MSSQL are now tracked in `docs/db-client-market-scan-2026-06-21.md` as current market inputs.
- YugabyteDB, InfluxDB, Neo4j, MongoDB Compass, Studio 3T, RedisInsight, DbGate, and other source-specific GUI expectations are tracked through `docs/data-source-coverage-strategy.md` and the market scan.
- Official DB docs and release notes are tracked through `knowledge/sources.json` and can be snapshotted into a local SQLite DB for implementation and bug-fix reference.
- DuckDB UI (`ref/duckdb-ui-main`, MIT) is a reference for local-first analytical exploration, fast in-process data browsing, and Parquet/Iceberg reads; MIT permits selective code adaptation with attribution: https://github.com/duckdb/duckdb-ui
- Kibana (`ref/kibana-main`) is a search/observability query-and-browse reference (Discover, Dev Tools console). It is source-available under Elastic License 2.0 / SSPL / AGPL-3.0, so treat it as behavior-only: https://www.elastic.co/kibana
- Outerbase Studio (`outerbase/studio`, AGPL-3.0) is a lightweight web/Electron DB GUI for SQLite/Turso/LibSQL/Cloudflare D1 plus beta MySQL/PostgreSQL; strong references for a staged-changes data editor (edit then commit), a no-SQL schema editor, function-hint completion, and an optimized data table for thousands of rows/columns. AGPL is copyleft → study UX/architecture only, no code into the permissive core: https://github.com/outerbase/studio
- DBeaver (`ref/dbeaver-ce`, **Apache-2.0** — permissive, adaptable with attribution; 2 vendored Eclipse helpers are EPL-2.0, avoid those) is the universal-DB benchmark (200+ engines). Lessons we are adopting: a data-driven driver registry (`DBPDataSourceProvider`) plus a generic JDBC metamodel that per-engine subclasses override only where they differ; per-type `DBDValueHandler`s that bind decimals with `setBigDecimal` (never float) and preserve timestamp offsets; two-tier lazy metadata caches loaded on navigator expand; cooperative cancellation via a progress monitor; and a per-engine `SQLDialect` for quoting/keywords: https://github.com/dbeaver/dbeaver
- Zequel (`zequel-labs/zequel`, **Elastic License 2.0** — source-available, behavior-only) is an Electron/Vue desktop client across PostgreSQL/MySQL/MariaDB/SQLite/DuckDB/MongoDB/Redis/ClickHouse/SQL Server; reference for a Monaco editor, a virtual-scrolled grid with in-cell editing and bulk ops, ER diagrams, CSV/JSON/SQL/Excel import-export, SSH tunneling, and OS credential storage: https://github.com/zequel-labs/zequel
- Apache Iceberg is the priority lakehouse target; model catalogs (Hive Metastore, AWS Glue, REST, JDBC) and AWS S3 Tables in the adapter, not as ad-hoc forms: https://iceberg.apache.org/spec/
- Snowflake needs full auth coverage (password, key-pair/JWT, OAuth, external browser/SSO, MFA, programmatic access tokens), modeled in the connection profile: https://docs.snowflake.com/en/user-guide/key-pair-auth
- Snowsight/Workspaces should be tracked as a cross-platform analysis UX benchmark, not a one-for-one parity claim: interactive result filters/statistics, query profile, dashboards/charts, and Snowflake Copilot inline assistance are useful reference points. Current Irodori gaps are user-facing schema/table/column autocomplete beyond keywords, optional Copilot-style inline suggestions, charts/dashboards, explain/query profile, full inline editing, and advanced filters: https://docs.snowflake.com/en/user-guide/ui-snowsight/workspaces-working and https://docs.snowflake.com/en/user-guide/snowflake-copilot-inline

## Platform And Editor References

- Tauri v2 is the default desktop shell candidate because it targets small, fast, secure cross-platform apps and lets Rust own application logic while the UI uses a web frontend: https://v2.tauri.app/
- Tree-sitter is a parser generator and incremental parsing library designed to update syntax trees as a source file changes; this maps well to SQL editor highlighting, selection, outline, and completion context: https://tree-sitter.github.io/tree-sitter/
- Tree-sitter highlighting uses queries such as highlights, locals, and injections, so an Irodori theme/token pipeline should not assume TextMate-only scopes: https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html
- VS Code themes separate workbench colors, syntax colors, TextMate themes, and semantic token colors. VS Code-compatible import should normalize these into Irodori's own theme model: https://code.visualstudio.com/api/extension-guides/color-theme
- WezTerm is a useful performance reference because it is a Rust, GPU-accelerated, cross-platform terminal emulator and multiplexer: https://github.com/wezterm/wezterm
- WezTerm's WebGPU front end documents GPU acceleration across platform backends such as Metal, Vulkan, and DirectX 12; Irodori should study the rendering lesson, not copy implementation: https://wezterm.org/config/lua/config/front_end.html
- Zed (`zed-industries/zed`) is a fast Rust-native desktop editor and a reference for GPUI rendering, input latency, multibuffer/pane models, and Rust app structure. It is copyleft (GPL-3.0/AGPL-3.0 with some Apache-2.0 crates), so study architecture without copying code into the permissive core: https://github.com/zed-industries/zed
- Lapce and Helix are additional fast Rust editor references for startup time, modal editing, and large-document handling: https://github.com/lapce/lapce and https://github.com/helix-editor/helix
- Internationalization should use an ICU MessageFormat / Project Fluent style catalog shared by Rust and the web UI, with ja/en as the first locales: https://projectfluent.org/
- Local data API patterns to study before building `irodori-server`: PostgREST (declarative REST over Postgres) and DuckDB's httpserver extension: https://postgrest.org/ and https://duckdb.org/community_extensions/extensions/httpserver.html
- Oracle thin-driver path (no Instant Client), the client-free route A5 uses: `oracle-rs` is a pure-Rust Oracle TNS driver (MIT/Apache-2.0, Tokio, TLS/Wallet) but early-stage (v0.1; many enterprise features still planned). JDBC Thin and python-oracledb/node-oracledb thin modes are the mature precedents. Irodori should inherit/harden `oracle-rs` rather than require the Instant Client: https://github.com/stiang/oracle-rs
- GitHub Copilot can be extended with MCP in supported environments, so Irodori should expose privacy-safe, scoped MCP tools before trying any direct Copilot embedding. The tool contracts should be reusable by desktop, the local API, and future hosts, and should separately gate selected SQL, schema metadata, history, execution plans, and result samples: https://docs.github.com/en/copilot/concepts/context/mcp
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
- Snowsight-style parity gaps are product-wide contracts, not desktop-only screens: schema-aware completion, optional Copilot-style inline help, explain/query profile, advanced filters, inline editing, and dashboards must be shared across desktop, local API, and future hosts.
- The metadata cache should model relationships, aliases, recent query context, CTEs, subqueries, functions/procedures, and dialect-specific object kinds.
- Deterministic schema-aware completion is a P0 product requirement, but the current user-facing product should still be treated as keyword autocomplete only until schema/table/column suggestions are wired and tested through the shared completion contract.
- Copilot-style inline autocomplete is a P1 parity gap, while broader AI assistance can remain later; every AI path must be optional, auditable, redacted, and permission-scoped.
- Query Magics and AI Shell are open work. Query Magics should stay deterministic/local command expansions, while AI Shell should remain an opt-in assistant that proposes text or calls explicitly scoped read-only tools.
- Theme import should treat VS Code compatibility as an adapter, not as the internal source of truth.
- Tree-sitter should be evaluated per dialect; SQL grammar quality varies, and Oracle/PLSQL may need separate parsing strategy.
- GPU acceleration is most likely to matter for editor text, result-grid scrolling, selection painting, minimap/overview widgets, and very large query output; the app still needs a stable software path for remote desktops, older GPUs, and driver quirks.
- Tauri should not be treated as irreversible. Before the editor/grid architecture hardens, benchmark Tauri WebView rendering, WebView canvas/WebGPU rendering, and native Rust GUI/GPU surfaces with realistic data sizes.
- Beekeeper should be beaten quickly by matching the OSS daily-driver baseline, then overtaking it on responsiveness, shortcuts, Vim, multi-hop proxying, Oracle readiness, and completion quality.
- Extension APIs should be designed early so drivers, themes, result renderers, commands, keybindings, proxy transports, and SQL dialect intelligence do not become hard-coded core-only features.
- Data-source adapter APIs should be broader than SQL drivers so time-series, graph, document, KV, search, warehouse, distributed SQL, and local embedded sources can share shell/workspace behavior while keeping native query and result models.
- Rust/TypeScript command and extension payloads should be generated from Rust/schema sources. Rust can keep `snake_case`, Serde emits `camelCase` JSON, and generated TypeScript prevents drift.
- Legal safety is a product requirement: proprietary behavior can inform feature goals clean-room style; OSS code can inform implementation only under verified license rules compatible with a permissive `MIT OR 0BSD` core.
- Export/import should be a shared encoder layer (`irodori-io`), not per-grid code: CSV/TSV with header toggle and delimiter control, SQL INSERT/UPSERT, JSON/NDJSON, Avro, and Parquet, with dialect-aware dump/restore.
- i18n is a foundational concern, not a late polish step; ja/en catalogs should exist as soon as the shell has user-facing strings.
- A headless local data API (`irodori-server`) should reuse the adapter, proxy, and security model, default to read-only, and require explicit opt-in plus token scopes for writes.
- Test automation should be designed in from day one: unit tests, integration against ephemeral databases, golden snapshots for generated bindings, and headless UI smoke tests, all runnable in CI.
- Hover inspection is metadata-cache-driven: type, nullability, keys, indexes, DDL, comments, row-count estimate, and a quick sample, so it must share the introspection model with completion.
