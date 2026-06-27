# Implementation Backlog

Last updated: 2026-06-27 JST.

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

## GitHub Issues

Git-tracked docs are the source of truth for product planning:

- `ROADMAP.md` owns phase-level direction and the current immediate-next list.
- `docs/implementation-backlog.md` owns stable ticket IDs, dependencies, and done
  criteria.
- `docs/implementation-progress.md` owns the built-and-verified snapshot.

GitHub Issues are optional coordination mirrors, not the canonical backlog. Use
an issue when a ticket needs discussion, screenshots/logs, outside reporting, or a
lightweight public task handle. Every mirrored issue should include the backlog
ticket ID (for example `CMPL-007`) and link back to this file. Closing a GitHub
Issue does not close the ticket until this file has its status updated and the
verification is recorded.

New bugs can start as GitHub Issues. If a bug turns into planned product work,
convert it into a stable backlog ticket before implementation so task IDs remain
available in commits, docs, and release notes.

## Legend

- **Priority:** `P0` first usable product / release blocker · `P1` daily-driver parity and competitive gaps that block daily-driver quality · `P2` broader adapter coverage, non-blocking competitive gaps, advanced workflows, and polish that can follow daily-driver parity · `Later` deferred.
- **Size:** `S` ≤1 day · `M` a few days · `L` a week+ / needs a spike first.
- **ID:** `EPIC-NNN`. IDs are stable; do not renumber. Add new work with the next free number.
- **Priority rule:** `P0`/`P1` tickets should not depend on `P2` implementation tickets. If a parity feature must be reusable by later surfaces, define the shared contract in the `P0`/`P1` ticket and let the `P2` surface consume it later.

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

## Parity Guardrails

These are explicit competitive gaps, not closed by nearby core-library work alone.

- **Snowsight:** desktop schema/table/column autocomplete is wired and smoke-tested from live metadata (`CMPL-002A`), but the shared completion service/API contract remains open; Copilot-style inline autocomplete is open (`AI-004`); charts/dashboards/worksheet visualization are open (`ADV-004E`); explain/query profile is open (`CMPL-007`); inline editing is a partial desktop skeleton (`EXEC-007`); desktop result exploration now has client-side quick filtering, multi-rule predicate filters, and multi-column sort, but saved filters plus server-side/filter-plan SQL remain open (`EXEC-005A`). Each needs a shared contract for desktop now and local API/future hosts later.
- **Beekeeper:** no-code schema editor is partially wired as a reviewable DDL designer (`ADV-003`), but direct apply/alter coverage and DB-specific DDL safety remain open; current-result export now covers CSV, TSV, JSON, JSONL, SQL INSERT text, an Excel-compatible HTML workbook, and Markdown, but full import/export parity remains open/partial by format (`IO`) with native XLSX, streaming run-to-file, Avro/Parquet, and dump/restore still open; deterministic Query Magics have a desktop baseline while command-palette/result-to-file parity remains open (`AI-005`), and AI Shell is open (`AI-006`); ERD SVG/image/multi-schema/layout work is implemented but still has QA hardening while query-result graph views remain open (`ADV-004` series); wide-column and 1M-row virtualization are app-wired and browser-tested (`EXEC-004B`).

---

## FND — Foundation, Legal, Scaffolding

### FND-001 — Clean-room contribution rules enforced in PR template ✅
- **Goal:** Make `docs/clean-room.md` actionable at review time.
- **Done when:** a PR template includes the contribution checklist; CONTRIBUTING links the policy; a sample PR shows the checklist rendered.
- **Done:** `.github/pull_request_template.md` embeds the clean-room/licensing checklist, and `CONTRIBUTING.md` links `docs/clean-room.md` and `docs/licensing.md` with a compact filled PR-body example.
- **Depends on:** —
- **Size:** S · **Priority:** P0

### FND-002 — Cargo/Tauri workspace scaffold ✅
- **Goal:** A buildable Rust workspace with the crate skeletons from the architecture section.
- **Done when:** `cargo build` succeeds for the desktop crate and real shared crates; CI builds on Linux/macOS/Windows.
- **Done:** root `Cargo.toml` defines the workspace and keeps only implemented shared crates as default members. Empty future placeholders were removed so crate boundaries stay earned by code. `.github/workflows/ci.yml` runs the root scaffold build on Linux, macOS, and Windows.
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
- **Done:** `irodori-core` now defines `IrodoriErrorKind`, `IrodoriError`, `Result<T>`, and `CommandResult<T>`; serde tests verify camelCase error and success/failure envelope JSON; desktop Tauri command rejects now carry structured `IrodoriError` values while adapter strings are classified at the boundary; `generated/irodori-api.ts` exports `IrodoriErrorKind`, `IrodoriError`, and `CommandResult<T>` through typeship; the UI reads structured errors via `errorMessage`.
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

### KNOW-002 — Local SQLite knowledge store + schema ✅
- **Goal:** Persist snapshots and extracted facts locally.
- **Done when:** `irodori-knowledge` opens `knowledge/irodori-knowledge.sqlite` with the documented schema; round-trip insert/query test passes.
- **Done:** `irodori-knowledge::KnowledgeStore` opens a SQLite database (WAL, foreign keys), applies the tracked `knowledge/schema.sql` (shared with `tools/knowledge/refresh.mjs`), and exposes source/snapshot/fact persistence + search. Covered by `sqlite_store_round_trips_sources_snapshots_and_search`.
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

## JOB — Batch Jobs, Huge Indexes, And ML Pipelines

These are product foundations, not later polish. Irodori must support huge local
index construction, ML/evaluation workloads, knowledge refreshes, imports/exports,
bulk edits, and source scans without blocking the interactive desktop.

### JOB-001 — Long-running job runtime
- **Goal:** One cancellable runtime for all large local/background work.
- **Done when:** jobs have stable IDs, status, progress, cancellation, structured logs, artifacts, errors, retry policy, concurrency limits, CPU/memory/disk budgets, and checkpoint/resume hooks; the desktop can show active/history jobs and the same model is usable by the local API.
- **Done:** `irodori-core::jobs` now provides the shared job model and in-memory
  runtime: stable job IDs, queued/running/cancelling/succeeded/failed/cancelled
  states, progress with percent, cancellation requests, structured log entries,
  artifacts, error capture, retry policy with backoff, global and per-group
  concurrency limits, CPU/memory/disk budget fields, and resumable checkpoints.
  The desktop Tauri boundary exposes `jobs_list`, `jobs_get`, and `jobs_cancel`
  with generated TypeScript types, and Settings has a Jobs tab showing active and
  historical jobs with cancel actions. `irodori-server::model` re-exports the
  same core job DTOs so the local API uses the same shape when endpoints land.
  Unit coverage exercises lifecycle, progress, logs, artifacts, checkpoints,
  cancellation, retry, concurrency, and server JSON shape.
- **Remaining follow-up:** migrate real workflows one by one (`JOB-004`) so
  knowledge refresh/import/export/index/ML work reports into the runtime.
- **Depends on:** FND-006, SHELL-001
- **Size:** L · **Priority:** P1

