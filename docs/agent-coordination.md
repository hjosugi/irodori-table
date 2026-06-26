# Agent Coordination — Claude ⇄ Codex

This repo is worked by two AI agents in parallel. This doc is the **async channel**
between them: decisions, file ownership, and a running message log. Read it before
editing; append to the log when you start or finish a unit of work.

Last updated: 2026-06-25 JST by **Worker Docs-4**.

## Who is doing what

- **Codex** — owns the **Rust database layer** (`apps/desktop/src-tauri/src/db/**`):
  engines, native pools, per-type decoders, metadata introspection, the `Connection`
  trait + registry. (This is where all of the recent work — native pools, mssql/duck,
  metadata — has been happening.)
- **Claude / frontend workers** — own the **frontend editor + workbench**
  (`apps/desktop/src/**`) and frontend-facing docs when assigned. The EDIT track is
  anchored by ADR 0001; current status is CM6 editor + keyword/basic completion +
  formatter wired, with schema-aware completion product wiring still open.

This split matches the recent collision history: every edit collision so far was inside
`src/db/*.rs`. Keeping Rust-db with Codex and frontend with Claude removes the overlap.

## Decisions on record

- **ADR 0001 — Editor stack** (`docs/adr/0001-editor-stack.md`): editor host =
  **CodeMirror 6**; highlighting = CM6 Lezer (paint) + `web-tree-sitter` (semantic);
  formatter = `sql-formatter` v15 (pluggable). Decides EDIT-001; gates EDIT-002/008.
  **Status: accepted as implementation direction.** CM6 and the formatter exist;
  schema-aware completion remains open until metadata-backed suggestions are wired,
  user-facing, and tested through a shared completion contract.

## File ownership (to avoid clobbering)

| Area | Path | Owner | Rule |
|---|---|---|---|
| Rust DB layer | `src-tauri/src/db/**` | **Codex** | Claude does not edit. |
| Rust app glue | `src-tauri/src/lib.rs`, `main.rs` | **Codex** | Claude proposes via log, Codex applies. |
| Frontend | `apps/desktop/src/**`, frontend `package.json` | **Claude** | Codex does not edit. |
| Generated TS | `apps/desktop/src/generated/irodori-api.ts` | **Codex regenerates** | Claude consumes only; never hand-edit. |
| Docs / backlog | `docs/**`, `ROADMAP.md` | shared | Announce in log; obey current task ownership; don't both edit the same file in the same window. |

If you must cross a boundary, leave a note in the log first and keep the edit minimal.

## Task navigation

Use this file for ownership, handoffs, and corrections that keep parallel workers
from clobbering one another. Do **not** treat the message log as the product status
source of truth.

- Built/verified snapshot: `docs/implementation-progress.md`.
- Ticket-level status: `docs/implementation-backlog.md`.
- Product capability view: `docs/feature-matrix.md`.
- Editor-stack decision and current editor caveats: `docs/adr/0001-editor-stack.md`.

Current editor-status shorthand for future workers: CM6 host exists; keyword/basic
completion exists; `sql-formatter` is wired; schema/table/column completion still
needs product wiring and tests before it can close any schema-aware autocomplete item.

## Message log (append-only; newest at top)

### 2026-06-25 — Worker Docs-4 correction
- Product roadmap status treats user-facing autocomplete as keyword/basic only until
  schema/table/column suggestions are wired and tested through a shared
  cross-platform completion contract. The 2026-06-22 schema-aware completion note
  below remains useful implementation context, but it does **not** close the
  schema-aware autocomplete parity item by itself.
- This doc now points future workers to `implementation-progress`, `implementation-backlog`,
  `feature-matrix`, and ADR 0001 instead of maintaining a duplicate task table here.

### 2026-06-22 (later 4) — Claude
- **Test foundation (QA-001 + QA-004 partial):** added `vitest` (21 unit tests)
  over extracted pure modules `src/sql/statements.ts` + `src/sql/dialect.ts`, and a
  **Playwright headless-browser smoke** that actually runs the frontend (shell +
  CodeMirror + theme toggle + format). Closes the "never run it" gap for the editor.
  Scripts: `npm test`, `npm run test:e2e`.
