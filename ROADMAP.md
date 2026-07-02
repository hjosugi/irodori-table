# Irodori Table Roadmap

Irodori Table aims to be a fast, open-source, cross-platform SQL GUI for people
who live in databases all day. The north star is TablePlus-level lightness and
directness, with the openness, keyboard control, dialect coverage, and automation
depth that current clients still miss.

## How This File Is Used

This file is the stable product and architecture direction. It should not carry
implementation checklists, current bug queues, release notes, or task-level
status.

- Current implementation work lives in GitHub Issues.
- Durable public planning and policy pages live in `irodori-docs`.
- Generated source coverage and marketplace state live under `registry/` and
  `knowledge/`.
- Completed work belongs in git history, release notes, and generated readiness
  docs, not in this roadmap.

## Non-Negotiables

- Rust-first core with a Tauri desktop shell for Windows, macOS, and Linux.
- Irodori-authored code and official templates are `MIT OR 0BSD` by default.
- Clean-room discipline is mandatory: proprietary, source-available, GPL/AGPL,
  and unclear-license material can inform behavior only where policy allows, and
  cannot be copied into the permissive core.
- Rust remains the source of truth for command and extension payloads; generated
  TypeScript keeps JSON boundaries in `camelCase` without hand duplication.
- The editor must be excellent offline: deterministic completion, serious Vim
  mode, remappable keybindings, keyboard-first navigation, and schema-aware
  inspection are core, not AI-dependent extras.
- AI features are optional, provider-based, redaction-conscious, and never
  required for the core editor experience.
- Database coverage must grow through shared source and adapter contracts rather
  than one-off UI forks: SQL, distributed SQL, document, key-value, graph,
  time-series, search, vector, warehouse, local embedded, and lakehouse sources
  all need room in the model.
- Large work must stay bounded and cancellable: streamed results, page caps,
  disk offload, cancellable jobs, logs, progress, resource limits, and headless
  access are part of the architecture.
- Extension development is first-class: documented manifests, typed APIs, local
  dev mode, capability-scoped permissions, integrity checks, and official
  templates.
- Bilingual ja/en localization, generated-binding checks, unit tests,
  ephemeral-database integration tests, and headless UI smoke tests are expected
  engineering practice.

## Reference Surface

Reference material is used for requirements and behavior study, not for copying
protected expression. The canonical policy is
<https://hjosugi.github.io/irodori-docs/clean-room.html>.

Primary product benchmarks:

- Lightweight daily SQL clients: TablePlus, Beekeeper Studio, DbGate, HeidiSQL,
  DB Browser for SQLite.
- Deep SQL IDEs and admin tools: DataGrip, DBeaver, DbVisualizer, pgAdmin,
  MySQL Workbench, Oracle SQL Developer, SSMS, VS Code MSSQL/SQLTools.
- Source-specific clients: MongoDB Compass, RedisInsight, Neo4j Browser,
  InfluxDB UI, ArangoDB Web UI, Couchbase UI, Kibana/OpenSearch workflows, and
  Grafana data-source exploration.
- Performance and desktop architecture references: RSQL behavior, DuckDB UI,
  WezTerm, Lapce, Helix, and Zed/GPUI architecture study under clean-room rules.
- Visual modeling and analytics references: drawDB behavior study, Apache
  Superset, DuckDB, Apache Iceberg, DataFusion/Arrow, Trino/Presto, and
  table-format/catalog ecosystems.

Detailed reference notes belong in `irodori-docs` reference pages.

## Architecture Direction

- This repository is the app: Tauri shell, React/TypeScript workbench, desktop
  Rust command layer, app-local adapters, generated snapshots, and app CI.
- Shared Rust foundations live in sibling repositories and are consumed by tag:
  `irodori-kit`, `irodori-sql`, `irodori-knowledge`, and `typeship`.
- Stable shared APIs can graduate to sibling crates; areas without stable
  release/test boundaries stay app-local until the split pays for itself.
