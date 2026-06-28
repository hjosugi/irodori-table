# Repository Boundaries And Archive Policy

This file is the public, repo-local version of the Irodori documentation layout.
Use it when deciding whether a document belongs in `irodori-table`, the public
mdBook, a samples repo, or the private archive.

## Repositories

| Repository | Visibility | Owns |
| --- | --- | --- |
| `irodori-table` | Public | Desktop app, app-local crates, extension SDK, local knowledge tools, static project site, and generated docs consumed by the app. |
| `irodori-docs` | Public | Durable user/contributor docs, policy pages, reference pages, feature matrix, backlog/progress views, ADR-style docs, and public long-form explanations. |
| `irodori-samples` | Public | Database compose files, seed data, and DB-specific sample query projects. |
| `irodori-sql` | Public | Reusable SQL dialect, placeholder, metamodel, and schema-diff helpers. |
| `irodori-knowledge` | Public | Shared error/job/knowledge crates used by this workspace. |
| `irodori-archive` | Private | Historical internal planning/status snapshots, audits, private research notes, bulky discarded docs, and material that should not be public. |

## What Stays In `irodori-table`

- Root project entry points: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `ROADMAP.md`.
- Implementation maps that must be edited with source changes, such as
  `docs/implementation-architecture.md`.
- Feature notes that describe code currently in this repo and are useful during
  implementation, such as query plan analysis, local SQL generation, terminal,
  data diff, and headless API notes.
- Generated snapshots that are consumed by tooling or the desktop app:
  `docs/data-source-support-status.md`, `docs/cheatsheets/`, and
  `docs/extension-marketplace/*.json`.
- `docs/site/`, which is the project landing/blog site. This is not the mdBook.

## What Moves To `irodori-docs`

- Stable user guides and contributor guides.
- Policy pages: clean-room, licensing, security process, release process.
- Reference pages that should have durable public URLs.
- Feature matrix, implementation progress, backlog, and release-readiness pages.
- ADR-style decisions that explain why the system is shaped a certain way.

When a page is moved out, keep a local link from `docs/README.md` only if a code
workflow still needs to discover it from this repository.

## What Moves To `irodori-samples`

- `compose.yaml`, seed SQL/JS, and per-engine fixture data.
- DB-specific sample query projects under `projects/<engine>/`.
- `db-feature-samples.json` and sample catalog data.

This repo expects the samples repo as a sibling checkout by default:

```sh
git clone https://github.com/hjosugi/irodori-samples ../irodori-samples
```

Override the location with `IRODORI_SAMPLES=/path/to/irodori-samples`.

## What Moves To `irodori-archive`

Archive instead of deleting when the material has historical value but is not a
current public contract:

- superseded implementation plans;
- one-off status reports and audit dumps;
- raw product/research notes;
- internal screenshots or bulky generated exports;
- private planning context that should not be published;
- old docs that confuse current source-of-truth ownership.

Do not link private archive paths from public docs. If public context is needed,
write a short replacement summary in `irodori-docs` or this repo.

## Generated-Doc Flow

Generated docs are edited at their inputs:

| Output | Edit Instead |
| --- | --- |
| `docs/data-source-support-status.md` | `knowledge/engines.json`, `docs/extension-marketplace/*.json`, `tools/docs/support-status.mjs` |
| `docs/cheatsheets/*.md` | `knowledge/cheatsheets/*.json`, the knowledge DB, `tools/knowledge/cheatsheet.mjs` |
| `docs/extension-marketplace/catalog.json` | `docs/extension-marketplace/index.json`, `tools/docs/build-extension-catalog.mjs` |

Generated snapshots can be mirrored into `irodori-docs`, but the generator and
app-consumed source stay in `irodori-table`.

## Decision Checklist

Before adding a new document, answer:

1. Does app code or tooling consume it? Keep it here.
2. Is it stable public documentation? Put it in `irodori-docs`.
3. Is it a DB fixture or sample query catalog? Put it in `irodori-samples`.
4. Is it historical/private/internal? Put it in `irodori-archive`.
5. Is it generated? Edit the generator or source data, not the output.