### JOB-002 — Huge local index builder ✅ (core done)
- **Goal:** Build and refresh large search/metadata indexes without freezing the app.
- **Done when:** knowledge snapshots, source registries, schema metadata, query history, and implementation notes can be indexed incrementally with chunked ingest, disk-backed state, backpressure, progress, cancellation, and checkpointed resume; a synthetic large-corpus benchmark records throughput and peak memory.
- **Done:** `irodori-knowledge::index` adds a disk-backed inverted-index builder driven through the JOB-001 `JobRuntime`. `build_index(runtime, job_id, store, corpus, config)` pulls documents lazily from any iterator, tokenizes them, and accumulates a bounded in-memory postings buffer that flushes to a SQLite `IndexStore` (`index_docs` + `index_postings`, `INSERT OR IGNORE` so rebuilds/incremental runs are idempotent) once it crosses `flush_postings` — so **peak RAM is flat regardless of corpus size**. The build reports progress, honors `should_cancel` cooperatively, and (for resumable jobs) writes a `JobCheckpoint` cursor every `checkpoint_every_docs`, so an interrupted build resumes from the last durable document instead of restarting; on completion it records a throughput figure and an index artifact. `IndexStore::search` returns frequency-ranked postings. Verified by unit tests (small-corpus correctness + ranking, idempotent rebuild, **resume-after-cancel** rebuilding the exact remaining suffix) and a **50,000-document synthetic benchmark** asserting `peak_buffer_postings` stays within the flush budget while the full index stays queryable.
- **Remaining:** wire schema/query-history/knowledge-snapshot corpora as concrete `Document` sources and surface index builds in the desktop jobs dashboard; record a throughput/peak-memory number in CI as a perf gate; optional segment-merge/compaction for very large indexes.
- **Depends on:** JOB-001, KNOW-002, CMPL-001
- **Size:** L · **Priority:** P1

### JOB-003 — ML dataset, evaluation, and ranking pipeline
- **Goal:** Make ML useful for completion/ranking/AI quality while keeping runtime AI optional.
- **Done when:** permitted local artifacts can produce versioned train/eval datasets; local or provider-backed evaluation runs through the job runtime; reports include quality, latency, cost, privacy inputs used, and reproducible artifact hashes; no query text, schema, result sample, or history leaves the machine unless workspace policy explicitly allows that class of data.
- **Depends on:** JOB-001, AI-001, AI-002, KNOW-004
- **Size:** L · **Priority:** P1

### JOB-004 — Batch operation contracts ✅ (core done)
- **Goal:** Stop treating imports, exports, refreshes, index builds, ML runs, and bulk edits as unrelated one-off flows.
- **Done when:** import/export, knowledge refresh, huge index builds, ML/eval runs, and safe bulk edits expose the same job envelope for progress, cancellation, logs, artifact paths, resumability, and headless/API execution; at least two existing workflows are migrated to prove the contract.
- **Done:** `irodori-core::batch` defines the shared envelope: a `JobContext` (progress, `should_cancel`, resume-cursor, `save_checkpoint`, log, artifact) plus `run_job(runtime, job_id, op)` that owns the lifecycle — start (idempotent for resume), then map the operation's `BatchResult`/`BatchOutcome` to one terminal transition (`Completed` records artifacts + `succeed`; `Cancelled` → `mark_cancelled`; `Err` → `fail`) and return the job record + the operation's domain value. Operations are plain async fns that never touch the state machine, so progress/cancel/log/artifact/resume/headless are uniform across all of them. **Two existing workflows are migrated onto it to prove the contract:** the huge index builder (`irodori-knowledge::index::build_index` now runs through `run_job`/`build_index_with(ctx, …)`) and tabular export (`irodori-io::export::run_export` streams any `TabularEncoder` through the same envelope with per-row progress, cooperative cancel, and an output artifact). Verified by `irodori-core::batch` tests (complete-with-artifacts, cancel, fail, resume-cursor + checkpoint guard), the index-build suite (now contract-driven, incl. resume-after-cancel + 50k flat-memory benchmark), and `irodori-io::export` tests (full CSV export + cancel-flushes-partial).
- **Done (desktop dashboard wiring):** a real workflow runs through the contract on the desktop end-to-end — `db_index_schema(connection_id)` (in `apps/desktop/src-tauri/src/indexing.rs`) submits a resumable `IndexBuild` job and runs `build_index` in a background `tokio::spawn` against the shared `JobRuntime` (`JobState` now holds it behind an `Arc`), so the existing jobs dashboard shows live progress, cancellation, and the output artifact; the resulting index is retained per connection and queried by `db_search_schema`. A command-palette command **“Build schema search index”** triggers it and opens the Jobs panel. Verified by desktop `indexing` tests (schema indexed as a job → `Succeeded` + artifact, then searchable; missing-index error) and the generated `dbIndexSchema`/`dbSearchSchema`/`SchemaSearchHit` bindings (drift-check green).
- **Remaining:** migrate the remaining flows (knowledge refresh, import, ML/eval, safe bulk edit) onto the envelope; expose batch ops through the headless/local API surface (`API-001/002`).
- **Depends on:** JOB-001, IO-001
- **Size:** L · **Priority:** P1

---

## TB — Type Bridge Integration (Irodori Side)

> The standalone `typeship` generator is a separate project. These tickets cover
> only how Irodori *consumes* it; keep `docs/type-bridge-handoff.md` current.

### TB-001 — Generate TypeScript bindings for current commands ✅
- **Goal:** No hand-written duplicate TS types for command payloads.
- **Done when:** `workspace_snapshot` and its types are generated into `apps/desktop/src/generated/`; the desktop UI imports them; `snake_case` Rust ↔ `camelCase` JSON verified.
- **Done:** `apps/desktop/src/generated/irodori-api.ts` is generated by the desktop typegen test, includes `workspace_snapshot` plus database command payload/result types and wrappers, and is imported by the UI. Typegen now also surfaces the shared core error envelope from `irodori-core`.
- **Depends on:** FND-002
- **Size:** M · **Priority:** P0

### TB-002 — `typegen` command + CI drift check ✅
- **Goal:** Make stale bindings a CI failure.
- **Done when:** a friendly `typegen` command regenerates bindings; `typegen --check` fails CI on drift with a readable diff.
- **Done:** `apps/desktop/tools/typegen.mjs` regenerates both desktop Tauri and extension SDK bindings through the existing Rust typeship tests. `npm run typegen:check` reruns generation and fails with a scoped `git diff HEAD -- apps/desktop/src/generated/irodori-api.ts packages/extension-sdk/src/generated/irodori-extension-api.ts`; CI and `npm run build:verified` run that check using the published `typeship` crates, while everyday `npm run build` stays frontend-only so Vite builds do not pay the Rust typegen cost.
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
- **Done when:** the UI reads ja/en catalogs through a small message lookup; a missing-key check runs in CI; language switch updates the UI. Keep this app-local until a real shared Rust API is needed.
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
- **Status:** Partial. Linux AppImage v0.2.23 has been released (`v0.2.23` tag; desktop/Tauri package version `0.2.23`; Linux/AppImage release scripts present). Cross-OS installer coverage, signing/notarization policy, and the update-channel ADR remain open.
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

