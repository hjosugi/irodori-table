# Irodori Table

Irodori Table is a permissively licensed database client project. The main app is
a Tauri desktop client built with Rust, React, TypeScript, and Vite. The repo
also contains a browser-only web app, shared Rust crates, extension SDK work,
database sample containers, and planning docs.

This root README is the starting point when you do not know which document to
read first.

## Start Here

1. Read this file for the repo map and first setup commands.
2. For Linux desktop setup and WebKit/Tauri troubleshooting, read
   [docs/linux-development.md](docs/linux-development.md).
3. For what databases work today, read
   [docs/data-source-support-status.md](docs/data-source-support-status.md).
4. For product direction, read [ROADMAP.md](ROADMAP.md).
5. For contribution rules, especially clean-room and licensing rules, read
   [CONTRIBUTING.md](CONTRIBUTING.md).

## Prerequisites

- Rust and Cargo.
- Node.js and npm.
- Bun is optional for faster local JavaScript script loops.
- Tauri v2 system dependencies for your OS.
- Docker or Podman if you want to run sample databases.

On Arch Linux / CachyOS, the desktop app needs the Tauri/WebKit packages listed
in [docs/linux-development.md](docs/linux-development.md):

```sh
sudo pacman -S --needed base-devel webkit2gtk-4.1 libsoup3 openssl
```

Optional AppImage runtime support on Arch-based systems:

```sh
sudo pacman -S --needed fuse2
```

Use the root `Makefile` for day-to-day commands. There is still no root npm
workspace; the root targets run against each app directly.

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
[docs/development-security.md](docs/development-security.md).

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
make desktop-build    # typegen + TypeScript + Vite production build
make desktop-e2e      # Playwright
```

To build and install a local Linux AppImage from the repo root:

```sh
make run-linux
```

## Quick Start: Web App

The web app is separate from the Tauri desktop shell.

```sh
make setup-web
make web-dev
```

The Vite server defaults to `http://localhost:1422`. It proxies `/api/*` to
`http://localhost:1423` for online database endpoint testing.

To run the local Postgres-backed endpoint for the web app, use a second
terminal:

```sh
make web-endpoint
```

If your environment cannot create a compose bridge network, try:

```sh
make web-endpoint-host
```

Stop the endpoint stack with `make web-endpoint-down`.

More detail: [docs/web-app-architecture.md](docs/web-app-architecture.md).

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
| `apps/web/` | Browser-only Vite/React app with local SQLite/DuckDB and HTTP endpoint support. |
| `crates/` | Shared Rust crates for core models, SQL/completion, proxy/secret handling, extension APIs, IO, server, and knowledge tooling. |
| `packages/extension-sdk/` | TypeScript extension SDK package. |
| `templates/extensions/` | Starter templates for extension authors. |
| `examples/extensions/` | Example extensions. |
| `samples/` | Per-engine database compose files and sample schemas. |
| `scripts/` | Developer scripts for DB verification and local seeded DBs. |
| `tools/knowledge/` | Local knowledge-base refresh, analysis, query, and cheatsheet generation tools. |
| `knowledge/` | Tracked schema/source registry for the generated local knowledge database. |
| `docs/` | Architecture, status, planning, licensing, and runbook documents. |
| `ref/` | Reference projects for clean-room research. Do not copy code from here unless license compatibility and attribution are explicit. |

## Important Docs

| Need | Read |
| --- | --- |
| Linux setup, WebKit crashes, blank Tauri window | [docs/linux-development.md](docs/linux-development.md) |
| Supported vs planned database engines | [docs/data-source-support-status.md](docs/data-source-support-status.md) |
| Connection syntax and engine quirks | [docs/engine-syntax-reference.md](docs/engine-syntax-reference.md) |
| Web app runtime and endpoint contract | [docs/web-app-architecture.md](docs/web-app-architecture.md) |
| Sample database containers | [samples/README.md](samples/README.md) |
| Product capability matrix | [docs/feature-matrix.md](docs/feature-matrix.md) |
| Current implementation snapshot | [docs/implementation-progress.md](docs/implementation-progress.md) |
| Backlog and task IDs | [docs/implementation-backlog.md](docs/implementation-backlog.md) |
| Release-readiness checklist | [docs/production-readiness.md](docs/production-readiness.md) |
| Extension development | [docs/extension-development.md](docs/extension-development.md) and [packages/extension-sdk/README.md](packages/extension-sdk/README.md) |
| Clean-room rules | [docs/clean-room.md](docs/clean-room.md) |
| License policy | [docs/licensing.md](docs/licensing.md) |
| Local knowledge base | [docs/knowledge-base.md](docs/knowledge-base.md) |

## Common Gotchas

- A debug desktop binary launched by itself expects Vite on
  `http://localhost:1420`. Use `make desktop-dev`, or start
  `make desktop-vite` before launching the binary manually.
- If the Tauri window is blank on Linux, check
  [docs/linux-development.md](docs/linux-development.md) for WebKit DMA-BUF,
  compositing, and Wayland/X11 workarounds.
- DuckDB's bundled build can be heavy because it compiles libduckdb. Link a
  system or prebuilt libduckdb if this becomes slow for your machine.
- The sample DB scripts choose Podman when available, otherwise Docker. Override
  with `ENGINE_BIN=docker` or `ENGINE_BIN=podman` when needed.

## License

Project-authored code, official examples, and official templates are licensed
under `MIT OR 0BSD` by default. See [LICENSE](LICENSE) and
[docs/licensing.md](docs/licensing.md).
