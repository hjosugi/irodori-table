# Irodori Table

Irodori Table is a permissively licensed database client project. The main app is
a Tauri desktop client built with Rust, React, TypeScript, and Vite. The repo
also contains shared Rust crates, extension SDK work, database sample
containers, and planning docs.

Some reusable foundations are intentionally split out like standalone products:

- `typeship` lives in [`hjosugi/typebridge`](https://github.com/hjosugi/typebridge)
  and is consumed from crates.io for Rust-to-TypeScript boundary generation.
- `irodori-sql` lives in [`hjosugi/irodori-sql`](https://github.com/hjosugi/irodori-sql)
  and is consumed from the `v0.2.24` Git tag for SQL dialect, parameter,
  metamodel, and schema-diff helpers.

Application UX stays here unless it has a stable standalone contract. BI panels,
ERD layout, query editor behavior, movable sidebars, connection UI, and result
grid interactions belong to `apps/desktop`; `typeship` stays focused on reusable
Rust/TypeScript API generation and drift checks.

This root README is the starting point when you do not know which document to
read first.

## Start Here

1. Read this file for the repo map and first setup commands.
2. For Linux desktop setup and WebKit/Tauri troubleshooting, read
   [linux-development](https://hjosugi.github.io/irodori-docs/linux-development.html).
3. For what databases work today, read
   [docs/data-source-support-status.md](docs/data-source-support-status.md).
4. For product direction, read [ROADMAP.md](ROADMAP.md).
5. For implementation architecture, read
   [docs/implementation-architecture.md](docs/implementation-architecture.md).
6. For contribution rules, especially clean-room and licensing rules, read
   [CONTRIBUTING.md](CONTRIBUTING.md).

## Prerequisites

- Rust and Cargo.
- Node.js and npm.
- Bun is optional for faster local JavaScript script loops.
- Tauri v2 system dependencies for your OS.
- Docker or Podman if you want to run sample databases.

On Arch Linux / CachyOS, the desktop app needs the Tauri/WebKit packages listed
in [linux-development](https://hjosugi.github.io/irodori-docs/linux-development.html):

```sh
sudo pacman -S --needed base-devel webkit2gtk-4.1 libsoup3 openssl
```

Optional AppImage runtime support on Arch-based systems:

```sh
sudo pacman -S --needed fuse2
```

Use the root `Makefile` for day-to-day commands. There is still no root npm
workspace; the root targets run against the desktop app directly.

```sh
make help
make setup
make doctor
make security
```

The default JavaScript package manager is npm because CI, release automation,
and committed lockfiles are npm-based. For local JS-heavy loops, Bun can run the
same Make targets without changing lockfiles:

```sh
make desktop-test JS_PM=bun
make test JS_PM=bun
make desktop-vite JS_PM=bun
```

If you want Bun to install local dependencies without writing Bun lockfiles, use
`make setup-fast`. Keep `make setup` as the reproducible path before release or
CI-equivalent checks.

Recommended editor setup:

- VS Code with the Tauri extension.
- rust-analyzer.

Security workflow notes are in [SECURITY.md](SECURITY.md) and
[development-security](https://hjosugi.github.io/irodori-docs/development-security.html).

## Quick Start: Desktop App

From the repo root:

```sh
make setup-desktop
make desktop-dev
```

`make desktop-dev` starts the Tauri shell and the Vite dev server. The desktop
frontend dev server uses `http://localhost:1420` with `strictPort: true`, so
free that port if startup fails.

Useful desktop commands:

```sh
make desktop-vite     # Vite only, useful when launching a debug binary manually
make desktop-typegen  # regenerate Rust -> TypeScript bindings
make desktop-test     # Vitest
make desktop-build    # TypeScript + Vite production build (fast, no Rust typegen)
make desktop-build-verified # typegen drift check + TypeScript + Vite build
make desktop-e2e      # Playwright
```

`desktop-build` intentionally skips Rust type generation so everyday frontend
builds stay fast. Run `make desktop-typegen-check` or `make
desktop-build-verified` before release-style validation; CI enforces the same
generated-binding drift check.

The desktop frontend builds with React Compiler through Vite's Babel pipeline by
default. To isolate a compiler-related rendering issue while developing, disable
it for one command:

```sh
IRODORI_REACT_COMPILER=0 make desktop-vite
```

To build and install a local Linux AppImage from the repo root:

```sh
make run-linux
```

## Sample Databases

Sample databases live under `samples/<engine>/compose.yaml`. They are for the
desktop app, Rust integration tests, and manual connection testing. The harness
chooses Podman when available, otherwise Docker; override with
`ENGINE_BIN=docker` or `ENGINE_BIN=podman`.

Start one database and keep it running:

```sh
make db-up DB=postgres
```

That prints the env var and DSN used by the Rust tests, for example
`export IRODORI_PG_URL="postgres://irodori:irodori@127.0.0.1:55432/samples"`.
Use the same DSN in the desktop connection dialog when testing manually.

Run the connection/query integration test for one database, then stop it:

```sh
make db-verify DB=postgres
```

Run the normal bootable set:

```sh
make db-all
```

Stop a database that was started with `db-up`:

```sh
make db-down DB=postgres
```

Common `DB` values are `postgres`, `mysql`, `mariadb`, `timescaledb`,
`cockroachdb`, `yugabytedb`, `tidb`, `sqlserver`, `mongodb`, and `oracle`.
SQLite and DuckDB are embedded and do not need containers. Redshift is
cloud-only. More detail: [samples/README.md](samples/README.md).

## Local Checks

Common checks from a fresh checkout:

```sh
make check
```

## Repo Map

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Main Tauri + React desktop application. |
| `apps/desktop/src-tauri/` | Rust backend for the desktop app, including DB adapters and Tauri commands. |
| `crates/` | Shared Rust crates for core models, SQL/completion, proxy/secret handling, extension APIs, IO, server, and knowledge tooling. |
| `packages/extension-sdk/` | TypeScript extension SDK package. |
| `packages/extension-sdk/templates/` | Starter templates for extension authors. |
| `examples/extensions/` | Example extensions. |
| `samples/` | Per-engine database compose files and sample schemas. |
| `scripts/` | Developer scripts for DB verification and local seeded DBs. |
| `tools/security/` | Local security automation config used by `make security`. |
| `tools/knowledge/` | Local knowledge-base refresh, analysis, query, and cheatsheet generation tools. |
| `knowledge/` | Tracked schema/source registry for the generated local knowledge database. |
| `docs/site/` | Static project site published by GitHub Pages. |
| `docs/` | Architecture, status, planning, licensing, and runbook documents. |
| `.irodori-local/ref/` | Optional local reference projects for clean-room research. Do not copy code from here unless license compatibility and attribution are explicit. |

## Important Docs

| Need | Read |
| --- | --- |
| Implementation architecture and module boundaries | [docs/implementation-architecture.md](docs/implementation-architecture.md) |
| Migration planning, row-hash validation, and data diff design | [docs/data-verification-diff.md](docs/data-verification-diff.md) |
| Linux setup, WebKit crashes, blank Tauri window | [linux-development](https://hjosugi.github.io/irodori-docs/linux-development.html) |
| Supported vs planned database engines | [docs/data-source-support-status.md](docs/data-source-support-status.md) |
| Connection syntax and engine quirks | [engine-syntax-reference](https://hjosugi.github.io/irodori-docs/engine-syntax-reference.html) |
| Sample database containers | [samples/README.md](samples/README.md) |
| Product capability matrix | [feature-matrix](https://hjosugi.github.io/irodori-docs/feature-matrix.html) |
| Current implementation snapshot | [implementation-progress](https://hjosugi.github.io/irodori-docs/implementation-progress.html) |
| Backlog and task IDs | [implementation-backlog](https://hjosugi.github.io/irodori-docs/implementation-backlog.html) |
| UI language switching and translation keys | [i18n](https://hjosugi.github.io/irodori-docs/i18n.html) |
| Release-readiness checklist | [production-readiness](https://hjosugi.github.io/irodori-docs/production-readiness.html) |
| Maintainability audit | [maintainability-audit](https://hjosugi.github.io/irodori-docs/maintainability-audit.html) |
| Extension development | [extension-development](https://hjosugi.github.io/irodori-docs/extension-development.html) and [packages/extension-sdk/README.md](packages/extension-sdk/README.md) |
| Clean-room rules | [clean-room](https://hjosugi.github.io/irodori-docs/clean-room.html) |
| License policy | [licensing](https://hjosugi.github.io/irodori-docs/licensing.html) |
| Local knowledge base | [knowledge-base](https://hjosugi.github.io/irodori-docs/knowledge-base.html) |

## Common Gotchas

- A debug desktop binary launched by itself expects Vite on
  `http://localhost:1420`. Use `make desktop-dev`, or start
  `make desktop-vite` before launching the binary manually.
- If the Tauri window is blank on Linux, check
  [linux-development](https://hjosugi.github.io/irodori-docs/linux-development.html) for WebKit DMA-BUF,
  compositing, and Wayland/X11 workarounds.
- DuckDB's bundled build can be heavy because it compiles libduckdb. Link a
  system or prebuilt libduckdb if this becomes slow for your machine.
- The sample DB scripts choose Podman when available, otherwise Docker. Override
  with `ENGINE_BIN=docker` or `ENGINE_BIN=podman` when needed.

## License

Project-authored code, official examples, and official templates are licensed
under `MIT OR 0BSD` by default. See [LICENSE](LICENSE) and
[licensing](https://hjosugi.github.io/irodori-docs/licensing.html).