### EXEC-003 — Multiple result sets ✅ (desktop UI + SQLite core done)
- **Goal:** Show all result sets from one run.
- **Done when:** multi-statement runs surface each result set in its own tab/section; counts and timings shown.
- **Done:** `QueryResult`/stream events carry result-set indexes and summaries; SQLite multi-statement runs return/stream tagged result sets; the desktop UI renders multiple streamed result sets as `Result N` tabs, shows the active set's row count/timing, switches grids between sets, and resets grid scroll/selection on tab switch. Browser E2E coverage in `apps/desktop/e2e/multi-results.spec.ts` mocks a streamed multi-statement run and verifies tabs, summaries, switching, scroll reset, and selection reset.
- **Remaining:** driver-specific multi-result-set behavior beyond SQLite/default single-set streams can be expanded per adapter as needed.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P0

### EXEC-004 — Virtualized result grid ✅
- **Goal:** Smooth scrolling over huge results.
- **Done when:** the grid renders only visible rows/cols; 1M-row synthetic result scrolls without jank in a benchmark.
- **Done:** **row virtualization** — the desktop result grid renders only the rows in (and `GRID_OVERSCAN` around) the viewport, with top/bottom `.grid-pad` spacers preserving the scrollbar (fixed `GRID_ROW_HEIGHT` = 27px, viewport tracked via `ResizeObserver`, scroll coalesced through `requestAnimationFrame`). A capped 10k-row page is ~30 DOM rows instead of 10k, so the streamed result stays smooth; scroll resets to the top on each new run. `.result-grid` moved from a CSS `grid-auto-rows` layout to a flex column so spacers size freely. **Column virtualization** is wired with fixed column width, horizontal overscan, left/right spacer columns, and browser E2E coverage for a 1,000-row x 2,000-column fixture proving bounded DOM cells during horizontal scroll. **1M-row benchmark** coverage now injects a lazy 1,000,000-row x 128-column fixture, scrolls top/middle/bottom/rapid positions, and asserts bounded rendered rows/cells plus no blank frames.
- **Remaining:** very-large full-scrollbar scaling above browser pixel limits can be revisited with a virtual scroll-range mapper if a future 10M-row UI benchmark requires direct pixel scrolling.
- **Depends on:** EXEC-002
- **Size:** L · **Priority:** P0

### EXEC-004A — Wide-column virtualization hardening ✅
- **Goal:** Keep the grid smooth when a result has hundreds or thousands of columns.
- **Done when:** a synthetic `1,000 rows x 2,000 columns` result renders only the visible column window plus overscan; DOM cell count stays bounded by viewport rows * viewport columns; horizontal scroll, sort, selected row, staged edit cells, paste, and edit-mode gutter keep correct column indexes; sticky headers and left/right spacer widths remain stable at desktop and narrow widths.
- **Done:** `App.tsx` computes a horizontal column window with `GRID_COLUMN_WIDTH`, `GRID_COLUMN_OVERSCAN`, and spacer columns, so the app no longer renders every column for wide results. `result-grid.test.ts` covers the pure window math, and `apps/desktop/e2e/virtualization.spec.ts` injects a 1,000-row x 2,000-column streamed fixture with DOM-node budget assertions after horizontal scroll.
- **Remaining:** edit-mode/paste edge cases can keep hardening under `EXEC-007`; the standalone wide-column rendering blocker is closed.
- **Depends on:** EXEC-004
- **Size:** M · **Priority:** P0

### EXEC-004B — 1M-row synthetic scroll benchmark ✅
- **Goal:** Turn "smooth huge result scrolling" into a release gate instead of a subjective check.
- **Done when:** a benchmark can inject a synthetic 1,000,000-row result without loading 1M DOM rows; scripted top/middle/bottom/rapid scroll completes within the budget; rendered row count stays near viewport + overscan; no blank grid frames are captured.
- **Benchmark budget:** desktop Playwright run records scroll duration, max DOM rows/cells, and dropped-frame proxy metrics; failure threshold is documented and stable enough for CI or nightly perf runs.
- **Done:** `apps/desktop/e2e/virtualization.spec.ts` has a lazy logical 1M-row fixture that avoids materializing row arrays, asserts row/column/cell DOM budgets at top/middle/bottom and horizontal offsets, checks rapid scroll max-frame/elapsed thresholds, and verifies the logical fixture stayed lazy. The bottom jump intentionally uses a beyond-end scroll value and lets Chromium clamp to the real bottom.
- **Depends on:** EXEC-004A
- **Size:** M · **Priority:** P0

### EXEC-005 — Copy + client-side sort/filter basics (current page)
- **Goal:** Basic in-grid data handling.
- **Done when:** copy cell/row/selection works; single-column client-side sort applies to the current page; safe read-only defaults.
- **Status:** Partial. Column-header sort is wired for current-page rows, including shift-click additive multi-column sort. Desktop also has quick filtering and a rule panel over displayed cells. Grid copy cell/row/selection remains open unless a dedicated copy path lands.
- **Depends on:** EXEC-004
- **Size:** M · **Priority:** P0

### EXEC-005A — Advanced result filters 🚧 (client-side filters landed; saved/server-side open)
- **Goal:** Snowsight-style result exploration without forcing users to rewrite SQL for every slice.
- **Done when:** users can build multi-column filters with typed predicates, ranges, value lists, null/empty checks, search, and saved filter state; generated server-side/filter-plan SQL is previewable where it incurs database work; the filter expression model is serializable so desktop can use it now and the local API/future hosts can reuse it when those surfaces land.
- **Status:** Partial. The desktop grid has a quick filter plus client-side rules for any/specific columns, AND/OR joins, text predicates, comparisons, null/empty checks, and regex over displayed cell values; `result-grid` / `result-view-model` tests cover the model. Remaining: saved filters, a typed/serializable shared filter expression model, server-side/filter-plan SQL preview for database work, and reuse through the local API/future hosts.
- **Depends on:** EXEC-005
- **Size:** M · **Priority:** P1

### EXEC-006 — Query parameters
- **Goal:** Parameterized execution.
- **Done when:** named/positional params are detected, prompted, bound safely, and remembered per query.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P1