- The workbench is compact and operational: object browser, editor, results,
  inspector, command palette, terminal/search/ERD, and extension surfaces are
  first-screen tools rather than marketing pages.
- CodeMirror 6 is the shipped editor path. Native/GPU rendering remains a
  measured performance track for hot text and grid surfaces.
- Generated data and bindings are updated from source data or generators, then
  checked in CI. Hand-editing generated snapshots is not acceptable.
- The extension path is native-capable and installable: marketplace catalog,
  manifest validation, archive integrity, permission flow, dynamic module
  loading, and fleet audits must stay aligned.

## Strategic Phases

### Foundation

Keep licensing, clean-room policy, repository boundaries, generated type
contracts, security posture, and contribution workflow explicit enough that new
contributors can work without guessing.

### Daily Workbench

Keep the core loop fast: connect, browse schema, write SQL, run/cancel, inspect
errors, view/edit safe result slices, export/import, restore sessions, and drive
the app from keyboard-heavy workflows.

### Power Editor And Workspace

Invest in remappable shortcuts, Vim depth, tab groups, splits, saved sessions,
connection-bound editors, query history, notes, Git-aware workflows, and
theme/layout persistence.

### Completion, Knowledge, And Optional AI

Make deterministic schema-aware completion and hover inspection strong first.
Use the local knowledge base to track official database behavior. Keep AI
generation/chat optional, cancellable, auditable, provider-neutral, and
read-only by default where agentic behavior is involved.

### Database And Source Coverage

Core SQL engines remain first-class. Additional families grow through adapter
contracts and installable extensions: graph, document, key-value, search,
time-series, vector, warehouse, local embedded, and lakehouse/table-format
sources. The generated support inventory is the source of truth for shipped
coverage.

### Network, Security, And Release Quality

Direct sockets, SSH, SOCKS/HTTP proxies, multi-hop chains, OS keychain storage,
privacy mode, audit logs, redaction, signing/notarization/update flows, CI
gates, and release verification must improve together.

### Advanced Workflows And Headless Access

Schema compare, migration preview, data compare, bulk edit, ERD/design flows,
result visualizers, headless local data API, jobs, extension publishing, and
team sync are layered on only after the local-first workbench remains fast and
safe.

## Execution Tracking

Do not add task checklists to this file. Open or update an issue instead.

Current implementation queues are in GitHub Issues, including:

- Security, release, CI, and runtime hardening.
- DX/onboarding and cross-repo release/development flow.
- Refactors, i18n, error UX, and AI privacy.
- Extension marketplace, fleet CI, metadata, ABI commonization, and re-audit.
- Theme, Git graph, installable connector, vector/lakehouse contracts, jobs, and
  rendering-performance tracks.

For coverage state, use:

- `registry/data-source-support-status.md`
- `registry/catalog/`
- `knowledge/engines.json`
- `tools/docs/*` and `tools/knowledge/*` generators

For public roadmap details, keep these docs aligned:

- <https://hjosugi.github.io/irodori-docs/feature-matrix.html>
- <https://hjosugi.github.io/irodori-docs/production-readiness.html>
- <https://hjosugi.github.io/irodori-docs/implementation-backlog.html>
- <https://hjosugi.github.io/irodori-docs/repository-boundaries.html>

## Research Watchlist

- SQL parsing, incremental structure, completion ranking, diagnostics, and
  query repair.
- Large-result streaming, pagination, packed IPC, page caches, and bounded
  memory behavior.
- GPU/native rendering paths for editor and result-grid hot surfaces.
- Database-specific UX for graph, time-series, document, KV, search, vector,
  warehouse, and lakehouse sources.
- Official database release notes and specs, continuously collected into the
  local knowledge base.
- Import/export interchange formats: CSV/TSV, SQL scripts, JSON/NDJSON, Avro,
  Parquet, Arrow, and dialect dump/restore.
- Local data API patterns, safe write guards, generated clients, and headless
  automation.
- Internationalization patterns for Rust/TypeScript desktop apps.
- Test automation across unit, generated bindings, ephemeral databases,
  extension manifests, browser smoke, and release packaging.
