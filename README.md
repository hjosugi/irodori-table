# Irodori Table

Fast desktop database client for querying, browsing, editing, diagramming, and
checking data across many engines.

## Preview

![Irodori Table workbench preview](docs/assets/irodori-table-preview.png)

## Install

Use the public install guide for the current desktop downloads and
OS-specific install paths:

<https://hjosugi.github.io/irodori-docs/install-guide.html>

Release assets are published from GitHub Releases:

<https://github.com/hjosugi/irodori-table/releases>

## Develop

### 5-Minute Quickstart

1. Install the platform prerequisites for your OS:
   [Windows](https://hjosugi.github.io/irodori-docs/windows-development.html),
   [macOS](https://hjosugi.github.io/irodori-docs/macos-development.html), or
   [Linux](https://hjosugi.github.io/irodori-docs/linux-development.html).
   Linux users should install the WebKitGTK and linker packages from that guide
   before running the desktop app.
2. From the repository root, install dependencies and check the local setup:

   ```sh
   make setup
   make doctor
   ```

3. Start the desktop development shell:

   ```sh
   make desktop-dev
   ```

`make desktop-dev` starts the Tauri shell and Vite dev server. Run `make help`
for the full list of root commands.

Contributor setup, troubleshooting, and deeper development notes live in the
project docs:

- [Contributing](CONTRIBUTING.md)
- [Windows development](https://hjosugi.github.io/irodori-docs/windows-development.html)
- [macOS development](https://hjosugi.github.io/irodori-docs/macos-development.html)
- [Linux development](https://hjosugi.github.io/irodori-docs/linux-development.html)
- [Extension development](https://hjosugi.github.io/irodori-docs/extension-development.html)

## Repos

- `irodori-table`: desktop app.
- `irodori-kit`: shared app foundation crates and extension SDK.
- `irodori-sql`: SQL dialect, parameter, schema, and migration SQL helpers.
- `irodori-knowledge`: shared error, job, and knowledge-store primitives.
- `irodori-migration`: execution-free migration planning and diff crate.
- `irodori-samples`: local sample database containers.
- `irodori-docs`: public documentation site.
- `irodori-archive`: historical internal notes.

## Links

- Docs: <https://hjosugi.github.io/irodori-docs/>
- Install guide: <https://hjosugi.github.io/irodori-docs/install-guide.html>
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Releasing: [RELEASING.md](RELEASING.md)
- Security: [SECURITY.md](SECURITY.md)
- Code of Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

License: `MIT OR 0BSD`.

## License

0BSD. You can use, copy, modify, and distribute this project for almost any purpose.
