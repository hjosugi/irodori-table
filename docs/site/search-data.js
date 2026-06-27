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
      "apps/desktop. npm install, npm run dev, npm run build. site preview: python3 -m http.server 8080 --directory docs/site.",
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
      "Irodori Table DB guide. Database-specific sample projects and official resources for PostgreSQL, MySQL, MariaDB, SQLite, DuckDB, SQL Server, Oracle, MongoDB, TimescaleDB, CockroachDB, YugabyteDB, TiDB, Redshift, Neon, Supabase, Aurora, Cloud SQL, Apache Iceberg, S3 Tables, Neo4j, Redis, Cassandra, ClickHouse, Snowflake, BigQuery, Bigtable, InfluxDB, Qdrant, Milvus, Pinecone. MySQL Forums. Beekeeper Studio Blog.",
  },
  {
    title: "DB feature samples",
    category: "Samples",
    url: "https://hjosugi.github.io/irodori-docs/db-feature-samples.html",
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
    summary: "Offline completion plus metadata hover and jump.",
    tags: ["completion", "autocomplete", "schema", "alias", "join", "keyword", "offline", "hover", "jump"],
    body:
      "Offline completion. schema, table, view, column, routine, keyword, alias, foreign-key join snippet. schema dot, alias dot, JOIN. Hover inspection shows DDL, keys, indexes, comments, samples. F12, Ctrl click, Cmd click metadata jump.",
  },
  {
    title: "Result grid and export",
    category: "Results",
    url: "docs.html#results",
    summary: "Streaming, capped pages, virtualization, disk offload, and multi-format export.",
    tags: ["results", "grid", "streaming", "virtualization", "csv", "json", "markdown", "export", "offload"],
    body:
      "Results use streaming, capped pages, truncated flag, row virtualization, disk offload, windowed paging, CSV, TSV, JSON, JSONL, SQL INSERT, Excel HTML, Markdown export.",
  },
  {
    title: "Git graph workbench",
    category: "Git",
    url: "docs.html#git",
    summary: "Commit graph with ref filters, detail pane, and keyboard navigation.",
    tags: ["git", "graph", "branch", "remote", "tag", "keyboard", "commit"],
    body:
      "Git drawer graph. Commit search by subject hash author ref. Branch remote tag filters. Commit detail pane with refs hash author date parents. ArrowUp ArrowDown Home End keyboard navigation. Provider badges and repository colors.",
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
    title: "Documentation guide",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/README.md",
    summary: "Where each status, runbook, generated-doc, and public-site document belongs.",
    tags: ["docs", "index", "source of truth", "site", "generated"],
    body:
      "Documentation guide: fast paths, source-of-truth rules, public site, generated docs, cleanup rules.",
  },
  {
    title: "Implementation progress",
    category: "Project docs",
    url: "https://hjosugi.github.io/irodori-docs/implementation-progress.html",
    summary: "Built pieces, verified engines, tests, and remaining work.",
    tags: ["progress", "verified", "engine", "desktop", "tests"],
    body:
      "Implementation progress: engine layer, verified engines, desktop UI, tests, samples, remaining work.",
  },
  {
    title: "Data source support status",
    category: "Project docs",
    url: "https://github.com/hjosugi/irodori-table/blob/main/docs/data-source-support-status.md",
    summary: "Wired, verified, planned, and recognized database engines.",
    tags: ["engine", "database", "support", "postgres", "mysql", "oracle", "snowflake", "bigquery", "redis"],
    body:
      "Data source support status: wired engines, verified engines, recognized no connector, managed wire-compatible targets, Iceberg and S3 Tables gaps.",
  },
  {
    title: "Feature matrix",
    category: "Project docs",
    url: "https://hjosugi.github.io/irodori-docs/feature-matrix.html",
    summary: "Capabilities, priorities, backlog status, and coverage.",
    tags: ["feature matrix", "priority", "coverage", "backlog"],
    body:
      "Feature matrix: platforms, local API, DBs, connections, security, editor, completion, AI, results, export, import, extensions.",
  },
  {
    title: "Completion and AI strategy",
    category: "Project docs",
    url: "https://hjosugi.github.io/irodori-docs/completion-and-ai-strategy.html",
    summary: "Deterministic completion, optional AI, privacy, and MCP.",
    tags: ["completion", "ai", "mcp", "privacy", "offline"],
    body:
      "Completion and AI strategy: deterministic completion first, optional AI, metadata cache, parser context, privacy, MCP.",
  },
];
