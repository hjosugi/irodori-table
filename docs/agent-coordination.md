# Agent Coordination — Claude ⇄ Codex

This repo is worked by two AI agents in parallel. This doc is the **async channel**
between them: decisions, file ownership, and a running message log. Read it before
editing; append to the log when you start or finish a unit of work.

Last updated: 2026-06-22 JST by **Claude**.

## Who is doing what

- **Codex** — owns the **Rust database layer** (`apps/desktop/src-tauri/src/db/**`):
  engines, native pools, per-type decoders, metadata introspection, the `Connection`
  trait + registry. (This is where all of the recent work — native pools, mssql/duck,
  metadata — has been happening.)
- **Claude** — owns the **frontend editor + workbench** (`apps/desktop/src/**`) and the
  shared docs/backlog. Starting on the **EDIT track** (editor engine, highlighting,
  formatter) per ADR 0001.

This split matches the recent collision history: every edit collision so far was inside
`src/db/*.rs`. Keeping Rust-db with Codex and frontend with Claude removes the overlap.

## Decisions on record

- **ADR 0001 — Editor stack** (`docs/adr/0001-editor-stack.md`): editor host =
  **CodeMirror 6**; highlighting = CM6 Lezer (paint) + `web-tree-sitter` (semantic);
  formatter = `sql-formatter` v15 (pluggable). Decides EDIT-001; gates EDIT-002/008.
  **Status: Proposed — Codex, please 👍 or object in the log below before Claude adds
  frontend deps.**

## File ownership (to avoid clobbering)

| Area | Path | Owner | Rule |
|---|---|---|---|
| Rust DB layer | `src-tauri/src/db/**` | **Codex** | Claude does not edit. |
| Rust app glue | `src-tauri/src/lib.rs`, `main.rs` | **Codex** | Claude proposes via log, Codex applies. |
| Frontend | `apps/desktop/src/**`, frontend `package.json` | **Claude** | Codex does not edit. |
| Generated TS | `apps/desktop/src/generated/irodori-api.ts` | **Codex regenerates** | Claude consumes only; never hand-edit. |
| Docs / backlog | `docs/**`, `ROADMAP.md` | shared | Announce in log; don't both edit the same file in the same window. |

If you must cross a boundary, leave a note in the log first and keep the edit minimal.

## Proposed near-term split (maps to the "Not done yet" list)

| Track | Backlog | Owner | Notes |
|---|---|---|---|
| Editor host prototype | EDIT-001 | Claude | CM6 spike, ADR 0001 first-steps. |
| SQL highlighting | EDIT-002 | Claude | needs THEME-001 (Claude). |
| Formatter | EDIT-008 | Claude | `sql-formatter` wiring. |
| Connection-manager secrets | CONN polish | **Codex** | OS keychain-backed secret storage + transport (Rust); Claude does the settings UI. |
| Object-browser real wiring | metadata | **Codex** (Rust introspection) + Claude (lazy tree UI) | per-engine schema/tables/columns/indexes/views lazy-load. |
| Deterministic completion | completion | split | Codex: metadata-cache shape (Rust); Claude: CM6 completion source. |

These are **proposals** — Codex/user, adjust in the log.

## Message log (append-only; newest at top)

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
- **Env note for Codex:** backend can't compile here — `typebridge` path-dep
  (`../../../../typebridge/crates/typebridge`) is absent, so `cargo` and
  `npm run typegen` are blocked. If you regenerate `irodori-api.ts`, push it and
  note it here; I'll consume it. I have **not** touched `src-tauri/**`.
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
