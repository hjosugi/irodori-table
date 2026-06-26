# RSQL Reference Notes

Last reviewed: 2026-06-26 JST.

Source: <https://github.com/rust-dd/rsql>

## License Boundary

The public README currently links to `LICENSE`, but the `LICENSE` path returned
404 during review. Treat RSQL as a public README / behavior reference only until
compatible license terms are verified. Do not copy source code, UI wording,
assets, screenshots, or exact implementation from the repository.

Use this note to translate visible behavior and public performance claims into
Irodori-owned requirements, benchmarks, and tests.

## Useful Reference Points

- **Large-result rendering:** RSQL positions a canvas/WebGL grid as the primary
  reason it can keep DOM cost flat on very large result sets. This belongs in
  Irodori's `PERF-001` renderer spike as a benchmark lane against the current DOM
  virtual grid and possible WebGPU/canvas paths.
- **Server-side cursor pagination:** RSQL describes PostgreSQL cursors, fixed-size
  pages, a small frontend page cache, and LRU eviction. Irodori already has
  bounded row virtualization and disk offload; the useful next comparison is a
  PostgreSQL cursor-backed result window for uncapped interactive browsing.
- **Packed IPC:** RSQL avoids nested JSON for large result pages by packing rows
  into separator-delimited strings. Irodori should benchmark this idea against
  current typed JSON, Arrow IPC, and any future binary page format before changing
  the command boundary.
- **Dual query/metadata pools:** RSQL separates user query traffic from metadata
  traffic. Irodori should evaluate the same separation for engines where schema
  refresh, completion, and object-browser calls can currently compete with a long
  user query.
- **Rust-side result diffing:** Pinned result comparison is useful for repeated
  query workflows. Irodori can implement its own diff model over current result
  pages or persisted spill handles.
- **Record view for wide rows:** A form-style row drawer/modal is a strong fit for
  Irodori's wide-table UX and pairs with the existing history-detail drawer idea.
- **PostgreSQL-specific admin views:** `pg_stat_activity`, table/index stats,
  locks, bloat, extensions, roles, ENUMs, settings, RLS policy editing, and
  LISTEN/NOTIFY are good PostgreSQL plugin/admin targets, not core cross-engine
  UI primitives.
- **EXPLAIN JSON visualization:** Irodori already tracks explain entry points; the
  next useful bar is an interactive plan tree with cost, estimate-vs-actual, and
  timing emphasis.
- **PostGIS map view:** Geometry/geography detection plus a map renderer is a
  useful source-specific visualizer. Keep it behind result visualizer/plugin
  contracts so non-spatial engines do not inherit PostgreSQL-only assumptions.
- **Production guard:** Color-coded environments, read-only production mode, and
  explicit DML/DDL confirmation are worth bringing into Irodori's safety model.

## Not Directly Portable

- RSQL is PostgreSQL-first. Irodori must keep the adapter model broad enough for
  SQLite, MySQL/MariaDB, SQL Server, Oracle, warehouses, graph, document, KV, and
  time-series sources.
- RSQL's simple-query text path is attractive for speed but loses typed values at
  the boundary. Irodori should preserve exact typed decoding where editing,
  filtering, import/export, or dialect behavior requires it.
- A separator-delimited IPC format must handle escaping, nulls, binary data,
  column metadata, backpressure, cancellation, and versioning before adoption.
- Canvas/WebGL grid adoption must include accessibility, selection/copy/editing,
  IME behavior, high-DPI behavior, print/export parity, and software fallback.

## Candidate Backlog Follow-Ups

- `PERF-001`: add an RSQL-inspired canvas/WebGL grid lane and compare scroll
  latency, CPU, memory, selection cost, and copy/edit behavior against DOM
  virtualization.
- `EXEC-010/EXEC-008`: prototype PostgreSQL cursor-backed result windows and
  run-to-file export over a shared page contract.
- `TB/API`: benchmark typed JSON vs packed text vs Arrow IPC for large result
  pages before changing generated command payloads.
- `CMPL/BROWSE`: split metadata traffic away from user query traffic where a
  connector supports independent pools or workers.
- `ADV-004D`: implement query-result graph/map visualizers through the same
  extension/result visualizer contract, not one-off PostgreSQL UI branches.
- `EXEC-007`: add a record-view drawer for wide rows before expanding inline edit
  complexity.