### EXEC-007 — Editable result rows with safe transaction flow 🚧 (partial desktop skeleton)
- **Goal:** Edit data with an explicit commit path.
- **Done when:** edits stage as a reviewable change set, generate parameterized DML, and commit/rollback in a transaction; primary-key-less tables are handled safely.
- **Done (backend, staged/non-immediate model):** `db/edit.rs` turns a `TableEdits` batch (updates/inserts/deletes, each a `CellValue` set keyed by the row's key columns) into parameterized statements with **per-dialect identifier quoting** (`"x"` / `` `x` `` / `[x]`) and placeholder style (`$n` for pg, `?` otherwise); a `NULL` key becomes `IS NULL`; empty-table / keyless-update / keyless-delete are rejected (no accidental full-table writes). `db_apply_edits` commits the batch in one transaction per the `Connection::apply_edits` trait method (sqlx engines override; others refuse). Verified by `edit.rs` generation unit tests **and an end-to-end in-memory SQLite test** (`apply_edits_commits_update_insert_delete`). Types + command flow through typeship (`TableEdits`/`AppliedEdits`/`dbApplyEdits`, drift-check green).
- **Done (desktop editable grid, staged model):** an "Edit Data" mode adds a staged change set on top of the result grid — double-click a cell to edit (changed cells/rows highlighted), "+ Row" to stage inserts, **column-header click to sort** (asc/desc/none, client-side), and **paste** TSV/CSV from the clipboard into cells (spilling across columns and into new rows). "Commit (N)" infers the target table from the last query's `from <table>` and key columns from the table's unique index (else all result columns), builds a `TableEdits` batch, and calls `dbApplyEdits`; "Discard" drops the staged changes. Edits reset on each new run; the change set survives sorting (display rows key back to their origin). Sorting/editing compose with row virtualization. Frontend type-checks and the production bundle builds.
- **Done (PK detection):** metadata now carries the real primary key (`DbObjectMetadata.primary_key`) — SQLite via `pragma table_xinfo.pk`, Postgres/MySQL via `pg_constraint`/`information_schema`; the editable grid keys updates/deletes on the PK (then a unique index, then all columns). Verified by a SQLite metadata unit test.
- **Done (row delete):** Edit Data mode shows a per-row delete gutter; deleting an original row stages a `RowDelete` (keyed on the PK), deleting a staged new row drops it. Deletes count toward the pending total and commit in the same transaction.
- **Parity status:** Partial/skeleton. The desktop flow proves the staged-edit shape, but it is not yet a complete cross-platform inline editing feature.
- **Remaining:** precise value binding for pg/mysql precision-typed columns / typed `NULL` (needs column-type metadata threaded through); shared edit capability/permission contracts for desktop, local API, and future hosts; conflict detection/refresh handling; richer validation and preview before commit.
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

### EXEC-010 — Bounded memory with optional disk offload (anti-TablePlus) ✅
- **Goal:** Browse results far larger than RAM without exhausting memory the way TablePlus does.
- **Done when:** result windows beyond a configurable in-memory budget spill to an on-disk backing store (temp SQLite/Arrow), the grid pages from disk, and a setting controls the threshold and on/off; memory stays flat while scrolling a 10M-row result.
- **Done:** `db/spill.rs` adds a `ResultStore` that keeps the first `memory_budget` rows resident in RAM and spills the rest to a throwaway temp **SQLite** file keyed on `idx INTEGER PRIMARY KEY` (journal/sync off; flushed in batches), so resident RAM is bounded by the budget regardless of total size; `window(offset, limit)` reads resident rows from RAM and spilled rows from disk transparently, and the file is removed on `close`/drop. The streaming `db_run_query_spill` command forwards only the resident first page to the UI (immediate paint) while retaining the full result behind a handle in a bounded (`MAX_RETAINED_RESULTS`) `DbState` registry; `db_result_window` pages rows, `db_release_result` frees a store, and disconnect releases a connection's stores. A `SpillConfig` (budget + on/off, clamped, hard `MAX_SPILL_ROWS` ceiling) honors the UI setting. Frontend: `result-window.ts` is an LRU-bounded windowed row source (`maxResidentPages * pageSize` flat-memory ceiling) behind an array-like `Proxy` the result-grid view model indexes by absolute row — resident rows return real cells, off-screen rows a cheap placeholder; the grid fetches missing pages for the visible range via `dbResultWindow` and repaints as they arrive. A **Result offload** on/off toggle + **Resident rows** budget input live in the settings dialog, persisted in the preferences store. Client-side sort/filter/edit/export over a spilled result are intentionally disabled (browse-only) pending server-side EXEC-005A / run-to-file EXEC-008.
- **Verified:** Rust `db::spill` unit tests (memory bounded by budget while total grows to 60k, RAM/disk window stitching, offload-off cap, hard-ceiling truncation, temp-file cleanup) **and** an end-to-end `db_run_query_spill` integration test over a 50k-row SQLite CTE (resident page == budget, store retains all rows, deep windows page correctly from disk, release frees the store); `result-window` vitest (LRU eviction keeps a 10M-row source at ≤ `maxResidentPages` resident, proxy placeholder→real after ingest); a Playwright `e2e/spill.spec.ts` that pages `row_60000`/`row_119999` from disk on deep scroll with bounded DOM, ≤ a handful of `db_result_window` fetches (never a full load), and store release on a replacing run; typegen drift check green.
- **Remaining:** Arrow-backed spill option and a 10M-row scrolling memory benchmark gate (pairs with `EXEC-004B`); reuse the spill/window contract through the local API (`API-002`) when that surface lands.
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

### BROWSE-003 — Hover inspection cards ✅
- **Goal:** See content without leaving the editor.
- **Done when:** hovering an object/column shows type, nullability, keys, indexes, DDL, comment, row-count estimate, and a quick sample, sourced from the metadata cache.
- **Done:** SQL editor hovers now resolve table/view/column tokens through the metadata cache and render object/column cards with DDL or generated definitions, type/nullability/key/default/reference detail, comments, row estimates, foreign keys, indexes, and quick samples. `F12` and `Ctrl`/`Cmd` click call the metadata jump hook so users can move from SQL text to the matching object-browser metadata. Covered by `metadata-inspection` unit tests and desktop TypeScript/build checks.
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

### EDIT-002 — SQL syntax highlighting (Tree-sitter where strong)  🟡 theme mapping + backend selector wired
- **Goal:** Editor-grade SQL structure.
- **Approach (ADR 0001):** paint via CM6 Lezer `@codemirror/lang-sql` (dialect bound to `DbEngine`) now; add `web-tree-sitter` captures as a fallback/upgrade only where a dialect grammar is solid. Map highlight tags into the THEME-001 model (not TextMate-only scopes).
- **Done:** CM6 Lezer highlighting is bound to `DbEngine` and maps through the internal THEME-001 syntax roles. Tree-sitter capture names map into the same role model, and the backend selector falls back to Lezer unless a bundled dialect grammar is explicitly marked solid.
- **Remaining:** bundle and license-vet a browser-ready Tree-sitter SQL grammar WASM + highlight query for the first solid dialect, then activate that backend for the matching engine.
- **Done when:** highlighting uses Tree-sitter queries where the grammar is solid, with a dialect fallback; tokens map to the internal theme model.
- **Depends on:** EDIT-001, THEME-001
- **Size:** M · **Priority:** P0

### EDIT-003 — Keybinding resolver + scopes ✅ scoped resolver + remap done
- **Goal:** Fully remappable shortcuts.
- **Done when:** bindings resolve per context scope, detect conflicts, and are editable; a default map ships; changes persist.
- **Done:** `src/keybindings.ts` ships a VS Code-flavored default keymap (`Mod` = Cmd on macOS / Ctrl elsewhere), platform-aware key sequence parsing, per-scope resolution (`global`, `editor`, `grid`), scoped conflict detection, and localStorage-persisted per-command overrides merged over the defaults. The global `keydown` resolver uses the active context scope, supports two-chord recording, and still avoids hijacking plain typing in fields. The sidebar lists every command with its scope and shortcut; click the chord to **rebind**, conflicts are flagged, and `↺` resets to default.
- **Remaining:** preset maps (EDIT-004).
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
- **Landed:** `@replit/codemirror-vim` is wired into the CM6 editor behind a persisted header toggle; Playwright coverage confirms the mode can be enabled/disabled, CM renders the Vim mode panel, insert mode edits text, and a normal-mode `dd` flow works. Remaining: deeper behavior tests for motions/operators/registers/counts/visual mode and any app-specific keybinding conflicts.
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

### EDIT-008 — Format + comment toggles + bracket matching  ✅ core done
- **Goal:** Editor ergonomics.
- **Approach (ADR 0001):** default formatter = `sql-formatter` v15 (MIT), `DbEngine`→language mapped, behind a pluggable format hook; comment-toggle + bracket-matching via CM6 built-ins. v2: CST/tree-sitter formatter for dialect-perfect output.
- **Done:** "Format SQL" toolbar/command-palette action (dialect-mapped), CM6 bracket matching through `basicSetup`, and SQL comment toggle through CM6's `toggleComment` (`Mod+/`) with toolbar + command palette exposure. Formatter execution goes through a small configurable hook/registry (`sql-formatter` or disabled, persisted in localStorage), so future CST/tree-sitter formatters can be added without changing the editor handle. Default editor keybindings and formatter config are covered by unit tests.
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
- **Landed:** Core importer only. `apps/desktop/src/theme.ts` exposes a pure `importVsCodeTheme(...)` path that normalizes common VS Code `colors`, TextMate `tokenColors`, and `semanticTokenColors` into `IrodoriTheme`, returning warnings, unsupported-key details, and a license note. No UI/file-import flow is wired yet.
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

**Cross-platform parity status (2026-06-26):** desktop autocomplete is no longer keyword-only: the CodeMirror editor consumes live `DatabaseMetadata` and Playwright verifies schema-driven table and alias-column suggestions. The remaining cross-platform gap is the shared serializable completion request/response service for the local API and future hosts, plus broader dialect fixtures beyond the current desktop smoke.

### CMPL-001 — Metadata cache with invalidation
- **Goal:** Fast, permissions-aware introspection.
- **Done when:** schema/object metadata caches with background refresh and invalidation; respects permissions; shared by completion and hover.
- **Landed:** `irodori-completion::MetadataCache` stores per-connection snapshots, schema/object/column/routine metadata, permission flags, foreign keys, stale TTLs, invalidation, and deduplicated refresh requests. `ensure_fresh` lets completion/hover keep using stale metadata while queuing background refresh.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P0

### CMPL-002 — Baseline completion engine (tables, columns, schemas, keywords) ✅ (desktop)
- **Goal:** Deterministic offline completion.
- **Done when:** completion suggests tables, columns, schemas, and keywords with no AI; ranking is sensible; works offline.
- **Landed:** `CompletionEngine` produces permission-aware schema/table/view/column/keyword items from `MetadataCache`, with deterministic ranking, prefix filtering, limits, and keyword casing. The desktop CodeMirror path also builds a metadata completion index from live `DatabaseMetadata`; unit tests cover schema/table/column/alias/join/keyword suggestions, and `apps/desktop/e2e/completion.spec.ts` verifies the popup receives table and alias-column suggestions in the editor.
- **Remaining product work:** expose the same completion request/response model through the local API/future host boundary and broaden cross-engine fixtures.
- **Depends on:** CMPL-001, EDIT-002
- **Size:** L · **Priority:** P0

### CMPL-002A — Cross-platform schema-aware autocomplete 🚧 (desktop wired; shared service open)
- **Goal:** Close the Snowsight/TablePlus parity gap without making completion desktop-only.
- **Done when:** the desktop editor and shared completion service suggest schemas, tables, columns, and qualified `table.column` paths from live metadata; behavior is tested for SQLite/PostgreSQL/MySQL at minimum; the request/response model is serializable so the local API and future web/native hosts can reuse it when those surfaces land.
- **Status:** Partial. Desktop schema-aware completion is wired and browser-smoke-tested with live metadata. The shared serializable completion endpoint/model for local API and future hosts is still open, and SQLite/PostgreSQL/MySQL engine fixtures should become release-gate coverage before calling the cross-platform ticket done.
- **Depends on:** CMPL-001, CMPL-002, EDIT-002
- **Size:** M · **Priority:** P0

### CMPL-003 — Context-aware completion (aliases, CTEs, subqueries) ✅ (core done)
- **Goal:** Understand query structure.
- **Done when:** completion resolves table aliases, CTE columns, and subquery columns from the parsed statement; covered by parser tests.
- **Landed:** `irodori-completion::context` adds a tolerant, dialect-agnostic statement analyzer — a quote/comment-aware tokenizer plus `analyze_statement` that extracts `FROM`/`JOIN` table references with their aliases (`from public.users u`, `join orders as o`), `WITH` CTE definitions with their output columns (explicit `(a, b)` list or inferred from the inner `select` projection), and derived subquery tables in `FROM` with their projected columns. `StatementContext::resolve(qualifier)` maps an alias / bare name to either a real table (`Table { schema, name }`) or a fixed column set (`Columns(..)` for a CTE/subquery), and `CompletionEngine::complete_qualified(cache, conn, ctx, qualifier, prefix, limit)` turns that into column suggestions — real-table columns come from the permission-aware `MetadataCache`, CTE/subquery columns from the inferred projection — with prefix filtering, ranking, and visibility honored. Covered by 14 unit tests: alias/multi-table/join extraction, schema-qualified + quoted identifiers + comments, keyword-vs-alias disambiguation, CTE (inferred + explicit), nested-subquery projection, derived tables, and end-to-end `complete_qualified` resolving `alias.`→table columns, `cte.`/`sub.`→projection columns, prefix narrowing, unknown qualifier, and permission-denied tables.
- **Remaining:** thread the analyzer into the desktop autocomplete command (`db_autocomplete`) and the CodeMirror completion source so the editor passes the statement + cursor and qualified `alias.` popups use `complete_qualified`; broaden to nested CTE scoping and `UNION`/set-operation column inference.
- **Depends on:** CMPL-002
- **Size:** L · **Priority:** P1

### CMPL-004 — Functions, procedures, signatures, overloads
- **Goal:** Routine-aware help.
- **Done when:** function/procedure completion includes signatures, overload selection, and parameter hints per dialect.
- **Landed:** routine metadata carries function/procedure kind, signature, return type, and permissions; completion emits function/procedure items with signature detail and keeps overload rows distinct by detail.
- **Depends on:** CMPL-003, KNOW-004
- **Size:** M · **Priority:** P1

### CMPL-005 — Join suggestions + generated column lists
- **Goal:** High-leverage SQL authoring help.
- **Done when:** completion proposes join conditions from keys and expands `*` to a generated column list.
- **Landed:** `ForeignKeyMetadata`, `CompletionEngine::suggest_joins`, and `CompletionEngine::expand_star` provide the core deterministic FK join-condition and visible-column-list helpers.
- **Depends on:** CMPL-003
- **Size:** M · **Priority:** P1

### CMPL-006 — Dialect-aware ranking, insert behavior, keyword casing
- **Goal:** Daily-driver polish.
- **Done when:** ranking and insert text adapt per dialect; optional keyword casing applies; settings control behavior.
- **Landed:** dialect keyword lists can seed completion (`CompletionEngine::for_dialect`), and keyword insert text supports preserve/upper/lower casing. Full per-dialect ranking and setting plumbing remain.
- **Depends on:** CMPL-002, KNOW-004
- **Size:** M · **Priority:** P1

### CMPL-007 — Explain/analyze entry points + query profile view
- **Goal:** Plan-aware help and Snowsight-style query-profile inspection.
- **Done when:** explain/analyze commands run where supported; query history can open a readable profile with operator tree/timeline/cost or engine-native details; profile data is exposed through shared contracts so desktop and future hosts render the same model.
- **Status:** Open; no explain/query-profile UI is implemented.
- **Depends on:** EXEC-001
- **Size:** M · **Priority:** P1

---

## EXT — Extension SDK

### EXT-001 — Stabilize `irodori.extension.json` ✅
- **Goal:** A documented extension manifest.
- **Done when:** the manifest schema is finalized and validated; `extension.schema.json` matches; a sample manifest validates.
- **Done:** `extension.schema.json` is the checked-in manifest contract and `tools/extensions/validate-manifests.mjs` validates all template/example `irodori.extension.json` files for required fields, unknown keys, safe relative paths, permission/contribution consistency, `MIT OR 0BSD` licensing, and sample fixtures. `make extension-manifests` and CI run the guard.
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
- **Goal:** Reach DBeaver-scale extensibility — adding an engine means implementing a trait, not editing a `match` arm. (DBeaver study, Apache-2.0, `.irodori-local/ref/dbeaver-ce`.)
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

### SRC-007 — Distributed/warehouse SQL batch (ClickHouse, BigQuery ✅)
- **Goal:** CockroachDB, ClickHouse, BigQuery, Redshift, Trino/Presto, TiDB, Databricks/Spark SQL.
- **Done when:** each connects and reaches baseline parity behind the adapter trait; tracked individually but share the SQL pipeline.
- **Done (ClickHouse, BigQuery):** clickhouse.rs (pure HTTP REST client) and bigquery.rs (pure HTTP REST client with Service Account signing) implemented and verified via integration tests. CockroachDB and TiDB also verified as postgres/mysql wire-compatible.
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

### SRC-011 — Snowflake adapter with full auth coverage ✅
- **Goal:** Every common Snowflake auth path.
- **Done when:** password, key-pair (JWT), OAuth, external-browser/SSO, MFA/passcode, and programmatic access tokens connect; warehouse/role/database context switching works; auth matrix covered by tests where possible.
- **Done:** snowflake.rs (pure HTTP REST client using Session REST API with JWT key-pair or password flow) implemented, database context switching integrated, and verified via unit tests.
- **Depends on:** SRC-001, CONN-003
- **Size:** L · **Priority:** P2

### SRC-012 — Document/KV/search sources 🚧 (MongoDB, Redis, Cassandra landed; more open)
- **Goal:** MongoDB, Redis, Elasticsearch/OpenSearch, Cassandra/Scylla, plus Couchbase/DynamoDB/Arango/Memgraph by maturity.
- **Done when:** native query surface, collection/keyspace/index browser, document viewer/editor with patch preview, and field/operator/stage completion work for the first targets (MongoDB, Redis, Elasticsearch, Cassandra/Scylla).
- **Done (MongoDB, Redis, Cassandra):** mongodb.rs (mongodb driver), redis.rs (redis client with command parser mapping to grid), and cassandra.rs (scylla driver using new lazy DeserializeRow API) implemented and verified via tests.
- **Elasticsearch/OpenSearch bar:** go deeper than a generic HTTP console. Use Kibana Discover and Dev Tools as behavior references for data views, index/data-stream/alias browsing, mappings and field capabilities, DSL and ES|QL-style authoring, filter composition, saved searches, request history, document detail/edit-with-patch-preview, explain/profile, shard/index health, and completion over fields/operators/API paths. Kibana code is behavior-only reference material because of its source-available licenses.
- **Remaining:** Elasticsearch/OpenSearch and the broader document/KV set are open; Bigtable/HBase wide-column work is tracked separately in `SRC-014`.
- **Depends on:** SRC-001
- **Size:** L · **Priority:** P2

### SRC-013 — Delta Lake / Apache Hudi (after Iceberg)
- **Done when:** read access to Delta and Hudi tables works through the lakehouse path; introspection verified.
- **Depends on:** SRC-010
- **Size:** L · **Priority:** Later

### SRC-014 — Google Bigtable / HBase wide-column adapter
- **Goal:** First-class wide-column source support beyond Cassandra.
- **Done when:** Bigtable connects via service-account and application-default credentials; instances, clusters, tables, and column families are browsable; bounded row-key range scans and cell-version display stream into the grid; filters are explicit and previewable; the HBase-compatible path is evaluated or split into its own ticket; browse/completion semantics are documented.
- **Status:** Open. Cassandra/Scylla-driver support landed under `SRC-012`; no Bigtable/HBase adapter is implemented here yet.
- **Depends on:** SRC-001, EXEC-004A
- **Size:** L · **Priority:** P2

---

## IO — Export/Import + Dump/Restore

**Beekeeper import/export parity status:** open/partial. Desktop current-result export supports CSV, TSV, JSON, JSONL, SQL INSERT text, an Excel-compatible HTML workbook (`.xls`), and Markdown. That is not the shared streaming `irodori-io` encoder/run-to-file path, not native `.xlsx`, and not full import/dump/restore parity. Do not describe full import/export parity as implemented until large-result export, import previews/mapping, native XLSX, Avro/Parquet, and dialect dump/restore are wired and tested.

### IO-001 — Export encoder layer
- **Goal:** Shared, streaming encoders in `irodori-io`.
- **Done when:** a streaming encoder interface exists; CSV/TSV implemented with header on/off and delimiter/quote control; used by the grid and run-to-file.
- **Status:** Partial. `apps/desktop/src/result-export.ts` has a client-side current-result serializer for CSV/TSV/JSON/JSONL/SQL/Excel-compatible HTML workbook/Markdown, but the shared streaming encoder interface and run-to-file integration remain open.
- **Depends on:** EXEC-002
- **Size:** M · **Priority:** P0

### IO-002 — SQL INSERT/UPSERT script export
- **Done when:** results export as INSERT/UPSERT scripts, with or without schema/DDL, dialect-correct quoting, and batch sizing.
- **Status:** Partial. Desktop current-result export can emit simple SQL `INSERT` statements. UPSERT, DDL/schema options, dialect-specific quoting/batching, and streaming/shared encoder integration remain open.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P1

### IO-003 — JSON / NDJSON export+import
- **Done when:** results export to JSON and NDJSON; import maps NDJSON/JSON into a target table with type mapping and a preview.
- **Status:** Partial for desktop export only. Current-result JSON and JSONL are implemented; JSON/NDJSON import with table mapping and preview remains open.
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

### IO-008 — Native XLSX result export
- **Goal:** Produce real `.xlsx` workbooks instead of only Excel-compatible HTML.
- **Done when:** result export writes a native XLSX workbook with worksheet names, basic cell types, safe large-value handling, and tests that open/inspect the package structure; large exports use the streaming/run-to-file path rather than buffering the whole result in memory.
- **Status:** Open. The current "Excel" export is an HTML workbook served as `.xls`, which opens in Excel but is not a native `.xlsx` file.
- **Depends on:** IO-001
- **Size:** M · **Priority:** P2

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
- **Size:** M · **Priority:** P1

### AI-002 — Audit log + redaction for AI payloads
- **Goal:** Privacy-safe AI.
- **Done when:** query text, schema, and result samples are separately permissioned; every AI call is audited; redaction applies before send; verified by a test.
- **Depends on:** AI-001, NET-006
- **Size:** M · **Priority:** P1

### AI-003 — MCP bridge (Copilot-compatible)
- **Goal:** Expose safe tools instead of embedding Copilot.
- **Done when:** an MCP server exposes read-only schema/search/explain/query tools with scopes; a Copilot-compatible client can call them; the same schema/search payloads are reusable by desktop inline completion and future hosts instead of duplicating provider-specific logic.
- **Depends on:** AI-002
- **Size:** L · **Priority:** P1

### AI-004 — Copilot-style inline autocomplete and patch suggestions
- **Goal:** Close the Snowsight/Cortex Code-style inline assistance gap without making AI mandatory.
- **Done when:** the editor can request opt-in inline SQL suggestions or patch-style edits from local/OpenAI-compatible providers using selected SQL, cursor context, and separately permissioned schema metadata; suggestions are previewed as text/diffs and never execute automatically; the provider/context contract is shared across desktop, MCP/Copilot-compatible clients, and future hosts.
- **Status:** Open; no Copilot-style autocomplete or inline patch UI is implemented.
- **Depends on:** AI-001, AI-002, AI-003, CMPL-002A
- **Size:** L · **Priority:** P1

### AI-005 — Query Magics command layer 🚧 (desktop baseline landed)
- **Goal:** Add Beekeeper-style command shortcuts without making SQL execution ambiguous.
- **Done when:** the editor recognizes explicit magic commands before execution, shows a preview of the expanded SQL/action, and supports at least schema inspect, explain, export, ERD open, result-to-file, and parameter prompt flows; normal SQL with similar text is never intercepted.
- **Syntax:** line-leading commands only (`\\describe table`, `\\explain`, `\\export csv`, `\\erd schema.table`, `\\params`) plus a command-palette equivalent for every magic.
- **Safety:** every magic is parsed locally, audited as a structured action, and either expands to visible SQL or calls an existing scoped command; destructive commands require the same confirmation path as hand-written SQL.
- **Landed:** desktop parses line-leading magic commands locally before execution. `\\describe` expands to dialect-aware column-inspection SQL, `\\explain` expands to visible explain SQL, `\\erd` opens the ERD modal with an optional filter, `\\export <format>` exports the current result through the existing export path, and `\\params <sql>` opens the parameter prompt flow. Parser/unit tests cover expansion and errors; Playwright verifies `\\explain` execution and `\\erd` modal opening.
- **Remaining:** command-palette equivalents for every magic, structured audit/history entries for magic actions, result-to-file/run-to-file magic, and broader per-dialect describe/explain fixtures.
- **Depends on:** EXEC-006, IO-001, ADV-004A
- **Size:** M · **Priority:** P1

### AI-006 — AI Shell
- **Goal:** Optional, privacy-controlled assistant for query drafting, explanation, and repair.
- **Done when:** a dockable shell can answer with context from selected SQL, active schema metadata, query errors, and opt-in result samples; it can propose SQL patches but cannot run them without putting SQL in the editor first; local/OpenAI-compatible providers work behind the same provider interface.
- **Safety:** off by default; workspace policy controls provider, schema sharing, SQL text sharing, and result sample sharing; every payload is visible in an audit panel and redacted before send.
- **UX:** VS Code-like side panel with chat history scoped to the connection/workspace, "Insert into editor", "Explain plan", "Fix error", and "Generate test query" actions.
- **Status:** Open. No AI Shell UI/provider flow is implemented.
- **Test plan:** provider mock tests, redaction/audit tests, no-network default test, and Playwright smoke for shell open/insert workflow.
- **Depends on:** AI-001, AI-002, EXEC-006, CMPL-002
- **Size:** L · **Priority:** P1

---

## ADV — Advanced Workflows

### ADV-001 — Schema compare + migration preview ✅ (core done)
- **Done when:** two schemas diff into a readable change set and a migration script preview; safe-apply path documented.
- **Landed:** `irodori-sql::schema` adds a pure, source-agnostic schema model (`Schema`/`Table`/`Column`/`Index`) plus `diff_schemas(old, new) -> SchemaDiff` — a structural change set of added/dropped tables, and per-table added/dropped columns, altered columns (type / nullability / default changes), and added/dropped indexes (a changed index def is a drop+recreate). `SchemaDiff::summary()` renders a readable header (`users (+1col, -1col, ~1col)`), `has_destructive_changes()`/`is_empty()` gate the flow, and `SchemaDiff::to_migration(dialect, AlterColumnStyle)` renders a **dialect-quoted migration preview**: CREATE/DROP TABLE (+ its indexes), ADD/ALTER/DROP COLUMN, and CREATE/DROP INDEX, ordered so the script applies cleanly (add/alter cols → drop indexes → drop cols → create indexes). `AlterColumnStyle` covers Postgres/ANSI granular `ALTER COLUMN` vs MySQL single-statement `MODIFY COLUMN` (and table-scoped `DROP INDEX … ON t`). Every `MigrationStatement` carries a `destructive` flag (DROPs), and the module **only generates SQL, never executes it** — the documented safe-apply contract is preview → confirm destructive steps → run inside a transaction where DDL is transactional. Covered by 9 unit tests (no-change, add/drop table, column add/drop/alter on Postgres, MySQL MODIFY + backticks, index add/drop/recreate, summary).
- **Remaining:** map live `DatabaseMetadata` into the `Schema` model and surface the diff + preview in a desktop UI (review + safe-apply), plus richer constraint/FK and per-dialect type-mapping coverage.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P2

### ADV-002 — Data compare + safe bulk edit
- **Done when:** row-level data compare produces a reviewable diff and a transactional bulk-edit plan.
- **Depends on:** EXEC-007
- **Size:** L · **Priority:** P2

### ADV-003 — No-code schema editor / table designer
- **Goal:** Close the Beekeeper-style no-code schema editor gap.
- **Done when:** create/alter tables, indexes, and constraints through a UI that emits reviewable DDL.
- **Status:** Open. There is no no-code schema editor/table designer yet.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P2

### ADV-004 — ERD baseline + graph-view umbrella 🚧 (schema ERD implemented; graph views open)
- **Done when:** schema ERD renders from metadata; image export, multi-schema representation, and layout quality are tracked in `ADV-004A`-`ADV-004C`; query-result graph views are tracked in `ADV-004D`.
- **Done (schema ERD SVG renderer):** the object browser's diagram button (or `Mod+Shift+D` / "Show ER diagram" in the palette) renders a deterministic SVG ERD from the active connection's metadata. `apps/desktop/src/erd.ts` builds the pure metadata->model->layout path and still generates copyable Mermaid source for interoperability; `apps/desktop/src/erd-export.ts` handles SVG serialization, PNG rendering, downloads, and clipboard helpers. The modal groups tables into schema bands, disambiguates duplicate table names with `schema.table`, resolves cross-schema FKs, and provides schema chips, schema/table/column search, zoom/fit controls, SVG/PNG downloads, SVG text copy, and PNG clipboard copy where the platform supports it.
- **Status:** Partial. Schema ERD baseline is implemented; graph views and ERD QA hardening are open in the `ADV-004` subitems.
- **Remaining:** query-result graph views (`ADV-004D`); FK metadata for SQL Server/Oracle (SQLite/Postgres/MySQL done); visual regression screenshots, PNG pixel/non-empty export smoke, edge-overlap/label-visibility smoke, and a recorded/manual large-schema benchmark.
- **Depends on:** BROWSE-001
- **Size:** L · **Priority:** P1

### ADV-004A — ERD image export 🚧 (feature implemented; export QA open)
- **Goal:** Make diagrams shareable outside the app.
- **Done when:** the ERD modal exports SVG and PNG from the currently rendered diagram; exported files include the current theme, schema/table labels, PK/FK markers, and viewport-independent dimensions; copy-to-clipboard supports SVG text and PNG image where the platform allows.
- **Done:** the ERD modal serializes the rendered SVG with embedded theme styles, downloads SVG, renders PNG through canvas for download, copies SVG text, and copies PNG through the ClipboardItem path where the WebView/browser supports it.
- **Status:** Partial until required export smoke/pixel checks are in place.
- **Remaining QA:** focused SVG serialization unit coverage, Playwright export smoke, and pixel/non-empty checks for PNG output.
- **Depends on:** ADV-004
- **Size:** S · **Priority:** P1

### ADV-004B — Multi-schema ERD representation 🚧 (feature implemented; dense-schema QA open)
- **Goal:** Make cross-schema databases readable instead of turning every schema into one flat graph.
- **Done when:** diagrams can group tables by schema using visible bands/clusters; same-table-name collisions are disambiguated; cross-schema FK edges remain legible; users can filter schemas/tables before rendering; the Mermaid/source export preserves schema qualification.
- **Done:** schema bands/clusters are generated by the SVG layout; same-name tables are labelled with schema qualification; cross-schema edges are dashed; schema chips and text search filter the diagram before layout; Mermaid export uses schema-qualified safe IDs. Unit coverage exercises duplicate names, cross-schema FKs, schema/search filtering, missing FK targets, and Mermaid qualification.
- **Status:** Partial until many-schema/dense-edge visual checks are recorded.
- **Remaining QA:** screenshot/visual checks for many-schema databases and dense cross-schema edge sets.
- **Depends on:** BROWSE-001, ADV-004
- **Size:** M · **Priority:** P1

### ADV-004C — ERD layout quality pass 🚧 (feature implemented; dense-edge benchmark open)
- **Goal:** Make ERD useful on real schemas, not just demos.
- **Done when:** a large-schema fixture renders with bounded table overlap, readable labels, zoom/pan/fit controls, schema/table search, and stable relayout after filtering; the layout strategy is documented behind the metadata model.
- **Done:** the layout strategy moved from Mermaid-rendered output to deterministic schema-stacked SVG cards. Unit tests cover duplicate names, cross-schema FKs, filtering, Mermaid qualification, and a 100-table fixture with table-overlap assertions. The modal has zoom in/out, fit, scroll-based pan, schema filters, and search.
- **Status:** Partial until visual regression and 100-table / 250-edge benchmark evidence are recorded.
- **Remaining QA:** visual regression screenshots for small, medium, and wide schemas; edge-overlap/label-visibility smoke checks; and a recorded/manual benchmark against a 100-table / 250-edge seed. Current automated coverage proves 100-table table placement and 99 FK edges, not the full dense-edge visual target.
- **Depends on:** ADV-004B
- **Size:** L · **Priority:** P1

### ADV-004D — Query-result graph views
- **Goal:** Visualize graph-shaped query results without requiring a separate graph workspace first.
- **Done when:** query results with node/edge-like columns can render as an interactive graph; mappings are explicit and saveable; the graph-view spec is serializable so desktop, local API, and future hosts render the same definition.
- **Status:** Partial. The desktop can detect Neo4j-style node/relationship values and generic source/target edge rows and render a basic graph result view, but this remains a specialized graph-source affordance. It is not a general BI visualization surface; explicit mappings, saved definitions, interaction polish, and usage-oriented presets remain open.
- **Depends on:** EXEC-002, ADV-004
- **Size:** L · **Priority:** P1

### ADV-004E — Charts, worksheet visualizations, and dashboards
- **Goal:** Cover Snowsight-style visual analysis from query results across platforms.
- **Done when:** result sets can become charts with explicit x/y/series/type mappings; dashboards can save multiple visual tiles against queries; the visualization spec is serializable so desktop can render it now and the local API/future hosts can reuse it when those surfaces land; exports include image and data paths.
- **Status:** Partial. Desktop current-result charting now has a first vertical slice: the result pane detects numeric/date/category columns, offers a `Chart` mode beside `Data`, supports bar/line/scatter x/y mappings, sum/avg/min/max/count metrics, sort and limit controls, reflects current grid filters/sort, limits sampled/series rows defensively, and can open the chart in a larger in-app chart window. Remaining: saved visualization specs, series/color encodings, dashboard tiles, image export, cross-platform API shape, and charting over spilled/local cached datasets.
- **Depends on:** EXEC-002, EXEC-005A, EXT-004, IO-001
- **Size:** L · **Priority:** P1

### ADV-004F — Local visualization dataset cache (SPICE-like)
- **Goal:** Let users materialize a query result into a local temporary analytical dataset so charts, pivots, and dashboard tiles can be re-aggregated quickly without re-running the source query.
- **Done when:** a result can be promoted to a named local dataset backed by DuckDB/SQLite/Arrow/Parquet with TTL/manual release; charts query that dataset for group-by/filter/order/limit operations; refresh and lineage back to source SQL are visible; large datasets stay bounded by disk/memory settings; the same dataset can feed the local API and future dashboards.
- **Status:** Open. `EXEC-010` already has a browse-oriented temp SQLite spill store, but that store is intentionally not an analytical cache. This ticket should reuse the window/offload lessons while adding an explicit BI dataset contract similar in spirit to Amazon QuickSight SPICE.
- **Depends on:** EXEC-010, ADV-004E, IO-001
- **Size:** L · **Priority:** P1

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

### QA-004 — Headless UI smoke tests  🟡 desktop frontend smoke landed
- **Goal:** Confidence the app actually runs.
- **Done when:** a headless driver launches the Tauri shell, connects to SQLite, runs a query, and asserts result rows; runs in CI.
- **Landed (desktop frontend portion):** Playwright smoke (`e2e/smoke.spec.ts`, `npm run test:e2e`) drives the desktop Vite frontend headless — shell renders, CodeMirror mounts with highlighting, theme toggles, Format SQL reflows. Tauri `invoke` is absent in a plain browser (app falls back to mock snapshot), so connect/query is **not** covered here. Remaining: full Tauri+SQLite smoke via a Tauri runner (e.g. tauri-driver/WebDriver) for the connect→query→assert-rows path. Note: set `PW_CHROME_PATH` to reuse a local Chromium when Playwright browser downloads are blocked.
- **Depends on:** SHELL-001, EXEC-001
- **Size:** L · **Priority:** P1

### QA-005 — Performance regression benchmarks in CI
- **Goal:** Keep "fast" measurable.
- **Done when:** grid-scroll, startup, and idle-memory benchmarks run in CI and flag regressions past a threshold.
- **Depends on:** PERF-003, EXEC-004
- **Size:** M · **Priority:** P1
