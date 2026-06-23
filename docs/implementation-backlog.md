# Implementation Backlog

Last updated: 2026-06-24 JST.

This is the ticket-level breakdown of `ROADMAP.md`. Each item is sized to be picked
up and finished on its own, one at a time, with a testable "Done when" line. Work
top to bottom within an epic unless a dependency says otherwise.

## How to use

- Pick the lowest-numbered `P0` ticket whose dependencies are all done.
- A ticket is done only when its **Done when** is true *and* it ships a test
  (unit, integration against an ephemeral DB, a generated-binding golden check, or
  a headless UI smoke test — whichever fits). See the `QA` epic.
- Keep this file in sync with `ROADMAP.md`. If a ticket changes scope, edit it here
  and reflect the theme change in the roadmap.

## Legend

- **Priority:** `P0` first usable product · `P1` daily-driver quality · `P2` advanced/polish · `Later` deferred.
- **Size:** `S` ≤1 day · `M` a few days · `L` a week+ / needs a spike first.
- **ID:** `EPIC-NNN`. IDs are stable; do not renumber. Add new work with the next free number.

## Epics

| Prefix | Epic | Roadmap home |
| --- | --- | --- |
| FND | Foundation, legal, scaffolding | Phase 0 |
| KNOW | Knowledge base + source automation | Phase 0/3 |
| TB | Type bridge integration (Irodori side) | Phase 0/1 |
| SHELL | App shell, packaging, i18n base | Phase 1 |
| CONN | Connections + datasources | Phase 1 |
| NET | Network transports + security | Phase 5 |
| EXEC | Query execution + result grid | Phase 1/1A |
| BROWSE | Object browser + hover | Phase 1/3 |
| EDIT | Editor engine, Vim, keybindings | Phase 2 |
| THEME | Theming + VS Code import | Phase 1/2 |
| WS | Workspace, tabs, panes, history | Phase 2 |
| CMPL | Completion + metadata intelligence | Phase 3 |
| EXT | Extension SDK | Phase 2A |
| SRC | Data source adapters | Phase 4 |
| IO | Export/import + dump/restore | Phase 4 |
| API | Local data API / headless | Phase 6A |
| AI | Optional AI / MCP | Phase 3 |
| ADV | Advanced workflows | Phase 6 |
| PERF | Performance / GPU | Architecture |
| QA | Test automation + CI | Architecture |

---

## FND — Foundation, Legal, Scaffolding

### FND-001 — Clean-room contribution rules enforced in PR template ✅
- **Goal:** Make `docs/clean-room.md` actionable at review time.
- **Done when:** a PR template includes the contribution checklist; CONTRIBUTING links the policy; a sample PR shows the checklist rendered.
- **Done:** `.github/pull_request_template.md` embeds the clean-room/licensing checklist, `CONTRIBUTING.md` links `docs/clean-room.md` and `docs/licensing.md`, and `docs/sample-pr.md` shows the checklist rendered in a filled sample.
- **Depends on:** —
- **Size:** S · **Priority:** P0

### FND-002 — Cargo/Tauri workspace scaffold ✅
- **Goal:** A buildable Rust workspace with the crate skeletons from the architecture section.
- **Done when:** `cargo build` succeeds with empty `irodori-core`, `irodori-data-sources`, `irodori-proxy`, `irodori-secure-store`, `irodori-sql`, `irodori-completion`, `irodori-io`, `irodori-server`, `irodori-i18n`, `irodori-knowledge` crates; CI builds on Linux/macOS/Windows.
- **Done:** root `Cargo.toml` defines the workspace, includes the existing Tauri crate plus the ten roadmap crates, and sets the empty crates as default members so root `cargo build` verifies the scaffold. `.github/workflows/ci.yml` runs the root scaffold build on Linux, macOS, and Windows.
- **Depends on:** —
- **Size:** M · **Priority:** P0

### FND-003 — License + SPDX headers wired ✅
- **Goal:** Lock `MIT OR 0BSD` across crates and templates.
- **Done when:** every crate `Cargo.toml` declares `license = "MIT OR 0BSD"`; `LICENSE` present; a CI check fails on a missing license field.
- **Done:** root workspace package metadata uses `MIT OR 0BSD`, each new crate inherits it through `license.workspace = true`, the existing desktop crate already declares the same license, and `scripts/check-licenses.sh` is run in CI.
- **Depends on:** FND-002
- **Size:** S · **Priority:** P0

### FND-004 — Supported-license policy for assets ✅
- **Goal:** Decide allowed licenses for themes, snippets, icons, grammars, drivers.
- **Done when:** `docs/licensing.md` lists allowed/blocked license classes per asset type; referenced from the PR checklist.
- **Done:** `docs/licensing.md` now lists compatibility classes and per-asset rules for dependencies, templates, themes, snippets, icons/images, fonts, grammars, drivers, and fixtures; the PR checklist references it.
- **Depends on:** FND-001
- **Size:** S · **Priority:** P0

### FND-005 — Driver strategy decision record (Oracle thin/thick, packaging)
- **Goal:** Record how native vs bridge drivers and platform packaging will work.
- **Done when:** an ADR captures the Oracle thin/thick plan and per-OS packaging approach; linked from the roadmap.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P1

### FND-006 — Error model + result envelope ✅
- **Goal:** One typed error/result shape across commands and adapters.
- **Done when:** `irodori-core` defines an error enum and a `Result` envelope; serde camelCase verified; surfaced through the type bridge.
- **Done:** `irodori-core` now defines `IrodoriErrorKind`, `IrodoriError`, `Result<T>`, and `CommandResult<T>`; serde tests verify camelCase error and success/failure envelope JSON; desktop Tauri command rejects now carry structured `IrodoriError` values while adapter strings are classified at the boundary; `generated/irodori-api.ts` exports `IrodoriErrorKind`, `IrodoriError`, and `CommandResult<T>` through typebridge; the UI reads structured errors via `errorMessage`.
- **Depends on:** FND-002, TB-001
- **Size:** M · **Priority:** P0

---

## KNOW — Knowledge Base + Source Automation

### KNOW-001 — Seed `knowledge/sources.json` ✅
- **Goal:** Track official DB/client/AI sources.
- **Done when:** sources.json holds DB docs, release notes, client docs, and AI/MCP references with stable IDs; schema documented in `docs/knowledge-base.md`.
- **Done:** `knowledge/sources.json` registers official database specs, release notes, DB-client docs, type/tooling references, and AI/MCP references with stable IDs; `docs/knowledge-base.md` documents the registry schema, allowed values, defaults, and source-operation rules. Verified with JSON validation and `node tools/knowledge/refresh.mjs --no-fetch`.
- **Depends on:** —
- **Size:** S · **Priority:** P0

