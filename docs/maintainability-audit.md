# Maintainability Audit

Snapshot date: 2026-06-27.

This audit summarizes the current line-count and complexity hotspots in the
first-party code. The counts below exclude generated files, dependencies,
`.irodori-local/target/`, `.irodori-local/ref/`, and static site build assets. Complexity values are approximate:
TypeScript/TSX was scanned with the local TypeScript parser, while Rust was
checked with a rough token pass because the repo does not yet have a committed
complexity tool.

## Top Oversized Files

| Rank | File | Lines | Main risk | Suggested next move |
| ---: | --- | ---: | --- | --- |
| 1 | `apps/desktop/src/app/AppWorkbench.tsx` | 4,157 | The former `App.tsx` controller still owns query execution, result-grid state, connection actions, settings JSON, keybindings, ERD/import/export, and modal orchestration. `apps/desktop/src/App.tsx` is now a 4-line entrypoint. | Split this controller into feature hooks; start with query execution and result-grid control. |
| 2 | `apps/desktop/src-tauri/src/db/mod.rs` | 2,527 | Backend DB facade still mixes connection registry, state, command wrappers, stream/spill handling, and tests. Profile, connection registry, transport resolution, and metadata/cache conversion are now split out. | Split command surface and shared runtime state next. |
| 3 | `crates/irodori-io/src/tabular.rs` | 1,889 | Export encoders, import preview, schema inference, and tests share one module. | Move format-specific encoders/importers into submodules. |
| 4 | `apps/desktop/src/sql/completion.ts` | 1,408 | Completion scanning, parsing helpers, and suggestion ranking are still dense; snippet parsing is now split out. | Split parser/scanner from metadata ranking next. |
| 5 | `crates/irodori-core/src/connection.rs` | 1,364 | Connection profile schemas and validation cover many transport/auth variants. | Split transport/auth/portable model sections once external shape is stable. |
| 6 | `apps/desktop/src/styles/results.css` | 1,318 | Result-grid, editing, detail, and mode-specific styles are coupled. | Split by results subcomponent after component extraction lands. |
| 7 | `apps/desktop/src/styles/workbench.css` | 1,192 | Workbench layout, chrome, panes, inspectors, editor hover styles, and responsive rules share one stylesheet. | Split along `WorkbenchShell`, sidebar, inspector, and editor concerns. |
| 8 | `apps/desktop/src/features/settings/SettingsDialog.tsx` | 1,150 | The dialog is already extracted but still has many tabs and high branch count. | Split tabs into local child components after `App.tsx` stops owning settings JSON parsing. |
| 9 | `apps/desktop/src/theme/index.ts` | 1,123 | Theme conversion and TextMate scope mapping are broad; `syntaxRolesForTextMateScope` is a complexity hotspot. | Isolate VS Code import normalization and syntax-role mapping. |
| 10 | `crates/irodori-core/src/jobs.rs` | 1,088 | Job DTOs, runtime state, retry/cancellation, artifacts, and tests sit together. | Separate public job model from executor/runtime internals. |
| 11 | `apps/desktop/src-tauri/src/git/mod.rs` | 1,046 | Git command state, graph formatting, diff/status parsing, and tests are in one module. | Split parsing/model helpers from Tauri command surface. |
| 12 | `crates/irodori-completion/src/completion.rs` | 934 | Completion logic is dense and algorithmic. | Keep unit coverage high before module splitting. |

## App Workbench Split Plan

Current status: `apps/desktop/src/App.tsx` is a 4-line entrypoint. The remaining
large file is `apps/desktop/src/app/AppWorkbench.tsx`; it is an intermediate
controller, not the final architecture. The goal is to reduce it below roughly
800-1,000 lines by moving feature behavior beside the existing feature modules.

1. Extract query execution first.
   Move `runQuery`, `runEditorSql`, parameter prompting, streaming/spill result
   publication, history writes, cancellation, and schema refresh side effects
   into a query/results controller hook. This is the highest payoff because
   `executeQuery` alone is about 322 lines with approximate complexity 28.

