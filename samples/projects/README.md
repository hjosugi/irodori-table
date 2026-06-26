# Irodori DB feature sample projects

These sample projects are small, engine-specific query sets for manual checks in
Irodori Table. They complement `make db-verify DB=<engine>`, which is the real
connection/query smoke test through the Rust adapters.

## How to use

1. Start a sample engine from the repository root:

   ```bash
   make db-up DB=postgres
   ```

2. Open Irodori Table and connect with the printed DSN.
3. Open the matching file under `samples/projects/<engine>/`.
4. Run one statement at a time.
5. Stop the container when done:

   ```bash
   make db-down DB=postgres
   ```

SQLite and DuckDB are embedded samples. They do not need a container.

## Catalog and checks

`samples/db-feature-samples.json` is the machine-readable catalog for these
projects, the docs, and the website blog. Validate it with:

```bash
node tools/docs/db-feature-samples.mjs
```

The catalog check verifies that every registered Irodori engine has a feature
entry, local sample projects point at files that exist, and each engine has
official resource links.
