window.IRODORI_SEARCH_INDEX = [
  {
    title: "Irodori Table overview",
    category: "Overview",
    url: "docs.html#overview",
    summary: "Rust, Tauri, React, CodeMirror 6. Development preview.",
    tags: ["overview", "status", "preview", "tauri", "rust"],
    body:
      "Irodori Table は開発中の DB workbench。Rust, Tauri, React, CodeMirror 6. Development preview.",
  },
  {
    title: "Quick start",
    category: "Getting started",
    url: "docs.html#quick-start",
    summary: "Run the app, build it, or preview the static site.",
    tags: ["install", "build", "npm", "vite", "tauri", "local"],
    body:
      "apps/desktop. npm install, npm run dev, npm run build. site preview: python3 -m http.server 8080 --directory site.",
  },
  {
    title: "Connections and data sources",
    category: "Connections",
    url: "docs.html#connections",
    summary: "SQL, document, KV, and warehouse sources.",
    tags: ["postgres", "mysql", "oracle", "mongodb", "redis", "snowflake", "bigquery"],
    body:
      "PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, DuckDB, MongoDB, ClickHouse, Snowflake, BigQuery, Redis, Cassandra. SQL, document, key-value, warehouse.",
  },
  {
    title: "DB guide blog",
    category: "Blog",
    url: "blog.html",
    summary: "Irodori Table intro, DB-specific samples, official resources, and coverage notes.",
    tags: [
      "blog",
      "database",
      "samples",
      "postgres",
      "mysql",
      "oracle",
      "mongodb",
      "timescaledb",
      "cockroachdb",
      "tidb",
      "duckdb",
    ],
    body:
      "Irodori Table DB guide. Database-specific sample projects and official resources for PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, SQL Server, Oracle, MongoDB, TimescaleDB, CockroachDB, YugabyteDB, TiDB, Redshift, Neon, Neo4j, Redis, Cassandra, ClickHouse, Snowflake, BigQuery, Bigtable, InfluxDB, Qdrant, Milvus, Pinecone. MySQL Forums. Beekeeper Studio Blog.",
  },
  {
    title: "DB feature samples",
    category: "Samples",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/db-feature-samples.md",
    summary: "Local DB-specific query projects and the catalog validation command.",
    tags: ["samples", "db", "catalog", "docs-check", "verify-db", "feature"],
    body:
      "DB Feature Samples. samples/db-feature-samples.json. samples/projects. PostgreSQL JSONB GIN, MySQL JSON, MariaDB CTE, SQLite FTS5, DuckDB summarize, SQL Server JSON, Oracle DBMS_XPLAN, MongoDB collection filter, TimescaleDB hypertable, CockroachDB unique_rowid, YugabyteDB tablets, TiDB explain analyze.",
  },
  {
    title: "Query editor",
    category: "Editor",
    url: "docs.html#query-editor",
    summary: "Dialect editor, Vim mode, formatting, Run Current, and history.",
    tags: ["editor", "codemirror", "vim", "format", "run current", "history"],
    body:
      "CodeMirror 6 editor. SQL dialect, Vim mode, format, comment toggle, Run Current, selection execution, query history.",
  },
  {
    title: "Lightweight schema-aware completion",
    category: "Completion",
    url: "docs.html#completion",
    summary: "Offline completion for schemas, tables, columns, aliases, and joins.",
    tags: ["completion", "autocomplete", "schema", "alias", "join", "keyword", "offline"],
    body:
      "Offline completion. schema, table, view, column, routine, keyword, alias, foreign-key join snippet. schema dot, alias dot, JOIN.",
  },
  {
    title: "Result grid and export",
    category: "Results",
    url: "docs.html#results",
    summary: "Streaming, capped pages, virtualization, and CSV export.",
    tags: ["results", "grid", "streaming", "virtualization", "csv", "export"],
    body:
      "Results use streaming, capped pages, truncated flag, row virtualization, CSV export.",
  },
  {
    title: "Security and transports",
    category: "Security",
    url: "docs.html#security",
    summary: "Session-only passwords, redaction, audit, SSH, and proxy plans.",
    tags: ["security", "password", "redaction", "ssh", "proxy", "socks", "audit"],
    body:
      "Session-only passwords, secure-store, redaction, audit log, privacy mode, SSH, SOCKS5, HTTP CONNECT, multi-hop proxy.",
  },
  {
    title: "Extension SDK",
    category: "Extensions",
    url: "docs.html#extensions",
    summary: "Manifest, TypeScript SDK, typed APIs, drivers, themes, and views.",
    tags: ["extension", "sdk", "manifest", "typescript", "driver", "theme"],
    body:
      "irodori.extension.json, TypeScript SDK, typed API, theme, result view, driver, SQL dialect API, MIT OR 0BSD templates.",
  },
  {
    title: "Roadmap",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/ROADMAP.md",
    summary: "Product direction, phases, architecture, and research.",
    tags: ["roadmap", "phase", "architecture", "research"],
    body:
      "Roadmap: direction, phases, architecture, research, TablePlus lightness, DataGrip editing, DBeaver coverage, completion, AI, Vim, proxy, i18n, SDK.",
  },
  {
    title: "Implementation progress",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/implementation-progress.md",
    summary: "Built pieces, verified engines, tests, and remaining work.",
    tags: ["progress", "verified", "engine", "desktop", "tests"],
    body:
      "Implementation progress: engine layer, verified engines, desktop UI, tests, samples, remaining work.",
  },
  {
    title: "Feature matrix",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/feature-matrix.md",
    summary: "Capabilities, priorities, backlog status, and coverage.",
    tags: ["feature matrix", "priority", "coverage", "backlog"],
    body:
      "Feature matrix: platforms, local API, DBs, connections, security, editor, completion, AI, results, export, import, extensions.",
  },
  {
    title: "Completion and AI strategy",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/completion-and-ai-strategy.md",
    summary: "Deterministic completion, optional AI, privacy, and MCP.",
    tags: ["completion", "ai", "mcp", "privacy", "offline"],
    body:
      "Completion and AI strategy: deterministic completion first, optional AI, metadata cache, parser context, privacy, MCP.",
  },
  {
    title: "Online execution (Web preview)",
    category: "Getting started",
    url: "try/",
    summary: "Try Irodori Table directly in your web browser with local DuckDB, SQLite (IndexedDB persistence), and mock database connections.",
    tags: ["online", "web", "try", "browser", "duckdb", "sqlite", "indexeddb"],
    body:
      "Try Irodori Table directly in your browser. Web build using DuckDB WASM, local SQLite worker, IndexedDB storage, and online query stream interfaces.",
  },
];
