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

There is no root npm workspace at the moment. Install Node dependencies inside
each app directory that you work on.

Recommended editor setup:

- VS Code with the Tauri extension.
- rust-analyzer.

## Quick Start: Desktop App

From the repo root:

```sh
cargo build
cd apps/desktop
npm ci
npm run tauri dev
```

`npm run tauri dev` starts the Tauri shell and the Vite dev server. The desktop
frontend dev server uses `http://localhost:1420` with `strictPort: true`, so free
that port if startup fails.

Useful desktop commands:

```sh
cd apps/desktop
npm run dev           # Vite only, useful when launching a debug binary manually
npm run typegen       # regenerate Rust -> TypeScript bindings
npm test              # Vitest
npm run build         # typegen + TypeScript + Vite production build
npm run test:e2e      # Playwright
```

To build and install a local Linux AppImage from the repo root:

```sh
make run-linux
```

## Quick Start: Web App

The web app is separate from the Tauri desktop shell.

```sh
cd apps/web
npm ci
npm run dev
```

The Vite server defaults to `http://localhost:1422`. It proxies `/api/*` to
`http://localhost:1423` for online database endpoint testing.

To run the local Postgres-backed endpoint from `apps/web`:

```sh
cd apps/web
npm run endpoint:docker
```

If your environment cannot create a compose bridge network, try:

```sh
cd apps/web
npm run endpoint:docker:host
```

More detail: [docs/web-app-architecture.md](docs/web-app-architecture.md).

## Local Checks

Common checks from a fresh checkout:

```sh
cargo test
cd apps/desktop && npm test && npm run build
cd apps/web && npm test && npm run build
```

Database integration checks use one compose file per engine under `samples/`:

```sh
scripts/verify-db.sh postgres
scripts/verify-db.sh all
scripts/verify-db.sh up postgres
scripts/verify-db.sh down postgres
```

More detail: [samples/README.md](samples/README.md).

## Repo Map

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Main Tauri + React desktop application. |
| `apps/desktop/src-tauri/` | Rust backend for the desktop app, including DB adapters and Tauri commands. |
| `apps/web/` | Browser-only Vite/React app with local SQLite/DuckDB and HTTP endpoint support. |
| `crates/` | Shared Rust crates for core models, data sources, SQL, completion, extension APIs, IO, server, i18n, and knowledge tooling. |
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
  `http://localhost:1420`. Use `npm run tauri dev`, or start `npm run dev` before
  launching the binary manually.
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
