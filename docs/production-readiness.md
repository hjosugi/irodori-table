# Production Readiness

Last updated: 2026-06-22 JST.

This checklist is the release gate for turning Irodori Table from a working
prototype into a dependable database client. It intentionally separates
"supported and tested" from "recognized for future work"; UI surfaces should show
only the supported set.

## Release contract

- Supported engines in the connection UI: PostgreSQL, MySQL, SQLite, MariaDB,
  CockroachDB, TimescaleDB, SQL Server, DuckDB, MongoDB, Oracle, YugabyteDB,
  TiDB, Redshift.
- Deferred: H2. Do not expose it in UI or generated product docs until it has a
  verified connector path and integration test.
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
- Result grid: typed column metadata, copy/export modes, CSV/TSV/JSON export tests,
  and virtualized rendering for large pages.
- Object browser: lazy schema/table expansion, metadata cache with invalidation,
  row estimates, comments, routines/triggers/packages, and per-engine fallback
  behavior when catalogs differ.
- Security: redacted logs and errors, no plaintext secret persistence, TLS/cert
  settings for networked engines, and explicit trust/self-signed choices.
- QA: generated-binding drift check, backend unit tests, integration tests for
  each supported engine, and a headless UI smoke test for connect/run/export.

## Done In Current Slice

- H2 remains deferred and is not exposed in the connection UI.
- Backend command boundary validates connection IDs, empty SQL, SQL text size,
  and result-window bounds.
- Connection errors redact URL passwords plus ADO `Password=` and `PWD=` values.
- Reconnecting an existing connection ID closes the previous handle.
- Query history, selected/current statement execution, and CSV export are wired in
  the desktop UI.

