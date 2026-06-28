# AGENTS.md

## Scope

These instructions apply to the whole repository. More specific `AGENTS.md` or
`AGENTS.override.md` files may override this guidance inside subdirectories.

## Working Agreements

- Start by checking `git status --short` and preserve unrelated user changes.
- Read the smallest useful context before editing. Prefer `README.md`,
  `CONTRIBUTING.md`, `SECURITY.md`, `docs/repository-boundaries.md`, and the
  files near the requested change.
- Use `rg` or `rg --files` for searches.
- Keep changes scoped to the requested behavior and the owning module.
- Do not introduce new production dependencies, assets, copied code, generated
  blobs, or broad config changes without a clear reason.
- When a task is ambiguous or spans multiple ownership areas, use the
  `irodori-workstream-planner` skill before editing.

## Repository Map

- `apps/desktop/` is the Tauri, React, TypeScript, and Vite desktop app.
- `apps/desktop/src-tauri/` is the desktop Rust backend and Tauri command layer.
- `crates/` contains shared Rust crates for connection handling, proxying,
  completion, generation, extensions, IO, security, and server work.
- `packages/extension-sdk/` contains the TypeScript extension SDK and templates.
- `examples/extensions/` contains example extensions.
- `docs/agent-workstreams.json` is the machine-readable split for parallel
  agent work.
- `docs/extension-marketplace/`, `docs/cheatsheets/`, and
  `docs/data-source-support-status.md` are generated or app-consumed snapshots.
- `.irodori-local/` and `ref/` are local/reference areas. Treat them as
  read-only research material unless the user explicitly asks otherwise.

## Clean-Room And Licensing

- Follow `CONTRIBUTING.md` before using third-party implementations, reference
  apps, screenshots, docs, samples, themes, or generated code.
- Implement from Irodori requirements, public specifications, vendor docs, or
  license-compatible OSS with attribution.
- Do not copy proprietary, commercial-only, GPL/AGPL, source-available, or
  unclear-license implementation, assets, text, icons, theme files, snippets, or
  exact UI expression into the permissive core.
- Keep project-authored code, templates, and examples under `MIT OR 0BSD`
  unless an existing file says otherwise.

## Commands

Use the root `Makefile` first. The root is not an npm workspace; JS commands run
against `apps/desktop`.

- Setup: `make setup`
- Environment check: `make doctor`
- Rust tests: `cargo test --workspace`
- Desktop unit tests: `make desktop-test`
- Desktop Rust/TS combined loop: `make desktop-test-rust-ts`
- Type generation drift check: `make desktop-typegen-check`
- Frontend build: `make desktop-build`
- Verified desktop build: `make desktop-build-verified`
- Browser/e2e tests: `make desktop-e2e`
- Generated docs/catalog checks: `make docs-check`
- Extension manifest validation: `make extension-manifests`
- Security/license checks: `make security`
- Broad local validation: `make check`

For local JS-heavy loops, `JS_PM=bun` is allowed with Make targets, but keep npm
lockfiles as the reproducible path.

## Verification Policy

- Run the narrowest relevant check after a change, then broaden when a shared
  contract, generated file, release path, dependency, or user-facing workflow is
  touched.
- Frontend UI changes usually need a focused Vitest test or existing browser/e2e
  test plus `make desktop-build`.
- Rust command, DTO, or generated binding changes need
  `make desktop-typegen-check` and the relevant Cargo tests.
- Generated docs/catalog changes must edit source data or generators first, then
  run `make docs-check`.
- Dependency, build, release, extension, or credential-handling changes need
  `make security`.
- If a required check is too slow, unavailable, or blocked, state that clearly
  with the reason.

## Frontend Conventions

- Prefer existing components, state patterns, CSS structure, and i18n wiring.
- Keep operational UI dense, readable, and predictable. Avoid decorative
  marketing-style layouts inside the app.
- Update both English and Japanese locale entries when adding user-visible text.
- Use stable dimensions for toolbars, grids, result panes, sidebars, dialogs,
  and controls so dynamic content does not shift or overlap.
- Use existing icon libraries and component patterns instead of custom one-off
  SVGs unless the local code already does so.

## Generated Files And Boundaries

- Do not hand-edit generated Rust-to-TypeScript bindings; run
  `make desktop-typegen` or check drift with `make desktop-typegen-check`.
- Do not hand-edit generated docs snapshots without changing their source data
  or generator.
- Use `docs/repository-boundaries.md` to decide whether new durable docs belong
  here, in `irodori-docs`, in `irodori-samples`, or in the private archive.
- Connector implementation agents write in one assigned sibling
  `../irodori-extensions/{repository}/` tree. Coordinator work owns registry and
  generated catalog changes in this repository.

## Parallel Agent Workflow

- Use one git worktree or connector checkout per active implementation agent.
- Avoid two agents editing the same file set at the same time.
- Use `docs/agent-workstreams.json` to identify writable paths, read-only paths,
  shared contracts, and verification commands.
- For explicit subagent work, prefer read-only exploration/review agents first:
  `irodori-explorer`, `irodori-reviewer`, and
  `irodori-workstream-coordinator`.
- Serialize shared contract changes before downstream UI, runtime, connector, or
  docs agents consume them.

