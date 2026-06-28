# Documentation

Most durable Irodori Table documentation lives in its own repository, published
as an mdBook:

- **Online:** <https://hjosugi.github.io/irodori-docs/>
- **Markdown source:** <https://github.com/hjosugi/irodori-docs> (under `src/`)
- **PDF:** open the book and use the print icon → *Save as PDF*

This repo keeps only documents that are tied directly to the app source tree,
generated from this repo, or needed by the static project site. The detailed
placement/archive rules are in
[repository-boundaries.md](repository-boundaries.md).

## Local Source-Of-Truth Docs

These are intentionally kept next to the code because they describe current
implementation shape or are edited while changing this repo:

- [implementation-architecture.md](implementation-architecture.md) — current
  codebase map, module boundaries, Tauri/API flow, and implementation diagrams.
- [roadmap-1.0.md](roadmap-1.0.md) — what's required for a 1.0 release (scope,
  P0/P1, deferrals).
- [distribution.md](distribution.md) — download/update channels (GitHub Releases,
  Tauri updater, cargo, package managers) and their status.
- [store-registration.md](store-registration.md) — public app-store and
  package-manager listing metadata, support/privacy/disclaimer URLs, and
  submission checklists.
- [support.md](support.md), [privacy.md](privacy.md), and
  [disclaimer.md](disclaimer.md) — public text mirrored into the static project
  site for store submissions.
- [ai-local-sql-generation.md](ai-local-sql-generation.md) — local,
  grammar-constrained NL→SQL generation + pluggable model providers.
- [data-verification-diff.md](data-verification-diff.md) — current migration
  planner, row-hash/diff SQL, selected-row repair SQL, and the target
  high-scale data-diff architecture.
- [integrated-terminal.md](integrated-terminal.md) — the PTY-backed xterm.js
  terminal panel.
- [headless-data-api.md](headless-data-api.md) — the optional local HTTP data API
  (`irodori-server`).
- [query-plan-explorer.md](query-plan-explorer.md) — execution-plan UI and
  analysis model notes for the desktop feature.

## Generated Or Mirrored Here

These reference pages are produced from this repo's tooling and mirrored into
irodori-docs; edit the generators, not the output:

- [data-source-support-status.md](data-source-support-status.md) — engine support
  matrix (`tools/docs/support-status.mjs`)
- [cheatsheets/](cheatsheets/) — per-engine cheatsheets
  (`tools/knowledge/cheatsheet.mjs`)
- [extension-marketplace/](extension-marketplace/) — extension catalog JSON
  consumed by the desktop app and generated/validated by `tools/docs/*`.

The static project site (landing page, blog) stays under [site/](site/) and is
deployed by `.github/workflows/pages.yml`.

## External Repositories

| Repository | Purpose |
| --- | --- |
| [`hjosugi/irodori-docs`](https://github.com/hjosugi/irodori-docs) | Public mdBook for stable user/contributor docs, policies, reference pages, and ADR-style material. |
| [`hjosugi/irodori-samples`](https://github.com/hjosugi/irodori-samples) | DB compose fixtures, seed SQL/JS, and feature sample query projects. This repo reads it as a sibling checkout or via `IRODORI_SAMPLES`. |
| `irodori-archive` (private) | Historical/internal planning, status snapshots, audits, and research notes that should not live in the public app repo. |

## Cleanup Rules

- If a doc is stable, public-facing, and not generated from this repo, move it to
  `irodori-docs`.
- If a doc is generated from code, registry data, or local knowledge tools, keep
  the generated snapshot here and mirror it outward.
- If a doc is historical/internal/research-only, archive it in private
  `irodori-archive`; leave only a short public replacement or index entry when
  needed.
- Do not add new long-lived planning/status pages here unless they are directly
  tied to source changes in this repo.
