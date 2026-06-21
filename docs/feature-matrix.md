# Feature Matrix

This is a seed matrix for roadmap planning. It captures capability goals in our own words and keeps implementation independent.

Legend: P0 = first usable product, P1 = daily-driver quality, P2 = advanced/polish, Later = defer.

| Area | Capability | Priority | Reference Signals |
| --- | --- | --- | --- |
| Platforms | Windows, macOS, Linux desktop builds | P0 | Tauri, Beekeeper parity goal |
| Core DBs | SQLite, PostgreSQL | P0 | Minimum vertical slice |
| Core DBs | MySQL/MariaDB, SQL Server | P1 | Modern client baseline |
| Core DBs | Oracle Database | P1 | User requirement, A5:SQL, Beekeeper paid support |
| Core DBs | DuckDB, ClickHouse, BigQuery, Redshift, CockroachDB, Firebird, Trino/Presto, Snowflake | P2 | Current client landscape |
| Connections | Direct host/port, Unix socket where relevant, local file DBs | P0 | Baseline |
| Connections | SSH tunnel | P1 | Current client baseline |
| Connections | SOCKS5/HTTP CONNECT proxy | P1 | User requirement |
| Connections | Multi-hop proxy chain | P1 | User requirement, differentiator |
| Security | OS keychain-backed secrets | P0 | Baseline safety |
| Security | Privacy/redaction mode | P1 | Screenshare/log safety |
| Performance | Virtualized editor and result-grid rendering | P0 | Large SQL files and large result sets |
| Performance | GPU-aware rendering path with software fallback | P1 | WezTerm-style performance reference |
| Performance | Compare Tauri WebView vs native Rust GUI/GPU surfaces | P0 | Avoid painting ourselves into a slow UI corner |
| Baseline | Quickly beat Beekeeper Studio OSS daily-driver workflow | P0 | First competitive checkpoint |
| Editor | Run current statement, selection, all statements | P0 | TablePlus, Beekeeper, SQLTools |
| Editor | Cancel running query | P0 | TablePlus-like core workflow |
| Editor | Multiple result sets | P0 | TablePlus/Beekeeper baseline |
| Editor | Query parameters | P1 | Beekeeper, SQLTools |
| Editor | Query history and saved queries | P0 | TablePlus, Beekeeper, SQLTools |
| Editor | Tab folders/groups and named sessions | P1 | User requirement |
| Editor | Arbitrary split panes and persisted layout | P1 | User requirement, TablePlus split panes |
| Editor | Multiple cursors | P1 | Modern editor baseline |
| Editor | SQL formatter hooks | P1 | Current client baseline |
| Editor | Serious Vim mode | P1 | User requirement |
| Keybindings | Fully remappable shortcuts with scopes and conflict UI | P0 | User requirement |
| Keybindings | Presets for TablePlus-like, VS Code-like, JetBrains-like, Vim-heavy | P1 | Power-user adoption |
| Completion | Tables, columns, schemas, keywords | P0 | TablePlus docs |
| Completion | Aliases, CTEs, subqueries, functions, procedures | P1 | A5:SQL signal, user requirement |
| Completion | Dialect-aware ranking and insert behavior | P1 | Daily-driver quality |
| Completion | Optional AI assistance | P2 | A5:SQL signal, research watchlist |
| Browser | Schemas, tables, views, columns, indexes | P0 | Baseline |
| Browser | Functions, procedures, triggers, packages | P1 | Oracle/enterprise needs |
| Results | Virtualized result grid | P0 | Performance requirement |
| Results | Copy, CSV export, basic filtering/sorting | P0 | Baseline |
| Results | Editable result rows with safe transaction flow | P1 | Current client baseline |
| Results | Run-to-file for huge result sets | P1 | Large data workflow |
| Schema | Table designer for columns/indexes/constraints | P1 | Current client baseline |
| Schema | Explain plan viewer | P1 | A5:SQL, enterprise workflow |
| Schema | Schema compare and migration preview | P2 | Advanced client baseline |
| Themes | Internal theme model | P0 | Consistent UI |
| Themes | VS Code color theme import where license permits | P1 | User requirement |
| Licensing | Irodori-authored code under MIT OR 0BSD | P0 | Familiar and fully free to copy/fork/ship |
| Extensibility | Extension manifest and TypeScript SDK | P1 | Easy extension development |
| Extensibility | Driver/theme/plugin API | P1 | Long-term ecosystem |
| Extensibility | Rust/Wasm extension path | P2 | High-performance add-ons |
| Visualization | ERD and graph views | Later | Explicitly lower priority |

## Reference Projects In Workspace

- `ref/beekeeper-studio-master/`: use docs, public behavior, and license-aware OSS code review as a broad SQL GUI baseline. Local `LICENSE.md` says GPLv3-or-later for Community Edition and excludes `src-commercial` under a separate commercial license.
- `ref/vscode-sqltools-dev/`: use docs, public behavior, and MIT-licensed code review for connection-bound sessions, command workflows, query params, and editor expectations.
- `ref/vscode-mssql-main/`: use docs, public behavior, and MIT-licensed code review for SQL Server workflows and VS Code integration patterns.
- `ref/budibase-master/`: lower-priority reference for app-builder style data browsing and admin UI patterns; verify license before code-level adaptation.

Do not copy implementation from these directories into Irodori Table unless license compatibility, attribution, and adaptation scope are explicit.