- **For Codex / CI:** a GH Actions matrix should run `cargo test --workspace`
  **and** `npm test`. The Playwright smoke needs a
  Chromium; `cdn.playwright.dev` is egress-blocked in this sandbox so I reused a
  local browser via `PW_CHROME_PATH` — CI with normal egress can `playwright install`.
  Full Tauri+SQLite UI smoke (connect→query→rows) still needs a Tauri WebDriver run.
- Frontend-only; no `src-tauri/**` touched.

### 2026-06-22 (later 3) — Claude
- **THEME-001:** normalized theme model in `apps/desktop/src/theme.ts` (single
  source: `ui` + `syntax` colors, `lightTheme`/`darkTheme`). Editor fully themed
  in both modes; shell driven via `cssVariables` on `.app-shell`; titlebar
  light/dark toggle + persistence. `tsc` + `vite build` green.
- Frontend-only; no `src-tauri/**` touched. Remaining: full workbench dark mode
  (THEME-001b — converting deep `App.css` hardcoded panels to vars).

### 2026-06-22 (later 2) — Claude
> Historical implementation note only; for product status, use the 2026-06-25
> correction above.

- Historical attempt: wired active `DatabaseMetadata` into CM6
  `sql({ schema, defaultSchema })`, so tables and `table.`->columns were expected
  to complete in that slice. Product status still requires revalidation through
  the shared completion contract before calling this schema-aware autocomplete
  shipped. `tsc` + `vite build` was green for that historical change.
- **This consumes the introspection you own** (`db_list_objects` → `DatabaseMetadata`).
  If this path is revalidated, richer per-engine metadata (routines, comments,
  Mongo nested fields, etc.) should improve editor completion through the shared
  completion contract rather than one-off frontend wiring.

### 2026-06-22 (later) — Claude
- **Took in Codex PR #1** (`codex/implement-connect_engine-for-new-databases`):
  merged into `claude/bold-volta-vpjmmp`. H2 is consistent across backend enum,
  generated bindings, and frontend. (PR #1 still open against `main`; I did not
  merge it to main or close it — your call.)
- **Built the CM6 editor** per ADR 0001 (`apps/desktop/src/SqlEditor.tsx` +
  `App.tsx`/`App.css`): dialect-aware highlighting bound to the active engine,
  keyword autocomplete, bracket matching, and a "Format SQL" toolbar action via
  `sql-formatter`. `tsc` clean, `vite build` green. Added frontend deps
  (`codemirror`, `@codemirror/*`, `sql-formatter`).
- **Historical env note:** backend compilation used to require a local
  `typeship` path dependency. It now consumes the published `typeship` crates,
  so `cargo` and `npm run typegen` work from a normal checkout.
- Per the user, Claude now drives the remaining editor track (EDIT-002/008
  follow-ups, tree-sitter spike) solo; Codex's Rust db layer stays Codex's.

### 2026-06-22 — Claude
- Researched the editor question (CM6 vs Monaco vs native/tree-sitter; sql-formatter;
  tree-sitter SQL grammar coverage) and verified reference projects: Beekeeper = CM6,
  Outerbase = CM6 + lang-sql, Zequel = Monaco, DBeaver/DataGrip = native parsers.
- Wrote **ADR 0001** with the recommendation and rationale.
- **Asks of Codex:** (1) ack/critique ADR 0001 before I add CM6 deps to the frontend
  `package.json`; (2) confirm you own the connection-manager secret/keychain (Rust) and
  the per-engine metadata introspection so I wire the matching UI without touching
  `src/db/**`; (3) when you change any Rust type in the command boundary, regenerate
  `irodori-api.ts` and note it here so I rebase the frontend types.
- Not touching `src-tauri/src/db/**` or `engine.rs`.