### KNOW-002 — Local SQLite knowledge store + schema
- **Goal:** Persist snapshots and extracted facts locally.
- **Done when:** `irodori-knowledge` opens `knowledge/irodori-knowledge.sqlite` with the documented schema; round-trip insert/query test passes.
- **Depends on:** FND-002, KNOW-001
- **Size:** M · **Priority:** P0

### KNOW-003 — Refresh tool (`tools/knowledge/refresh.mjs`)
- **Goal:** Populate the store with and without network fetch.
- **Done when:** `node tools/knowledge/refresh.mjs --no-fetch` seeds from local data; `--fetch` updates snapshots; idempotent reruns verified.
- **Depends on:** KNOW-002
- **Size:** M · **Priority:** P1

### KNOW-004 — Per-dialect feature extraction
- **Goal:** Turn snapshots into queryable dialect facts for completion/compat.
- **Done when:** extraction writes normalized feature rows per dialect; a query returns features for one dialect; covered by a test.
- **Depends on:** KNOW-002
- **Size:** L · **Priority:** P1

### KNOW-005 — Scheduled refresh automation
- **Goal:** Keep specs current without manual runs.
- **Done when:** a scheduled job (CI cron or local task) runs refresh and reports diffs; failures are visible.
- **Depends on:** KNOW-003
- **Size:** M · **Priority:** P2

---

## TB — Type Bridge Integration (Irodori Side)

> The standalone `typebridge` generator is a separate project. These tickets cover
> only how Irodori *consumes* it; keep `docs/type-bridge-handoff.md` current.

### TB-001 — Generate TypeScript bindings for current commands ✅
- **Goal:** No hand-written duplicate TS types for command payloads.
- **Done when:** `workspace_snapshot` and its types are generated into `apps/desktop/src/generated/`; the desktop UI imports them; `snake_case` Rust ↔ `camelCase` JSON verified.
- **Done:** `apps/desktop/src/generated/irodori-api.ts` is generated by the desktop typegen test, includes `workspace_snapshot` plus database command payload/result types and wrappers, and is imported by the UI. Typegen now also surfaces the shared core error envelope from `irodori-core`.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P0

### TB-002 — `typegen` command + CI drift check
- **Goal:** Make stale bindings a CI failure.
- **Done when:** a friendly `typegen` command regenerates bindings; `typegen --check` fails CI on drift with a readable diff.
- **Depends on:** TB-001
- **Size:** M · **Priority:** P0

### TB-003 — Typed Tauri command wrappers
- **Goal:** Hide raw `invoke("...")` strings behind typed functions.
- **Done when:** every command has a generated wrapper returning a typed `Promise`; UI uses wrappers only; lint forbids raw `invoke`.
- **Depends on:** TB-001
- **Size:** M · **Priority:** P1

### TB-004 — Extension SDK types from the same source
- **Goal:** Extension authors never get stale hand-written types.
- **Done when:** extension API types are generated from the same schema; a sample extension compiles against them.
- **Depends on:** TB-002, EXT-002
- **Size:** M · **Priority:** P1

---

## SHELL — App Shell, Packaging, i18n Base

### SHELL-001 — Tauri app boots on all three OSes
- **Goal:** A window opens with the compact workbench layout, no landing-page feel.
- **Done when:** signed/unsigned dev builds launch on Windows, macOS, Linux; smoke test confirms the main window renders.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P0