2. Move result-grid control logic into `features/results`.
   Keep virtualization constants, scroll handling, selection/copy/paste,
   edit-draft mutation, sorting/filtering, and spill page loading close to
   `ResultsPane` and the result-grid stores. This should also shrink the very
   large `ResultsPane` prop list.

3. Move connection actions into `features/connections`.
   Keep profile CRUD, test/connect/disconnect, metadata refresh, and sidebar
   selection with the connection store. `App.tsx` should receive current
   connection view state and call feature-level actions.

4. Move settings import/export and keybinding recording.
   `buildSettingsJson`, `applySettingsJson`, keymap conflict/recording state,
   and the global keydown listener should live with settings/preferences and
   command handling instead of the root shell.

5. Finish feature-owned modal actions.
   ERD export/copy, import preview SQL generation, schema designer SQL actions,
   and diagnostics can move into their feature modules or small hooks. The root
   should only decide which dialogs are open.

6. Add size guards after the split.
   Once extraction is underway, add a lightweight line-count budget for new
   frontend components and large Rust modules so `App.tsx` does not grow back.

## Backend DB Facade Split Progress

Current status: the old single `apps/desktop/src-tauri/src/db.rs` has been
modularized under `apps/desktop/src-tauri/src/db/`. The facade is still large,
but it no longer owns every support concern directly.

- `db/profile.rs` owns `ConnectionProfile`, profile normalization, unsupported
  wire rejection, and secret redaction.
- `db/connection.rs` owns the `Connection` trait, per-engine wrappers, and the
  connector registry.
- `db/transport.rs` owns proxy/SSH transport secret resolution before a local
  forwarder is started.
- `db/meta.rs` owns relational metadata accumulation plus the bridge between
  desktop `DatabaseMetadata`, the completion `MetadataSnapshot`, and inspection
  DTOs used by autocomplete/hover commands.
- `db/query.rs`, `db/spill.rs`, `db/edit.rs`, and engine modules already hold
  query shaping, retained-result paging, edit payloads, and per-driver logic.

Next backend split: move Tauri command wrappers and command DTOs into a command
surface module, then move `DbState` runtime bookkeeping into a state/runtime
module. Keep each step behavior-preserving and gated by `cargo check`,
`typegen:check`, and focused metadata/query tests.

## SQL Completion Split Progress

Current status: `apps/desktop/src/sql/completion.ts` remains the main
lightweight SQL completion engine, but snippet defaults and JSON validation now
live in `apps/desktop/src/sql/snippets.ts` and are re-exported from
`completion.ts` for source compatibility.

Next completion split: move tokenization/current-statement parsing into a
scanner module, then keep ranking and CodeMirror option conversion in the
completion module.

## Current Tooling Gaps

- No committed maintainability metric command. `Makefile` has `test`, `build`,
  `security`, and generated-doc checks, but no line-count, complexity, or module
  size budget target.
- No root lint/format gate. Frontend scripts run `tsc`, Vite, and Vitest, but
  there is no ESLint, Biome, Prettier, or stylelint command in the app scripts.
- Rust checks do not include `cargo fmt --check` or `cargo clippy -- -D warnings`
  in `make check`; it currently runs `cargo test` plus frontend test/build.
- No dead-code or dependency hygiene pass is wired in for TypeScript or Rust
  (`knip`, `ts-prune`, `cargo-udeps`, or similar).
- No CI-enforced per-file/component budget. Oversized files can land unless a
  reviewer catches them manually.
- No CSS maintainability tooling. The largest stylesheets are over 1,000 lines
  without stylelint or ownership boundaries.

## Recommended Guardrails

- Add a read-only `make maintainability` target that reports top file sizes,
  top TypeScript/TSX function complexity, and top Rust function length/branch
  counts.
- Start with warning-only budgets: flag source files over 800 lines, React
  components over 300 lines, and functions over complexity 20.
- Promote only the narrowest budgets to CI at first, such as "no new file over
  1,000 lines without an explicit audit note."
- Keep split PRs behavior-preserving and test-backed. Avoid mixing extraction
  with UI or database behavior changes.
