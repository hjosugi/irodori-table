# Documentation

Most durable Irodori Table documentation lives in its own repository, published
as an mdBook:

- **Online:** <https://hjosugi.github.io/irodori-docs/>
- **Markdown source:** <https://github.com/hjosugi/irodori-docs> (under `src/`)
- **PDF:** open the book and use the print icon → *Save as PDF*

This repo keeps only documents that are generated from this repo, consumed by
the desktop app/CI, or needed as a short local pointer. Public site pages and
durable feature docs live in `irodori-docs`. The detailed placement/archive rules
are in [repository boundaries](https://hjosugi.github.io/irodori-docs/repository-boundaries.html).

## Public Docs Moved To `irodori-docs`

Use the mdBook source for stable, reader-facing documentation:

- [Implementation architecture](https://hjosugi.github.io/irodori-docs/implementation-architecture.html)
- [Parallel agent architecture](https://hjosugi.github.io/irodori-docs/parallel-agent-architecture.html)
- [Path to 1.0](https://hjosugi.github.io/irodori-docs/roadmap-1.0.html)
- [Distribution and updates](https://hjosugi.github.io/irodori-docs/distribution.html)
- [Store and package registration](https://hjosugi.github.io/irodori-docs/store-registration.html)
- [Support](https://hjosugi.github.io/irodori-docs/support.html),
  [privacy](https://hjosugi.github.io/irodori-docs/privacy.html), and
  [disclaimer](https://hjosugi.github.io/irodori-docs/disclaimer.html)
- [Local SQL generation](https://hjosugi.github.io/irodori-docs/ai-local-sql-generation.html)
- [Data verification diff](https://hjosugi.github.io/irodori-docs/data-verification-diff.html)
- [Integrated terminal](https://hjosugi.github.io/irodori-docs/integrated-terminal.html)
- [Headless local data API](https://hjosugi.github.io/irodori-docs/headless-data-api.html)
- [Query plan explorer](https://hjosugi.github.io/irodori-docs/query-plan-explorer.html)

## Generated Or Mirrored Here

These reference pages are produced from this repo's tooling. The public mdBook
copy lives in `irodori-docs`; keep only snapshots here when table-repo tooling or
CI needs them:

- [data-source-support-status.md](data-source-support-status.md) — engine support
  matrix (`tools/docs/support-status.mjs`)
- [cheatsheets/](cheatsheets/) — repo-local generator snapshots for selected
  per-engine cheatsheets (`tools/knowledge/cheatsheet.mjs`)
- [extension-marketplace/](extension-marketplace/) — extension catalog JSON
  consumed by the desktop app and generated/validated by `tools/docs/*`.
- [agent-workstreams.json](agent-workstreams.json) — machine-readable
  workstream ownership for parallel agent development
  (`tools/docs/agent-workstreams.mjs`).

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
  it here only when a table-repo tool or CI check consumes it; mirror the public
  reader-facing copy into `irodori-docs`.
- If a doc is historical/internal/research-only, archive it in private
  `irodori-archive`; leave only a short public replacement or index entry when
  needed.
- Do not add new long-lived planning/status pages here unless they are directly
  tied to source changes in this repo.