### SHELL-002 — Command palette shell ✅ (first pass)
- **Goal:** A keyboard-first command palette present from day one.
- **Done when:** palette opens via shortcut, lists registered commands, runs a no-op command; commands come from a registry.
- **Done:** `src/keybindings.ts` holds the command catalog; the palette opens on `Mod+Shift+P` (VS Code's "Show All Commands"), filters the registry as you type, and runs the selected command (Enter = top match, Esc closes). Real commands are wired (run/cancel/focus editor/export/edit-mode/add-row/commit).
- **Depends on:** SHELL-001
- **Size:** M · **Priority:** P0

### SHELL-003 — i18n catalog scaffolding (ja/en)
- **Goal:** All user-facing strings localizable from the start.
- **Done when:** `irodori-i18n` exposes a message lookup; UI reads ja/en catalogs; a missing-key check runs in CI; language switch updates the UI.
- **Depends on:** SHELL-001
- **Size:** M · **Priority:** P1

### SHELL-004 — Settings store + schema
- **Goal:** Persisted, typed user settings.
- **Done when:** settings load/save to disk with a versioned schema and migration hook; invalid settings fall back safely; covered by a test.
- **Depends on:** SHELL-001, TB-001
- **Size:** M · **Priority:** P0

### SHELL-005 — Packaging + auto-update channel decision
- **Goal:** Shippable installers per OS.
- **Done when:** CI produces installers for each OS; an ADR records the update channel approach.
- **Depends on:** SHELL-001
- **Size:** L · **Priority:** P2

---

## CONN — Connections + Datasources

### CONN-001 — Connection profile model
- **Goal:** A typed, source-agnostic connection profile.
- **Done when:** profile schema covers engine, transport, auth, and options; serialized without secrets; validated on save.
- **Depends on:** FND-006
- **Size:** M · **Priority:** P0

### CONN-002 — SQLite + PostgreSQL connect/disconnect
- **Goal:** Establish and tear down real connections.
- **Done when:** connect/ping/disconnect work for SQLite and PostgreSQL; errors surface clearly; integration tests use an ephemeral Postgres and a temp SQLite file.
- **Depends on:** CONN-001
- **Size:** M · **Priority:** P0

### CONN-003 — Secret storage via OS keychain
- **Goal:** Never persist plaintext credentials.
- **Done when:** `irodori-secure-store` reads/writes secrets through the OS keychain with an encrypted fallback; profiles reference secrets by handle; test covers store/fetch/delete.
- **Depends on:** CONN-001
- **Size:** M · **Priority:** P0

### CONN-004 — Connection manager UI
- **Goal:** Create, edit, test, and open connections.
- **Done when:** UI lists connections, tests a connection, opens an editor bound to it; validation errors shown inline.
- **Depends on:** CONN-002, CONN-003
- **Size:** M · **Priority:** P0

### CONN-005 — Datasource folders/groups
- **Goal:** Organize datasources like files.
- **Done when:** connections can be grouped into nestable folders; drag/keyboard move works; layout persists.
- **Depends on:** CONN-004
- **Size:** M · **Priority:** P1

### CONN-006 — Easy inline edit + duplicate
- **Goal:** Fast, intuitive datasource editing.
- **Done when:** rename/duplicate/quick-edit work without a modal wall; changes validate live; undo for accidental edits.
- **Depends on:** CONN-004
- **Size:** S · **Priority:** P1

### CONN-007 — Import/export connection definitions (secrets excluded)
- **Goal:** Move connection sets between machines safely.
- **Done when:** export writes a portable file with no secrets; import re-links secrets via the keychain prompt; round-trip test passes.
- **Depends on:** CONN-005
- **Size:** M · **Priority:** P2

---

## NET — Network Transports + Security

### NET-001 — Transport abstraction
- **Goal:** One trait composing direct/SSH/proxy transports.
- **Done when:** `irodori-proxy` defines a transport trait; direct TCP/TLS implemented; adapters dial through it.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P1

### NET-002 — SSH tunnel (key/password/agent)
- **Goal:** Connect through an SSH tunnel.
- **Done when:** tunnel established before DB connect for key/password/agent auth; failures are clear; integration test against a local sshd.
- **Depends on:** NET-001
- **Size:** L · **Priority:** P1

### NET-003 — SOCKS5 + HTTP CONNECT proxy
- **Goal:** Route connections through SOCKS5/HTTP proxies.
- **Done when:** both proxy types work end to end; auth supported; tested against a local proxy.
- **Depends on:** NET-001
- **Size:** M · **Priority:** P1

### NET-004 — Multi-hop proxy chains with named hops
- **Goal:** Compose ordered, reusable hops.
- **Done when:** a chain of ≥2 hops connects; hops are named and reusable across connections; chain validated before dial; tested with two stacked proxies.
- **Depends on:** NET-002, NET-003
- **Size:** L · **Priority:** P1

### NET-005 — Connection diagnostics
- **Goal:** Explain why a connection failed.
- **Done when:** a diagnostics view reports each transport stage (resolve, proxy, tunnel, TLS, auth) with timings and the first failing stage.
- **Depends on:** NET-004
- **Size:** M · **Priority:** P2

### NET-006 — Audit log + privacy/redaction mode
- **Goal:** Safe screenshots/log export.
- **Done when:** an audit log records connection and query events; privacy mode redacts values in logs and screenshots; redaction verified by a test.
- **Depends on:** CONN-002
- **Size:** M · **Priority:** P1

---

## EXEC — Query Execution + Result Grid

### EXEC-001 — Execute statement / selection / file
- **Goal:** Run SQL three ways.
- **Done when:** current statement, selection, and whole file execute against SQLite/PostgreSQL; statement boundaries detected; errors mapped to positions.
- **Depends on:** CONN-002
- **Size:** M · **Priority:** P0

### EXEC-002 — Streaming results + cancellation ✅ (core done)
- **Goal:** Large results stream and stop on demand.
- **Done when:** rows stream into the grid incrementally; cancel stops server-side work where supported; cancel mid-stream leaves the UI consistent.
- **Done (verified by unit tests + tsc):**
  - **Per-query timeout** — `db_run_query`/`db_run_query_stream` accept an optional `timeoutMs`, bounded by `tokio::time::timeout` → clean `query timed out after Nms`.
  - **Explicit cancel** — an optional `queryId` registers a `tokio_util` `CancellationToken` in `DbState`; `db_cancel(queryId)` signals it, a `tokio::select!` resolves the run to `query cancelled`, and the desktop Cancel button calls `dbCancel` with the in-flight id.
  - **Incremental streaming** — `db_run_query_stream` streams `columns → batched rows → done|error` over a Tauri `Channel` (`STREAM_BATCH_ROWS`-sized batches). `stream.rs` grew a `StreamCtx`/`stream_capped` twin of `collect_capped`; the sqlx trio and SQL Server override `Connection::stream_query` for true row-by-row delivery, and the fetch loop checks the cancel token each row — so cancel stops the fetch promptly (cooperative server-side cancel even for the non-pooled tiberius). The desktop grid fills as batches arrive (`runQueryStream` + the hand-written `db-stream.ts` channel wrapper). Engines whose driver materializes rows before our loop (Oracle/Mongo) and DuckDB use the default `stream_query` (buffer → one batch) and rely on the timeout/cancel-drop.
  - Unit-tested with in-memory SQLite (`stream_delivers_header_then_rows`, `stream_caps_rows_and_flags_truncation`, `stream_query_stops_on_a_cancelled_token`) plus `with_timeout`/`cancel_query_impl`.
- **Note on Oracle/Mongo cancel:** these use the default `stream_query` and are already stopped server-side by the cancel/timeout *drop*, not just a flag — dropping the Mongo future kills the server cursor mid-`try_next`, and Oracle's fetch is a single `query().await` that aborts on drop (its row loop is in-memory, so an in-loop token check would not help). The grid-side smoothness is handled by EXEC-004 (row virtualization, done).
- **Remaining:** incremental column evolution for document stores (Mongo currently buffers to compute the column union before projecting).
- **Depends on:** EXEC-001
- **Size:** L · **Priority:** P0

### EXEC-003 — Multiple result sets
- **Goal:** Show all result sets from one run.
- **Done when:** multi-statement runs surface each result set in its own tab/section; counts and timings shown.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P0

### EXEC-004 — Virtualized result grid 🚧 (row virtualization done)
- **Goal:** Smooth scrolling over huge results.
- **Done when:** the grid renders only visible rows/cols; 1M-row synthetic result scrolls without jank in a benchmark.
- **Done:** **row virtualization** — the desktop result grid renders only the rows in (and `GRID_OVERSCAN` around) the viewport, with top/bottom `.grid-pad` spacers preserving the scrollbar (fixed `GRID_ROW_HEIGHT` = 27px, viewport tracked via `ResizeObserver`, scroll coalesced through `requestAnimationFrame`). A capped 10k-row page is ~30 DOM rows instead of 10k, so the streamed result stays smooth; scroll resets to the top on each new run. `.result-grid` moved from a CSS `grid-auto-rows` layout to a flex column so spacers size freely.
- **Remaining:** column virtualization for very wide results, and a 1M-row synthetic scroll benchmark (the cap is 10k today; only run-to-file/disk-offload exceeds it).
- **Depends on:** EXEC-002
- **Size:** L · **Priority:** P0

### EXEC-005 — Copy + client-side sort/filter (current page)
- **Goal:** Basic in-grid data handling.
- **Done when:** copy cell/row/selection works; client-side sort and filter apply to the current page; safe read-only defaults.
- **Depends on:** EXEC-004
- **Size:** M · **Priority:** P0

### EXEC-006 — Query parameters
- **Goal:** Parameterized execution.
- **Done when:** named/positional params are detected, prompted, bound safely, and remembered per query.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P1

### EXEC-007 — Editable result rows with safe transaction flow 🚧 (backend done)
- **Goal:** Edit data with an explicit commit path.
- **Done when:** edits stage as a reviewable change set, generate parameterized DML, and commit/rollback in a transaction; primary-key-less tables are handled safely.
- **Done (backend, staged/non-immediate model):** `db/edit.rs` turns a `TableEdits` batch (updates/inserts/deletes, each a `CellValue` set keyed by the row's key columns) into parameterized statements with **per-dialect identifier quoting** (`"x"` / `` `x` `` / `[x]`) and placeholder style (`$n` for pg, `?` otherwise); a `NULL` key becomes `IS NULL`; empty-table / keyless-update / keyless-delete are rejected (no accidental full-table writes). `db_apply_edits` commits the batch in one transaction per the `Connection::apply_edits` trait method (sqlx engines override; others refuse). Verified by `edit.rs` generation unit tests **and an end-to-end in-memory SQLite test** (`apply_edits_commits_update_insert_delete`). Types + command flow through typebridge (`TableEdits`/`AppliedEdits`/`dbApplyEdits`, drift-check green).
- **Done (desktop editable grid, staged model):** an "Edit Data" mode adds a staged change set on top of the result grid — double-click a cell to edit (changed cells/rows highlighted), "+ Row" to stage inserts, **column-header click to sort** (asc/desc/none, client-side), and **paste** TSV/CSV from the clipboard into cells (spilling across columns and into new rows). "Commit (N)" infers the target table from the last query's `from <table>` and key columns from the table's unique index (else all result columns), builds a `TableEdits` batch, and calls `dbApplyEdits`; "Discard" drops the staged changes. Edits reset on each new run; the change set survives sorting (display rows key back to their origin). Sorting/editing compose with row virtualization. Frontend type-checks and the production bundle builds.
- **Done (PK detection):** metadata now carries the real primary key (`DbObjectMetadata.primary_key`) — SQLite via `pragma table_xinfo.pk`, Postgres/MySQL via `pg_constraint`/`information_schema`; the editable grid keys updates/deletes on the PK (then a unique index, then all columns). Verified by a SQLite metadata unit test.
- **Done (row delete):** Edit Data mode shows a per-row delete gutter; deleting an original row stages a `RowDelete` (keyed on the PK), deleting a staged new row drops it. Deletes count toward the pending total and commit in the same transaction.
- **Remaining:** precise value binding for pg/mysql precision-typed columns / typed `NULL` (needs column-type metadata threaded through).
- **Depends on:** EXEC-005
- **Size:** L · **Priority:** P1

### EXEC-008 — Run-to-file for huge results
- **Goal:** Stream very large results straight to disk.
- **Done when:** a run can target a file (CSV/TSV/JSONL) without buffering the whole result in memory; cancel is clean.
- **Depends on:** EXEC-002, IO-001
- **Size:** M · **Priority:** P1

### EXEC-009 — Native per-engine pools + full type decoding  ✅ core done
- **Goal:** Replace sqlx's `Any` driver (int/bigint/text only) with native `PgPool`/`MySqlPool`/`SqlitePool` and decode every column by type — the Beekeeper-informed move. Exact numerics/temporals become strings to avoid precision/timezone loss; binary as hex; json preserved.
- **Done (verified against real PG/MySQL):** `db.rs` now uses native pools with `pg_cell_to_json`/`my_cell_to_json`/`sqlite_cell_to_json`; integration tests confirm decimal→string, timestamp→string/RFC3339, jsonb→object. Streaming with a 10k default cap + `truncated` flag (EXEC-002) retained.
- **Remaining:** preserve NUMERIC display scale (BigDecimal drops trailing zeros), decode arrays/ranges/enums richly, and front the engines with a `DatabaseClient` trait + feature-negation registry.
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P0

### EXEC-009b — SQL Server (tiberius) and DuckDB drivers
- **Goal:** Add the major engines sqlx does not cover.
- **SQL Server: ✅ done (verified).** Connects via the pure-Rust `tiberius` (TDS) driver — no SQL Server client — behind `EnginePool::SqlServer`; an integration test runs against a real SQL Server 2022 container (connect + version + typed `select`). Precision-safe decoding is now done too: cells decode off the raw `ColumnData`, so `DECIMAL/NUMERIC/MONEY` keep full precision + display scale as strings, datetime/date/time/datetimeoffset go through chrono (ISO 8601 / RFC3339), binary is `\x` hex, and UUID/XML are strings (no more lossy `f64`/`null`). Covered by a `numeric_to_string` unit test.
- **DuckDB: ✅ done (verified).** Embedded DuckDB behind `--features duckdb` (off by default) in `db/duck.rs`; an in-memory integration test (create/insert/select on int/varchar/double/null) passes against bundled libduckdb v1.5.4. Statements are classified (DDL/DML → `execute`, queries → `query`), and column metadata is read after execution. Note: the `bundled` libduckdb C++ build is heavy (needs adequate RAM/swap); linking a system/prebuilt libduckdb skips the compile.
- **Depends on:** EXEC-009
- **Size:** L · **Priority:** P1

### EXEC-010 — Bounded memory with optional disk offload (anti-TablePlus)
- **Goal:** Browse results far larger than RAM without exhausting memory the way TablePlus does.
- **Done when:** result windows beyond a configurable in-memory budget spill to an on-disk backing store (temp SQLite/Arrow), the grid pages from disk, and a setting controls the threshold and on/off; memory stays flat while scrolling a 10M-row result.
- **Depends on:** EXEC-009, EXEC-004
- **Size:** L · **Priority:** P1

### EXEC-011 — Automatic parallelism for large workloads
- **Goal:** Use parallelism so big operations stay fast.
- **Done when:** parallel keyset-chunked fetch for large reads (bounded worker pool), parallel introspection across many tables/connections, and parallel export run concurrently with backpressure; each is opt-in/auto with a concurrency cap and is benchmarked on the 10M-row, 100-table seed.
- **Depends on:** EXEC-009
- **Size:** L · **Priority:** P2

---

## BROWSE — Object Browser + Hover

### BROWSE-001 — Schema/table/column tree
- **Goal:** Navigate database structure.
- **Done when:** the browser lists schemas, tables, columns, indexes, and views for SQLite/PostgreSQL with lazy loading; refresh works.
- **Depends on:** CONN-002
- **Size:** M · **Priority:** P0

### BROWSE-002 — Routines, triggers, packages
- **Goal:** Show procedural objects.
- **Done when:** functions, procedures, triggers, and (where present) packages appear with signatures; Oracle packages handled in SRC.
- **Depends on:** BROWSE-001
- **Size:** M · **Priority:** P1

### BROWSE-003 — Hover inspection cards
- **Goal:** See content without leaving the editor.
- **Done when:** hovering an object/column shows type, nullability, keys, indexes, DDL, comment, row-count estimate, and a quick sample, sourced from the metadata cache.
- **Depends on:** BROWSE-001, CMPL-001
- **Size:** M · **Priority:** P1

### BROWSE-004 — Generate DDL / quick actions
- **Goal:** Common object actions from the browser.
- **Done when:** copy DDL, generate `SELECT`, and open-data actions work from the tree and the hover card.
- **Depends on:** BROWSE-001
- **Size:** S · **Priority:** P1

---

## EDIT — Editor Engine, Vim, Keybindings

### EDIT-001 — Editor engine spike + decision  ✅ decided + prototyped (perf numbers pending)
- **Goal:** Choose Monaco vs CodeMirror 6 vs native/Tree-sitter.
- **Decision (ADR 0001):** CodeMirror 6 host; CM6 Lezer paint + `web-tree-sitter` semantic layer; `sql-formatter` v15. Rationale + reference-project evidence (Beekeeper/Outerbase = CM6) in `docs/adr/0001-editor-stack.md`.
- **Done when:** ~~a spike compares Vim quality, completion architecture, and large-file performance;~~ ✅ an ADR records the choice. Remaining: CM6 prototype with large-file perf numbers recorded in the ADR.
- **Depends on:** SHELL-001
- **Size:** L · **Priority:** P0

### EDIT-002 — SQL syntax highlighting (Tree-sitter where strong)  🟡 paint layer prototyped
- **Goal:** Editor-grade SQL structure.
- **Approach (ADR 0001):** paint via CM6 Lezer `@codemirror/lang-sql` (dialect bound to `DbEngine`) now; add `web-tree-sitter` captures as a fallback/upgrade only where a dialect grammar is solid. Map highlight tags into the THEME-001 model (not TextMate-only scopes).
- **Prototyped:** CM6 Lezer highlighting live in `SqlEditor.tsx` with the default highlight style. Remaining: THEME-001 token mapping; tree-sitter semantic captures.
- **Done when:** highlighting uses Tree-sitter queries where the grammar is solid, with a dialect fallback; tokens map to the internal theme model.
- **Depends on:** EDIT-001, THEME-001
- **Size:** M · **Priority:** P0

### EDIT-003 — Keybinding resolver + scopes 🚧 (resolver + remap done)
- **Goal:** Fully remappable shortcuts.
- **Done when:** bindings resolve per context scope, detect conflicts, and are editable; a default map ships; changes persist.
- **Done:** `src/keybindings.ts` ships a VS Code-flavored default keymap (`Mod` = Cmd on macOS / Ctrl elsewhere), a chord parser/matcher (platform-aware), conflict detection, and localStorage-persisted per-command overrides merged over the defaults. A global `keydown` resolver runs the matched command (and won't hijack plain typing in a field). The sidebar lists every command with its shortcut; click the chord to **rebind** (records the next keystroke), conflicts are flagged, and `↺` resets to default.
- **Remaining:** per-context scopes (editor vs grid vs global), multi-key chord sequences, and the preset maps (EDIT-004).
- **Depends on:** SHELL-002
- **Size:** L · **Priority:** P0

### EDIT-004 — Keymap presets
- **Goal:** Familiar defaults for newcomers.
- **Done when:** TablePlus-like, VS Code-like, JetBrains-like, and Vim-heavy presets load and are switchable.
- **Depends on:** EDIT-003
- **Size:** M · **Priority:** P1

### EDIT-005 — Vim mode: core
- **Goal:** Daily-driver modal editing.
- **Done when:** normal/insert/visual modes, counts, operators, motions, and basic registers work; covered by a behavior test suite.
- **Landed:** `@replit/codemirror-vim` is wired into the CM6 editor behind a persisted header toggle; Playwright smoke confirms the mode can be enabled/disabled and CM renders the Vim mode panel. Remaining: focused behavior tests for motions/operators/registers and any app-specific keybinding conflicts.
- **Depends on:** EDIT-001, EDIT-003
- **Size:** L · **Priority:** P1

### EDIT-006 — Vim mode: advanced
- **Goal:** Power-user Vim parity.
- **Done when:** macros, marks, text objects, search, command-line mode, and custom mappings work and persist.
- **Depends on:** EDIT-005
- **Size:** L · **Priority:** P1

### EDIT-007 — Multiple cursors + SQL-aware selection
- **Goal:** Fast multi-edit.
- **Done when:** multi-cursor edits and SQL-aware selection expansion (token → expression → clause → statement) work.
- **Depends on:** EDIT-002
- **Size:** M · **Priority:** P1

### EDIT-008 — Format + comment toggles + bracket matching  🟡 formatter + bracket matching prototyped
- **Goal:** Editor ergonomics.
- **Approach (ADR 0001):** default formatter = `sql-formatter` v15 (MIT), `DbEngine`→language mapped, behind a pluggable format hook; comment-toggle + bracket-matching via CM6 built-ins. v2: CST/tree-sitter formatter for dialect-perfect output.
- **Prototyped:** "Format SQL" toolbar action (dialect-mapped) + CM6 bracket matching live. Remaining: make formatter choice configurable (pluggable hook); comment-toggle keybinding surfaced in UI.
- **Done when:** a format hook (pluggable formatter), comment toggle, and bracket matching work; formatter choice is configurable.
- **Depends on:** EDIT-002
- **Size:** M · **Priority:** P1

---

## THEME — Theming + VS Code Import

### THEME-001 — Internal normalized theme model  🟡 model + editor light/dark done
- **Goal:** One theme model for workbench + syntax + semantic tokens.
- **Done when:** the model covers UI colors and token colors; a default light/dark theme renders; documented.
- **Landed:** `src/theme.ts` is the single source — `IrodoriTheme { ui, syntax }` with `lightTheme`/`darkTheme`. The editor is fully themed in both modes via `editorThemeExtensions` (CM chrome + Lezer-tag `HighlightStyle`); shell colors are driven by `cssVariables(theme)` on `.app-shell`; titlebar toggle + persistence. `tsc` + `vite build` green.
- **Follow-up (THEME-001b):** full workbench dark-mode — ~30 hardcoded panel colors in `App.css` (inspector, result grid, connection forms, chips) still need converting to vars so deep panels flip too. Editor + top chrome already theme.
- **Depends on:** SHELL-001
- **Size:** M · **Priority:** P0

### THEME-002 — VS Code theme import
- **Goal:** Reuse VS Code color themes where license permits.
- **Done when:** a VS Code theme JSON imports into the internal model (workbench + TextMate + semantic colors), with a license note on import; unsupported keys degrade gracefully.
- **Depends on:** THEME-001
- **Size:** M · **Priority:** P1

---

## WS — Workspace, Tabs, Panes, History

### WS-001 — Query tabs + scratch buffers
- **Goal:** Multiple editors at once.
- **Done when:** open/close/reorder tabs, scratch buffers, and dirty-state tracking work.
- **Depends on:** EDIT-001
- **Size:** M · **Priority:** P0

### WS-002 — Tab folders/groups + named sessions
- **Goal:** Organize editor tabs.
- **Done when:** tabs group into folders; named sessions save/restore the open set; layout persists across restarts.
- **Depends on:** WS-001
- **Size:** M · **Priority:** P1

### WS-003 — Arbitrary split panes + persisted layout
- **Goal:** Free pane arrangement.
- **Done when:** editor/result/browser panes split arbitrarily, resize, and persist; focus navigation is keyboard-driven.
- **Depends on:** WS-001
- **Size:** L · **Priority:** P1

### WS-004 — Per-tab connection binding
- **Goal:** Each editor knows its connection.
- **Done when:** a tab binds to a connection, shows it, and can rebind; runs target the bound connection.
- **Depends on:** WS-001, CONN-004
- **Size:** S · **Priority:** P1

### WS-005 — Query history + saved queries
- **Goal:** Recall and reuse queries.
- **Done when:** history records runs with timing/connection; saved queries persist and reopen; search across both works.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P0

---

## CMPL — Completion + Metadata Intelligence

### CMPL-001 — Metadata cache with invalidation
- **Goal:** Fast, permissions-aware introspection.
- **Done when:** schema/object metadata caches with background refresh and invalidation; respects permissions; shared by completion and hover.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P0

### CMPL-002 — Baseline completion (tables, columns, schemas, keywords)
- **Goal:** Deterministic offline completion.
- **Done when:** completion suggests tables, columns, schemas, and keywords with no AI; ranking is sensible; works offline.
- **Depends on:** CMPL-001, EDIT-002
- **Size:** L · **Priority:** P0

### CMPL-003 — Context-aware completion (aliases, CTEs, subqueries)
- **Goal:** Understand query structure.
- **Done when:** completion resolves table aliases, CTE columns, and subquery columns from the parsed statement; covered by parser tests.
- **Depends on:** CMPL-002
- **Size:** L · **Priority:** P1

### CMPL-004 — Functions, procedures, signatures, overloads
- **Goal:** Routine-aware help.
- **Done when:** function/procedure completion includes signatures, overload selection, and parameter hints per dialect.
- **Depends on:** CMPL-003, KNOW-004
- **Size:** M · **Priority:** P1

### CMPL-005 — Join suggestions + generated column lists
- **Goal:** High-leverage SQL authoring help.
- **Done when:** completion proposes join conditions from keys and expands `*` to a generated column list.
- **Depends on:** CMPL-003
- **Size:** M · **Priority:** P1

### CMPL-006 — Dialect-aware ranking, insert behavior, keyword casing
- **Goal:** Daily-driver polish.
- **Done when:** ranking and insert text adapt per dialect; optional keyword casing applies; settings control behavior.
- **Depends on:** CMPL-002, KNOW-004
- **Size:** M · **Priority:** P1

### CMPL-007 — Explain/analyze entry points + plan view
- **Goal:** Plan-aware help.
- **Done when:** explain/analyze commands run and render a readable plan; plan-based hints surface where available.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P1

---

## EXT — Extension SDK

### EXT-001 — Stabilize `irodori.extension.json`
- **Goal:** A documented extension manifest.
- **Done when:** the manifest schema is finalized and validated; `extension.schema.json` matches; a sample manifest validates.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P1

### EXT-002 — TypeScript extension SDK surface
- **Goal:** Typed command/keybinding/result-grid/theme/dialect APIs.
- **Done when:** the SDK exposes typed APIs (generated where possible); a hello-world extension compiles and loads.
- **Depends on:** EXT-001, TB-004
- **Size:** L · **Priority:** P1

### EXT-003 — Local dev mode (watch reload, logs, fixtures, permission inspector)
- **Goal:** Easy extension development.
- **Done when:** a dev mode hot-reloads an extension, streams logs, provides fake DB fixtures, and shows requested permission scopes.
- **Depends on:** EXT-002
- **Size:** L · **Priority:** P1

### EXT-004 — Capability-scoped permissions
- **Goal:** Extensions get least privilege.
- **Done when:** manifest permission scopes gate API access at runtime; denied calls fail safely and are logged.
- **Depends on:** EXT-002
- **Size:** M · **Priority:** P1

### EXT-005 — `MIT OR 0BSD` templates + examples
- **Goal:** Fast start for authors.
- **Done when:** at least two templates and one non-trivial example ship under `MIT OR 0BSD` and build in CI.
- **Depends on:** EXT-002
- **Size:** M · **Priority:** P2

### EXT-006 — Rust/Wasm extension path
- **Goal:** High-performance add-ons.
- **Done when:** a Wasm extension can provide a driver/renderer/parser hook; a sample runs.
- **Depends on:** EXT-004
- **Size:** L · **Priority:** P2

---

## SRC — Data Source Adapters

### SRC-001 — Data source adapter trait
- **Goal:** One contract for every source family.
- **Done when:** the trait declares connection schema, transport needs, query/parse, introspection, result shapes, editable ops, completion, explain, and import/export hooks; SQLite/PostgreSQL implement it.
- **Depends on:** CONN-001, EXEC-001
- **Size:** L · **Priority:** P0

### SRC-001a — DatabaseClient trait + registry; split wire from dialect/metamodel
- **Goal:** Reach DBeaver-scale extensibility — adding an engine means implementing a trait, not editing a `match` arm. (DBeaver study, Apache-2.0, `ref/dbeaver-ce`.)
- **✅ Core done (verified):** the `EnginePool` enum is replaced by a `Connection` trait (`version`/`run_query`/`close`) implemented per engine, stored as `Arc<dyn Connection>`; `connect_engine` is the single connector/registry mapping wire → concrete client. `run_query`/`disconnect` no longer match on the engine. Engines are modeled as `wire protocol`, so a wire-compatible engine (Cockroach/Yugabyte/Redshift/Timescale on Postgres; MariaDB/TiDB on MySQL) is just a `DbEngine` variant. Verified: default suite green; SQLite and DuckDB round trips pass through the trait.
- **Remaining:** a per-engine `SqlDialect` (identifier quoting/keywords); a generic `information_schema` metamodel base that engines override only where they differ; a two-tier lazy metadata cache loaded on navigator expand; a cancellation token threaded into fetch loops; and an extension-provided (Wasm) driver registry.
- **Depends on:** SRC-001, EXEC-009
- **Size:** L · **Priority:** P1

### SRC-002 — MySQL/MariaDB adapter
- **Done when:** connect, introspect, execute, stream, and export reach parity with the SQLite/PostgreSQL baseline; integration test against an ephemeral MySQL.
- **Depends on:** SRC-001
- **Size:** M · **Priority:** P1

### SRC-003 — SQL Server adapter
- **Done when:** baseline parity reached; auth modes covered; integration test against SQL Server.
- **Depends on:** SRC-001
- **Size:** M · **Priority:** P1

### SRC-004a — Spike: pure-Rust thin Oracle driver (no Instant Client)
- **Goal:** Validate a client-free Oracle path, the way A5:SQL Mk-2's direct mode works.
- **Done when:** `oracle-rs` (MIT/Apache, pure-Rust TNS) is evaluated against real Oracle 19c and 23ai — connect, introspect, run a query, and document gaps (PL/SQL, packages, wallets, types); a decision records inherit-and-harden vs build-our-own vs thick fallback. A5/UniDAC code is never used (A5 is closed source).
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P1

### SRC-004 — Oracle adapter (first-class, thin-first)
- **Goal:** Oracle as a first-class citizen with no Instant Client required by default.
- **Done when:** connect via the thin TNS driver (host/port/service descriptor, no client), introspect, run queries, browse packages/procedures, execute PL/SQL, and view explain plans; thick ODPI-C stays an optional `oracle-thick` feature; service/SID profiles and wallet/TLS supported.
- **Depends on:** SRC-004a, CONN-003
- **Size:** L · **Priority:** P1

### SRC-005 — YugabyteDB via YSQL + distributed affordances
- **Done when:** connects through PostgreSQL-compatible YSQL; adds region/tablet/follower-read/topology metadata where APIs allow.
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P2

### SRC-006 — DuckDB adapter (embedded analytics)
- **Done when:** in-process DuckDB connects, queries, and reads Parquet/Iceberg; used as a lakehouse execution option in SRC-010.
- **Depends on:** SRC-001
- **Size:** M · **Priority:** P1

### SRC-007 — Distributed/warehouse SQL batch
- **Goal:** CockroachDB, ClickHouse, BigQuery, Redshift, Trino/Presto, TiDB, Databricks/Spark SQL.
- **Done when:** each connects and reaches baseline parity behind the adapter trait; tracked individually but share the SQL pipeline.
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P2

### SRC-008 — Time-series source (InfluxDB 3 first)
- **Done when:** SQL/native query, time-range binding, frame model, downsampling preview, and retention/bucket browser work for InfluxDB 3.
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P2

### SRC-009 — Graph source (Neo4j first)
- **Done when:** Cypher editing, label/relationship/property introspection, tabular + query-result graph rendering, and graph-aware completion work.
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P2

### SRC-010 — Lakehouse: Apache Iceberg (priority)
- **Goal:** Read/query Iceberg across catalogs.
- **Done when:** Iceberg tables are reachable via Hive Metastore, AWS Glue, REST, and JDBC catalogs and via AWS S3 Tables; object stores (S3/GCS/Azure) are first-class; execution via DuckDB/DataFusion or Trino; introspection + query verified against a test catalog.
- **Depends on:** SRC-001, SRC-006
- **Size:** L · **Priority:** P2

### SRC-011 — Snowflake adapter with full auth coverage
- **Goal:** Every common Snowflake auth path.
- **Done when:** password, key-pair (JWT), OAuth, external-browser/SSO, MFA/passcode, and programmatic access tokens connect; warehouse/role/database context switching works; auth matrix covered by tests where possible.
- **Depends on:** SRC-001, CONN-003
- **Size:** L · **Priority:** P2

### SRC-012 — Document/KV/search sources
- **Goal:** MongoDB, Redis, Elasticsearch/OpenSearch, plus Cassandra/Couchbase/DynamoDB/Arango/Memgraph by maturity.
- **Done when:** native query surface, collection/keyspace/index browser, document viewer/editor with patch preview, and field/operator/stage completion work for the first targets (MongoDB, Redis, Elasticsearch).
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P2

### SRC-013 — Delta Lake / Apache Hudi (after Iceberg)
- **Done when:** read access to Delta and Hudi tables works through the lakehouse path; introspection verified.
- **Depends on:** SRC-010
- **Size:** L · **Priority:** Later

---

## IO — Export/Import + Dump/Restore

### IO-001 — Export encoder layer
- **Goal:** Shared, streaming encoders in `irodori-io`.
- **Done when:** a streaming encoder interface exists; CSV/TSV implemented with header on/off and delimiter/quote control; used by the grid and run-to-file.
- **Depends on:** EXEC-002
- **Size:** M · **Priority:** P0

### IO-002 — SQL INSERT/UPSERT script export
- **Done when:** results export as INSERT/UPSERT scripts, with or without schema/DDL, dialect-correct quoting, and batch sizing.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P1

### IO-003 — JSON / NDJSON export+import
- **Done when:** results export to JSON and NDJSON; import maps NDJSON/JSON into a target table with type mapping and a preview.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P2

### IO-004 — Avro export+import
- **Done when:** Avro export writes a schema + records; Avro import infers/maps schema to a target table; round-trip test passes.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P2

### IO-005 — Parquet export+import
- **Done when:** Parquet export/import works (via Arrow), with type mapping and a preview; large files stream.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P2

### IO-006 — CSV/TSV import with mapping + preview
- **Done when:** delimited import maps columns, infers types, previews, and loads with error reporting and a dry-run.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P1

### IO-007 — Dialect-aware dump/restore
- **Goal:** Easy, intuitive dump/restore.
- **Done when:** schema and/or data dump and restore work per dialect where permitted, with progress, cancellation, and a clear summary.
- **Depends on:** IO-002
- **Size:** L · **Priority:** P2

---

## API — Local Data API / Headless

### API-001 — Headless runtime
- **Goal:** Run Irodori without UI.
- **Done when:** a headless entry point loads connections and runs queries via the same adapters; no window required; smoke-tested in CI.
- **Depends on:** SRC-001
- **Size:** M · **Priority:** P2

### API-002 — Local HTTP read API
- **Goal:** Read tables/queries over HTTP.
- **Done when:** `irodori-server` serves list-sources, run-query (parameterized), and read-table (pagination/filter/sort) endpoints; read-only by default; integration test hits each endpoint.
- **Depends on:** API-001
- **Size:** L · **Priority:** P2

### API-003 — Tokened, scoped, audited access
- **Goal:** Safe exposure.
- **Done when:** access requires a token; per-source scopes apply; all requests hit the audit log; denied requests fail closed.
- **Depends on:** API-002, NET-006
- **Size:** M · **Priority:** P2

### API-004 — Safe write endpoints (opt-in)
- **Goal:** Controlled writes.
- **Done when:** write endpoints exist behind explicit opt-in and write scopes, use parameterized DML and transactions, and are off by default.
- **Depends on:** API-003, EXEC-007
- **Size:** L · **Priority:** P2

### API-005 — Generated API client types
- **Goal:** Typed external access.
- **Done when:** client types for the API are generated through the type bridge and published with an example consumer.
- **Depends on:** API-002, TB-002
- **Size:** M · **Priority:** P2

---

## AI — Optional AI / MCP (off by default)

### AI-001 — Provider abstraction (opt-in)
- **Goal:** Pluggable, optional AI.
- **Done when:** `irodori-ai` defines a provider trait; local model and OpenAI-compatible providers stub in; AI is off by default and never required by the editor.
- **Depends on:** CMPL-002
- **Size:** M · **Priority:** P2

### AI-002 — Audit log + redaction for AI payloads
- **Goal:** Privacy-safe AI.
- **Done when:** query text, schema, and result samples are separately permissioned; every AI call is audited; redaction applies before send; verified by a test.
- **Depends on:** AI-001, NET-006
- **Size:** M · **Priority:** P2

### AI-003 — MCP bridge (Copilot-compatible)
- **Goal:** Expose safe tools instead of embedding Copilot.
- **Done when:** an MCP server exposes read-only schema/search/explain/query tools with scopes; a Copilot-compatible client can call them.
- **Depends on:** AI-002
- **Size:** L · **Priority:** P2

---

## ADV — Advanced Workflows

### ADV-001 — Schema compare + migration preview
- **Done when:** two schemas diff into a readable change set and a migration script preview; safe-apply path documented.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P2

### ADV-002 — Data compare + safe bulk edit
- **Done when:** row-level data compare produces a reviewable diff and a transactional bulk-edit plan.
- **Depends on:** EXEC-007
- **Size:** L · **Priority:** P2

### ADV-003 — Table designer + indexes/constraints UI
- **Done when:** create/alter tables, indexes, and constraints through a UI that emits reviewable DDL.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P2

### ADV-004 — ERD + graph views 🚧 (schema ERD done)
- **Done when:** ERD renders from schema and query-result graph views render; explicitly after core editor/query/browser are excellent.
- **Done (schema ERD via Mermaid):** the object browser's diagram button (or `Mod+Shift+D` / "Show ER diagram" in the palette) renders an `erDiagram` from the active connection's metadata — base tables with their columns, `PK`/`FK` markers, and many-to-one FK edges. `src/erd.ts` is the pure metadata→Mermaid generator (sanitized identifiers, only edges whose target table is present, so the graph stays clean); the modal can copy the Mermaid source. Mermaid is dynamically imported so it stays out of the main bundle (~240 kB) in its own ~610 kB chunk loaded on first open. Needs the new FK/PK metadata (below).
- **Remaining:** reduce edge/box overlap further (evaluate the Mermaid ELK layout), query-result graph views, and FK metadata for SQL Server/Oracle (SQLite/Postgres/MySQL done).
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** Later

### ADV-005 — Plugin API for drivers/themes/formatters/visualizers + registry
- **Done when:** third-party drivers, themes, formatters, and result visualizers load via a stable plugin API; a registry path exists after the local SDK is solid.
- **Depends on:** EXT-004
- **Size:** L · **Priority:** Later

---

## PERF — Performance / GPU

### PERF-001 — Renderer spike: WebView vs canvas/WebGPU vs native GPU
- **Goal:** Avoid a slow-UI corner before the grid/editor harden.
- **Done when:** a benchmark compares Tauri WebView, in-WebView canvas/WebGPU, and a native Rust GPU path on large text/grid workloads; an ADR records the direction.
- **Depends on:** EXEC-004
- **Size:** L · **Priority:** P0

### PERF-002 — GPU-aware hot paths with software fallback
- **Goal:** Fast where it matters, safe everywhere.
- **Done when:** editor text, result-grid scroll, and selection painting use a GPU path when available and fall back to software on old GPUs/remote desktops; a runtime flag forces software mode.
- **Depends on:** PERF-001
- **Size:** L · **Priority:** P1

### PERF-003 — Startup time + idle memory budget
- **Goal:** Beat Electron-era clients on cold start and idle footprint.
- **Done when:** startup and idle-memory budgets are defined and checked by a benchmark in CI; regressions fail the check.
- **Depends on:** SHELL-001
- **Size:** M · **Priority:** P1

---

## QA — Test Automation + CI

### QA-001 — Test harness + CI matrix  🟡 frontend runner landed
- **Goal:** One command to test; CI across OSes.
- **Done when:** `cargo test` and the frontend test runner pass locally and in CI on Linux/macOS/Windows; coverage of core crates reported.
- **Landed:** frontend `vitest` runner (`npm test`, 21 tests over `src/sql/statements.ts`, `src/sql/dialect.ts`, `theme.ts`). `cargo test` already exists backend-side. Remaining: CI matrix wiring (GH Actions) + coverage report.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P0

### QA-002 — Ephemeral-database integration harness
- **Goal:** Real DBs in tests, disposably.
- **Done when:** integration tests spin up ephemeral SQLite/PostgreSQL (and later MySQL/SQL Server) via containers or embedded servers and tear them down cleanly.
- **Depends on:** QA-001, CONN-002
- **Size:** M · **Priority:** P0

### QA-003 — Generated-binding golden check
- **Goal:** Catch type-bridge drift.
- **Done when:** CI fails if generated TypeScript bindings differ from committed output, with a readable diff.
- **Depends on:** TB-002
- **Size:** S · **Priority:** P0

### QA-004 — Headless UI smoke tests  🟡 browser smoke landed
- **Goal:** Confidence the app actually runs.
- **Done when:** a headless driver launches the Tauri shell, connects to SQLite, runs a query, and asserts result rows; runs in CI.
- **Landed (browser portion):** Playwright smoke (`e2e/smoke.spec.ts`, `npm run test:e2e`) drives the real web frontend headless — shell renders, CodeMirror mounts with highlighting, theme toggles, Format SQL reflows. Tauri `invoke` is absent in a plain browser (app falls back to mock snapshot), so connect/query is **not** covered here. Remaining: full Tauri+SQLite smoke via a Tauri runner (e.g. tauri-driver/WebDriver) for the connect→query→assert-rows path. Note: sandbox uses `PW_CHROME_PATH` to reuse a local Chromium (cdn.playwright.dev is egress-blocked).
- **Depends on:** SHELL-001, EXEC-001
- **Size:** L · **Priority:** P1

### QA-005 — Performance regression benchmarks in CI
- **Goal:** Keep "fast" measurable.
- **Done when:** grid-scroll, startup, and idle-memory benchmarks run in CI and flag regressions past a threshold.
- **Depends on:** PERF-003, EXEC-004
- **Size:** M · **Priority:** P1
