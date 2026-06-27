# Documentation

The Irodori Table documentation now lives in its own repository, published as an
mdBook:

- **Online:** <https://hjosugi.github.io/irodori-docs/>
- **Markdown source:** <https://github.com/hjosugi/irodori-docs> (under `src/`)
- **PDF:** open the book and use the print icon → *Save as PDF*

## Still generated in this repo

These reference pages are produced from this repo's tooling and mirrored into
irodori-docs; edit the generators, not the output:

- [data-source-support-status.md](data-source-support-status.md) — engine support
  matrix (`tools/docs/support-status.mjs`)
- [cheatsheets/](cheatsheets/) — per-engine cheatsheets
  (`tools/knowledge/cheatsheet.mjs`)

The static project site (landing page, blog) stays under [site/](site/) and is
deployed by `.github/workflows/pages.yml`.
