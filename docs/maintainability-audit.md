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
| 2 | `apps/desktop/src/sql/completion.ts` | 1,408 | Completion scanning, parsing helpers, and suggestion ranking are still dense; snippet parsing is now split out. | Split parser/scanner from metadata ranking next. |
| 3 | `crates/irodori-io/src/tabular.rs` | 1,379 | Export encoders still share one module, but import preview/schema inference/tests are now split out. | Move format-specific export encoders into submodules. |
| 4 | `apps/desktop/src/styles/results.css` | 1,318 | Result-grid, editing, detail, and mode-specific styles are coupled. | Split by results subcomponent after component extraction lands. |
| 5 | `apps/desktop/src/styles/workbench.css` | 1,209 | Workbench layout, chrome, panes, inspectors, editor hover styles, and responsive rules share one stylesheet. | Split along `WorkbenchShell`, sidebar, inspector, and editor concerns. |
| 6 | `apps/desktop/src/features/settings/SettingsDialog.tsx` | 1,150 | The dialog is already extracted but still has many tabs and high branch count. | Split tabs into local child components after `App.tsx` stops owning settings JSON parsing. |
| 7 | `apps/desktop/src/theme/index.ts` | 1,123 | Theme conversion and TextMate scope mapping are broad; `syntaxRolesForTextMateScope` is a complexity hotspot. | Isolate VS Code import normalization and syntax-role mapping. |
| 8 | `crates/irodori-core/src/jobs.rs` | 1,088 | Job DTOs, runtime state, retry/cancellation, artifacts, and tests sit together. | Separate public job model from executor/runtime internals. |
| 9 | `apps/desktop/src-tauri/src/db/tests.rs` | 1,065 | Desktop DB tests cover many behaviors in one module, making focused failures harder to navigate. | Split tests by concern alongside the newly modularized DB backend. |
| 10 | `apps/desktop/src-tauri/src/git/mod.rs` | 1,046 | Git command state, graph formatting, diff/status parsing, and tests are in one module. | Split parsing/model helpers from Tauri command surface. |
| 11 | `crates/irodori-completion/src/completion.rs` | 934 | Completion logic is dense and algorithmic. | Keep unit coverage high before module splitting. |
| 12 | `apps/desktop/src-tauri/src/db/mod.rs` | 929 | Backend DB facade is now much smaller, but still owns shared state, command orchestration, and retained result-store bookkeeping. | Split shared runtime state from command orchestration next. |

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
modularized under `apps/desktop/src-tauri/src/db/`. The facade is now under
1,000 lines, but it still coordinates shared state and command-level flow.

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

## Tabular IO Split Progress

Current status: import preview, CSV schema inference, CSV-to-SQL generation, and
tabular tests moved out of `crates/irodori-io/src/tabular.rs` into
`tabular/import.rs` and `tabular/tests.rs`. The remaining `tabular.rs` file now
focuses on export encoders and shared cell/options types.

Next IO split: move each format family (`DelimitedEncoder`, `JsonEncoder`,
`SqlScriptEncoder`, optional Avro/Parquet encoders) into focused modules while
preserving the existing public re-exports from `irodori_io::tabular`.

## Repository Slimming Progress

Current status: `irodori-sql` has been extracted into
`https://github.com/hjosugi/irodori-sql` and tagged as `v0.2.23`. This workspace
now consumes it through a central `[workspace.dependencies]` Git tag instead of
keeping `crates/irodori-sql` as a workspace member. The extracted repo carries
its own README, license, CI, package metadata, history-preserving subtree split,
and release tag.

Next extraction candidates:

- `irodori-core`: good dependency direction, but wait until job runtime, command
  envelope, and local API DTOs stop moving every day.
- `packages/extension-sdk`: good public-package boundary, but split after the
  generated extension API versioning story is stable.
- `docs/site` and `samples`: split only if their release cadence diverges from
  app releases; they do not affect Rust build time materially.

Do not extract DB adapter modules yet. Their connection trait, metadata model,
permissions/edit capability contract, and per-engine test harness still change
with the desktop product, so a separate repo would add friction without shrinking
the long Tauri build.

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
