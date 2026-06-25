window.IRODORI_SEARCH_INDEX = [
  {
    title: "Irodori Table overview",
    category: "Overview",
    url: "docs.html#overview",
    summary: "Rust-first core, Tauri desktop, React UI, CodeMirror 6 editor. Development preview.",
    tags: ["overview", "status", "preview", "tauri", "rust"],
    body:
      "Irodori Table は軽量なオープンソース DB ワークベンチを目指す開発中プロジェクトです。Rust core, Tauri desktop shell, React UI, CodeMirror 6 editor. Development preview. 安定リリース前で、接続エンジン、クエリ実行、結果表示、補完、拡張基盤を検証しています。",
  },
  {
    title: "Quick start",
    category: "Getting started",
    url: "docs.html#quick-start",
    summary: "Install dependencies, run the Vite preview, build the desktop app, and preview the site.",
    tags: ["install", "build", "npm", "vite", "tauri", "local"],
    body:
      "apps/desktop にデスクトップアプリがあります。cd apps/desktop, npm install, npm run dev. ブラウザ preview は Tauri API がない場合 mock shell として動きます。実接続や OS 機能は Tauri shell で確認します。npm run build は typegen, tsc, vite build を実行します。site は python3 -m http.server 8080 --directory site で確認できます。",
  },
  {
    title: "Connections and data sources",
    category: "Connections",
    url: "docs.html#connections",
    summary: "PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, DuckDB, MongoDB, warehouses, KV, and document stores.",
    tags: ["postgres", "mysql", "oracle", "mongodb", "redis", "snowflake", "bigquery"],
    body:
      "接続層は SQL だけでなく document, key-value, warehouse 系にも広げています。PostgreSQL, MySQL, MariaDB, CockroachDB, TimescaleDB, YugabyteDB, TiDB, SQL Server, DuckDB, MongoDB, Oracle, SQLite, ClickHouse, Snowflake, BigQuery, Redis, Cassandra, Redshift. UI と metadata 品質はエンジンごとに差があり、implementation progress が検証状況の正です。",
  },
  {
    title: "Query editor",
    category: "Editor",
    url: "docs.html#query-editor",
    summary: "CodeMirror 6 SQL editor with dialects, Vim mode, formatting, comments, Run Current, selection execution, and history.",
    tags: ["editor", "codemirror", "vim", "format", "run current", "history"],
    body:
      "エディタは CodeMirror 6 を使います。エンジンに応じた SQL dialect, Vim mode, format action, comment toggle, Run Current, selection execution の導線があります。クエリ履歴は接続ごとに残り、elapsed time, row count, truncated status を表示します。",
  },
  {
    title: "Lightweight schema-aware completion",
    category: "Completion",
    url: "docs.html#completion",
    summary: "Offline deterministic completion for schema, table, view, column, routine, keyword, alias, and FK join snippets.",
    tags: ["completion", "autocomplete", "schema", "alias", "join", "keyword", "offline"],
    body:
      "補完は外部サービスや AI に依存しません。現在の文、カーソル周辺、ローカル metadata を浅く見て、schema, table, view, column, routine, keyword, alias, foreign-key join snippet を候補にします。schema dot から relation、alias dot から column、JOIN relation position で table alias on left.col = right.col 形式の候補を出します。巨大なインデックスや重い全体解析ではなく入力を止めないことを優先しています。",
  },
  {
    title: "Result grid and export",
    category: "Results",
    url: "docs.html#results",
    summary: "Streaming result sets, capped pages, row virtualization, truncated status, and CSV export.",
    tags: ["results", "grid", "streaming", "virtualization", "csv", "export"],
    body:
      "結果はストリーミングと上限付き取得を前提にしています。巨大 result set を丸ごとメモリに積まず、truncated flag で上限到達を示します。UI は row virtualization で表示行を絞り、CSV export を提供します。複数 result set, copy, sort, filter, run-to-file は段階的に拡張します。",
  },
  {
    title: "Security and transports",
    category: "Security",
    url: "docs.html#security",
    summary: "Session-only passwords, secure-store, redaction, audit log, SSH, SOCKS5, HTTP CONNECT, and multi-hop proxy plans.",
    tags: ["security", "password", "redaction", "ssh", "proxy", "socks", "audit"],
    body:
      "パスワードは UI で session-only として扱い永続化対象から外します。Rust 側には secure-store, redaction, audit log, privacy mode, direct socket, SSH tunnel, SOCKS5 proxy, HTTP CONNECT proxy, ordered multi-hop proxy chain の設計があります。接続エラーは secret redaction されます。",
  },
  {
    title: "Extension SDK",
    category: "Extensions",
    url: "docs.html#extensions",
    summary: "Extension manifest, TypeScript SDK, typed APIs, local dev fixtures, themes, drivers, result views, and dialect APIs.",
    tags: ["extension", "sdk", "manifest", "typescript", "driver", "theme"],
    body:
      "拡張 SDK は irodori.extension.json, TypeScript SDK, typed API, dev fixture, theme, result view, driver, SQL dialect API を段階的に公開する方針です。公式 template は MIT OR 0BSD に揃えます。packages/extension-sdk と examples/extensions に初期の scaffold があります。",
  },
  {
    title: "Roadmap",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/ROADMAP.md",
    summary: "Non-negotiables, reference surface, phases, architecture direction, and research watchlist.",
    tags: ["roadmap", "phase", "architecture", "research"],
    body:
      "Roadmap は non-negotiables, reference surface, architecture direction, phases, research watchlist を管理します。TablePlus-level lightness, DataGrip-level editing, DBeaver-level coverage, deterministic completion, optional AI, keybindings, Vim, proxy chains, i18n, extension SDK, local API を追跡しています。",
  },
  {
    title: "Implementation progress",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/implementation-progress.md",
    summary: "Built and verified engine layer, desktop UI wiring, tests, samples, and remaining work.",
    tags: ["progress", "verified", "engine", "desktop", "tests"],
    body:
      "Implementation progress は database engine layer, verified engines, network and security foundation, desktop UI wiring, test and sample infrastructure, not done yet をまとめます。PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, DuckDB, MongoDB, SQLite, ClickHouse, Snowflake, BigQuery, Redis, Cassandra などの実装状況を追跡します。",
  },
  {
    title: "Feature matrix",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/feature-matrix.md",
    summary: "Capability goals, priorities, reference signals, backlog status, and data-source coverage.",
    tags: ["feature matrix", "priority", "coverage", "backlog"],
    body:
      "Feature matrix は platforms, local API, core DBs, source families, connections, security, performance, editor, keybindings, completion, AI, knowledge, type bridge, browser, results, export, import, visualization, extensibility を P0/P1/P2/Later で整理します。",
  },
  {
    title: "Completion and AI strategy",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/completion-and-ai-strategy.md",
    summary: "Deterministic completion first, optional AI layer, provider model, privacy rules, and MCP direction.",
    tags: ["completion", "ai", "mcp", "privacy", "offline"],
    body:
      "Completion and AI strategy は deterministic completion first を掲げます。SQL, Cypher, time-series, document, KV, search, warehouse dialects を対象に、metadata cache, parser context, dialect metadata, scope resolver, query-local symbols, ranking を使います。AI は optional, provider-based, audit-friendly, privacy controlled です。",
  },
];
