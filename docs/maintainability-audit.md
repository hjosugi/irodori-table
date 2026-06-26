# Maintainability Audit

Snapshot date: 2026-06-26.

This audit summarizes the current line-count and complexity hotspots in the
first-party code. The counts below exclude generated files, dependencies,
`target/`, `ref/`, and static site build assets. Complexity values are approximate:
TypeScript/TSX was scanned with the local TypeScript parser, while Rust was
checked with a rough token pass because the repo does not yet have a committed
complexity tool.

## Top Oversized Files

| Rank | File | Lines | Main risk | Suggested next move |
| ---: | --- | ---: | --- | --- |
| 1 | `apps/desktop/src/App.tsx` | 4,320 | React shell owns query execution, result-grid state, connection actions, settings JSON, keybindings, ERD/import/export, and modal orchestration. `App()` is about 3,789 lines with approximate complexity 456. | Continue extracting feature controllers/hooks until `App.tsx` is mostly composition. |
| 2 | `apps/desktop/src-tauri/src/db.rs` | 4,149 | Backend DB facade mixes DTOs, state, dispatch, stream/spill handling, metadata conversion, command wrappers, and tests. | Split by command surface and shared runtime state after current DB work stabilizes. |
| 3 | `crates/irodori-io/src/lib.rs` | 1,896 | Export encoders, import preview, schema inference, and tests share one module. | Move format-specific encoders/importers into submodules. |
| 4 | `crates/irodori-proxy/src/lib.rs` | 1,786 | Transport planning, auth resolution, handshakes, stream forwarding, and tests are tightly packed. | Separate planning/diagnostics from IO handshakes and forwarder runtime. |
| 5 | `apps/desktop/src/sql/completion.ts` | 1,567 | Completion scanning, parsing helpers, and suggestion ranking are hard to review as one file. | Keep parser/scanner, metadata ranking, and UI-facing conversion in separate modules. |
| 6 | `crates/irodori-core/src/connection.rs` | 1,364 | Connection profile schemas and validation cover many transport/auth variants. | Split transport/auth/portable model sections once external shape is stable. |
| 7 | `apps/desktop/src/styles/results.css` | 1,318 | Result-grid, editing, detail, and mode-specific styles are coupled. | Split by results subcomponent after component extraction lands. |
| 8 | `apps/desktop/src/theme.ts` | 1,123 | Theme conversion and TextMate scope mapping are broad; `syntaxRolesForTextMateScope` is a complexity hotspot. | Isolate VS Code import normalization and syntax-role mapping. |
| 9 | `apps/desktop/src/styles/workbench.css` | 1,089 | Workbench layout, chrome, panes, and responsive rules share one stylesheet. | Split along `WorkbenchShell`, sidebar, inspector, and layout concerns. |
| 10 | `crates/irodori-core/src/jobs.rs` | 1,088 | Job DTOs, runtime state, retry/cancellation, artifacts, and tests sit together. | Separate public job model from executor/runtime internals. |
| 11 | `apps/desktop/src/features/settings/SettingsDialog.tsx` | 989 | The dialog is already extracted but still has many tabs and high branch count. | Split tabs into local child components after `App.tsx` stops owning settings JSON parsing. |
| 12 | `crates/irodori-completion/src/completion.rs` | 934 | Completion logic is dense and algorithmic. | Keep unit coverage high before module splitting. |

## App.tsx Split Plan

Goal: make `App.tsx` a composition root under roughly 800-1,000 lines, with
feature behavior living beside the existing feature modules.

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
