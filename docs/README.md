# Documentation

The Irodori Table documentation now lives in its own repository, published as an
mdBook:

- **Online:** <https://hjosugi.github.io/irodori-docs/>
- **Markdown source:** <https://github.com/hjosugi/irodori-docs> (under `src/`)
- **PDF:** open the book and use the print icon → *Save as PDF*

## Still local in this repo

**Architecture & planning**

- [implementation-architecture.md](implementation-architecture.md) — current
  codebase map, module boundaries, Tauri/API flow, and implementation diagrams.
- [roadmap-1.0.md](roadmap-1.0.md) — what's required for a 1.0 release (scope,
  P0/P1, deferrals).
- [distribution.md](distribution.md) — download/update channels (GitHub Releases,
  Tauri updater, cargo, package managers) and their status.

**Feature notes** (subsystems built in this repo)

- [ai-local-sql-generation.md](ai-local-sql-generation.md) — local,
  grammar-constrained NL→SQL generation + pluggable model providers.
- [integrated-terminal.md](integrated-terminal.md) — the PTY-backed xterm.js
  terminal panel.
- [headless-data-api.md](headless-data-api.md) — the optional local HTTP data API
  (`irodori-server`).

## Still generated in this repo

These reference pages are produced from this repo's tooling and mirrored into
irodori-docs; edit the generators, not the output:

- [data-source-support-status.md](data-source-support-status.md) — engine support
  matrix (`tools/docs/support-status.mjs`)
- [cheatsheets/](cheatsheets/) — per-engine cheatsheets
  (`tools/knowledge/cheatsheet.mjs`)

The static project site (landing page, blog) stays under [site/](site/) and is
deployed by `.github/workflows/pages.yml`.
