# Contributing

Irodori Table is built as a permissive, clean-room desktop app. Contributions
should stay easy for downstream users to copy, fork, embed, or compete with
under `MIT OR 0BSD`.

## Quick Start

```sh
make doctor
make setup
make desktop-dev
```

The root is not an npm workspace. Run JavaScript commands through the root
`Makefile` or with `npm --prefix apps/desktop ...`.

## Required Tooling

Required local versions are pinned in `.nvmrc`, `rust-toolchain.toml`, and
`apps/desktop/package.json`.

- Use npm for reproducible installs. `JS_PM=bun` is allowed for local loops, but
  do not replace the committed npm lockfile.
- Linux desktop build prerequisites are documented in
  <https://hjosugi.github.io/irodori-docs/linux-development.html>.

Run `make doctor` after installing tools. It checks the pinned Node/Rust
versions, Linux desktop prerequisites, Playwright readiness, sample/kit sibling
checkouts, temp-directory capacity, and local Cargo patch leakage.

## Linux Notes

Linux package lists, build temp-directory workarounds, and desktop runtime
troubleshooting are maintained in
<https://hjosugi.github.io/irodori-docs/linux-development.html>.

## Repo Boundaries

The public boundary policy is
<https://hjosugi.github.io/irodori-docs/repository-boundaries.html>.

- `irodori-table`: desktop app, app-local tooling, generated snapshots consumed
  by the app or CI.
- `irodori-kit`: shared foundation crates, extension SDK, and packaging
  templates.
- `irodori-sql` and `irodori-knowledge`: reusable shared crates consumed by git
  tag.
- `irodori-samples`: sample database containers and seed data.
- `irodori-docs`: durable public docs, policy pages, feature matrix, and
  backlog/progress pages.

Keep generated snapshots paired with their source data or generator. Do not
hand-edit generated output alone.

## Clean-Room Rules

Read and follow
<https://hjosugi.github.io/irodori-docs/clean-room.html> before using any
reference product, repository, docs, issue, screenshot, icon, theme, snippet, or
sample code for implementation work.

The short version:

- Implement from Irodori requirements, public specifications, vendor docs, or
  license-compatible OSS with attribution.
- Do not copy proprietary, commercial-only, GPL/AGPL, source-available, or
  unclear-license implementation into the permissive core.
- Record public references and code-level OSS influences in the PR when they
  affected the implementation.

## Local Checks

Choose the narrowest check that covers your change, then broaden when shared
contracts, release paths, generated files, or user-facing workflows are touched.

| Change | Run |
| --- | --- |
| Frontend TypeScript/React | `make desktop-format-check`, `make desktop-lint`, `make desktop-test` |
| Frontend build or release path | `make desktop-build-verified` |
| Rust backend or Tauri command payloads | `cargo test --workspace`, `make desktop-typegen-check` |
| Generated registry/docs snapshots | edit the source/generator, then `make docs-check` |
| Extension manifests/templates | `make extension-manifests` |
| Browser behavior | `cd apps/desktop && npx playwright install --with-deps chromium`, then `make desktop-e2e` |
| Dependency, build, CI, release, or credential handling | `make security` |
| Broad pre-PR confidence | `make check` |

Formatting and linting use Oxc-family tooling for the desktop app:

```sh
make desktop-format-check
make desktop-lint
```

## Cross-Repo Development

The app consumes sibling foundation crates by git tag. For local co-development
against `irodori-kit`, clone the sibling repo and add a temporary Cargo patch:

```sh
git clone https://github.com/hjosugi/irodori-kit ../irodori-kit
make kit-link
```

Before committing, remove the local patch and verify it is gone:

```sh
make kit-unlink
make kit-patch-check
```

`make extension-manifests` validates the extension SDK templates when
`../irodori-kit/packages/extension-sdk` or `irodori-kit/packages/extension-sdk`
is present. In CI, missing SDK checkout is a failure.

Sample databases live in the sibling samples repo:

```sh
git clone https://github.com/hjosugi/irodori-samples ../irodori-samples
make db-up DB=postgres
make db-verify DB=postgres
```

## Issue And PR Intake

Good first contributions should be small, single-area, and independently
verifiable: docs fixes, focused UI polish, small unit-test gaps, connector
metadata corrections, and doctor/check improvements are good fits. Avoid using a
good-first issue for shared contract changes, generated binding changes, release
automation, or connector ABI work.

Use the bug, feature, or backlog-mirror issue templates. For PRs, keep the
clean-room checklist filled in. If a change is influenced by third-party OSS
code, name the source, license, files or APIs reviewed, and what was adapted.

Example PR body:

```md
## Summary

- Add dialect-aware identifier quoting for generated edit statements.
- Keep statement generation independent and covered by unit tests.

## Verification

- cargo test -p irodori-table-desktop edit::tests
- scripts/check-licenses.sh
```

## Licensing

Project-authored code, official examples, and official templates use
`MIT OR 0BSD` by default. Asset and dependency rules are documented at
<https://hjosugi.github.io/irodori-docs/licensing.html>.
