# Irodori Table

Fast desktop database client for querying, browsing, editing, diagramming, and
checking data across many engines.

## Use

Download builds from GitHub Releases:

<https://github.com/hjosugi/irodori-table/releases>

Current focus: Linux desktop builds. Release packaging templates live in
`hjosugi/irodori-kit` under `packaging/irodori-table/`.

## Develop

```sh
make setup
make desktop-dev
```

Useful checks:

```sh
make check
make desktop-build-verified
make desktop-e2e
```

Sample databases live in the sibling repo:

```sh
git clone https://github.com/hjosugi/irodori-samples ../irodori-samples
make db-up DB=postgres
make db-verify DB=postgres
```

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
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)

License: `MIT OR 0BSD`.
