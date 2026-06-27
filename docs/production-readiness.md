# Production Readiness

Last updated: 2026-06-26 JST.

This checklist is the release gate for turning Irodori Table from a working
prototype into a dependable database client. It intentionally separates
"supported and tested" from "recognized for future work"; UI surfaces should show
only the supported set.

## Release contract

- Supported engines in the connection UI: PostgreSQL, MySQL, SQLite, MariaDB,
  CockroachDB, TimescaleDB, SQL Server, DuckDB, MongoDB, Oracle, YugabyteDB,
  TiDB, Redshift.
- Experimental: H2 is routed through the PostgreSQL wire path for local
  compatibility testing, but it is not a first-class supported engine until it
  has dedicated verification and documented quirks.
- Recognized future adapters such as ClickHouse, graph, time-series, and vector
  databases must fail with an explicit "no production connector yet" error until
  their drivers, metadata, and tests exist.

## P0 Before A Daily Driver

- Connection profiles: OS keychain secret storage, typed profile schema version,
  import/export with secrets excluded, and backend validation kept in sync with
  UI validation.
- Query execution: cancellable running queries, per-connection query timeout,
  fetch-more pagination, and run-to-file export for result sets beyond the memory
  cap.
- Result grid: typed column metadata, copy modes, current-result export tests for
  CSV/TSV/JSON/JSONL/SQL/Excel-compatible HTML workbook/Markdown, native XLSX
  tracking, saved/server-side filters, and virtualized rendering for large pages.
- Object browser: lazy schema/table expansion, metadata cache with invalidation,
  row estimates, comments, routines/triggers/packages, and per-engine fallback
  behavior when catalogs differ.
- Security: redacted logs and errors, no plaintext secret persistence, TLS/cert
  settings for networked engines, and explicit trust/self-signed choices.
- QA: generated-binding drift check, backend unit tests, integration tests for
  each supported engine, and a headless UI smoke test for connect/run/export.

## Done In Current Slice

- H2 remains experimental through the PostgreSQL-wire path and needs dedicated
  verification before it is promoted to first-class support.
- Backend command boundary validates connection IDs, empty SQL, SQL text size,
  and result-window bounds.
- Connection errors redact URL passwords plus ADO `Password=` and `PWD=` values.
- Reconnecting an existing connection ID closes the previous handle.
- Query history, selected/current statement execution, current-result export
  formats (CSV/TSV/JSON/JSONL/SQL/Excel-compatible HTML workbook/Markdown),
  client-side quick/rule filters, and multi-column sort are wired in the desktop
  UI.
- Desktop schema-aware completion is wired from live metadata and covered by
  browser E2E for table and alias-column suggestions. Shared completion service
  coverage across local API/future hosts remains open.
- Desktop Query Magics have a deterministic baseline for describe/explain/ERD/
  export/parameter prompts, with parser tests and browser smoke. Command-palette
  parity, audit/history structure, and run-to-file magic remain open.
- Wide-column result virtualization is wired and browser-tested against a
  2,000-column synthetic result; the 1M-row lazy scroll benchmark is also wired
  and browser-tested.
- Schema ERD UI and SVG/PNG export helpers are wired, but visual/export smoke
  evidence and query-result graph views remain open.
- Vim mode is wired with Playwright smoke coverage for toggle, insert, and a
  normal-mode delete flow; deeper Vim parity remains open.
- Linux AppImage v0.2.23 has been released. Cross-platform installer/signing and
  update-channel decisions are still release-readiness work.
