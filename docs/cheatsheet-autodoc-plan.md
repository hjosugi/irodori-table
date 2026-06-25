# Cheatsheet & Auto-Doc Plan

How the per-engine cheatsheets (`docs/cheatsheets/`) and the support inventory
(`docs/data-source-support-status.md`) get **collected automatically** and
**regenerated when the product changes**, instead of being hand-maintained.

This reuses what already exists rather than inventing a parallel system:

- Knowledge store: `knowledge/schema.sql` (`sources`, `source_snapshots`, `facts`,
  `implementation_notes` + FTS5), Rust `irodori-knowledge` crate, and the Node
  tools `tools/knowledge/{refresh,analyze,query}.mjs`.
- Engine registry: `apps/desktop/src-tauri/src/db/engine.rs` (`DbEngine`, `Wire`,
  ports) — derives `ts-rs::TS`, so it can already emit machine-readable metadata.
- Source registry: `knowledge/sources.json` already tracks the official docs for
  PostgreSQL, MySQL, SQLite, SQL Server, DuckDB, MongoDB, **Neo4j** (Cypher manual
  + Browser), InfluxDB, Oracle, and more.

## Two pipelines, one store

```
                 ┌─────────────────────── COLLECT (ask #4) ───────────────────────┐
 sources.json ──▶ refresh.mjs ──▶ source_snapshots ──▶ analyze.mjs ──▶ facts        │
 (official docs)   (fetch+hash)     (raw + dedupe)      (extract)     (structured)   │
                                                                          │          │
                 ┌──────────── ACCUMULATE (ask #5) ────────────┐          │          │
 feature lands ─▶ feature-event ─▶ implementation_notes ───────┼──────────┤          │
 (PR/commit)      (recorded)        (component + status)        │          ▼          │
                                                                ▼   cheatsheet.mjs    │
   docs/feature-matrix.md  ◀──  doc generator  ◀───────────────────  (render facts   │
   docs/data-source-support-status.md                                 + notes →      │
   docs/cheatsheets/<engine>.md                                       markdown)      │
                                                                                     │
                 └─────────────────────────────────────────────────────────────────┘
```

- **COLLECT** keeps upstream DB knowledge fresh (cheatsheet *content*).
- **ACCUMULATE** records Irodori's own feature changes (cheatsheet *status* and the
  support inventory).
- The **doc generator** is the single writer of the generated docs; humans edit
  seeds and the template, not generated pages.

## Ask #1 — support inventory (mostly buildable now)

`docs/data-source-support-status.md` sections 1–3 are a pure function of the engine
registry. Make it generated:

1. Seed `knowledge/engines.json` as the machine-readable mirror of the registry:
   per `DbEngine`: id, wire, default port, adapter/routing, maturity, and the
   curated not-registered roadmap list.
2. `tools/docs/support-status.mjs --check` parses `DbEngine` and
   `is_unimplemented_wire()` and fails if `knowledge/engines.json` or
   `docs/data-source-support-status.md` drifts from the registry.
3. Next: add a renderer/emitter so sections 1–3 are generated instead of
   hand-curated, while section 4 ("Not registered") stays curated.

This makes "what's not supported" self-truing — adding a `DbEngine` variant or
flipping `is_unimplemented_wire` updates the doc.

## Ask #4 — auto-collected, ML-assisted cheatsheet data

The fetch half already works (`refresh.mjs`). Two upgrades:

1. **Scheduling.** Add a weekly job (GitHub Actions or local cron) that runs
   `refresh.mjs` for `enabled` sources, then `analyze.mjs --changed-only`, then the
   cheatsheet generator, and opens a PR with the regenerated pages. Per ROADMAP,
   large refreshes run through the shared job runtime (progress, cancel,
   checkpoint, bounded memory).
2. **ML extraction.** `analyze.mjs` is deterministic rule-based today. Add an
   optional model-backed extractor that reads a snapshot and emits the structured
   cheatsheet sections (connect / query model / essential statements /
   introspection / gotchas) as `facts` rows with `area = 'cheatsheet'`. Guardrails
   from `docs/knowledge-base.md` apply: every generated fact records `source_id`,
   `snapshot_id`, snapshot hash, model/prompt id, and confidence so runs are
   reproducible and auditable. ML stays **optional infrastructure** — the rule-based
   path remains the offline default, matching the "AI optional, never required"
   non-negotiable.

New cheatsheet fact shape (reuses the `facts` table; no schema change required):

| column | use |
|---|---|
| `product` | engine product, e.g. `Neo4j` |
| `area` | `cheatsheet` |
| `title` | section key: `connect`, `query-model`, `statements`, `introspection`, `gotchas` |
| `summary` | rendered markdown body for that section |
| `confidence` | `high` for rule-based/curated, model score otherwise |
| `source_id` / `metadata_json` | provenance (snapshot hash, model id) |

A new `tools/knowledge/cheatsheet.mjs` then:
- maps each cheatsheet-enabled engine → its `sources.json` ids (by `product`),
- pulls the latest `area='cheatsheet'` facts per section,
- renders `docs/cheatsheets/<engine>.md` in the template order from
  `docs/cheatsheets/README.md`, preserving hand-seeded `<!-- seed -->` sections
  until a higher-confidence fact replaces them,
- writes the **Sources** footer from the contributing `source_id`s.

`docs/cheatsheets/neo4j.md` is the **target output shape** for this generator.

## Ask #5 — feature-add → accumulate → auto-doc

Goal: when an Irodori feature lands, the information accumulates and the docs update
themselves.

1. **Feature event.** On merge, record a feature event (component, engine(s)
   touched, summary, ticket, status) into `implementation_notes` — the table
   already exists. Source can be a PR template field, a commit trailer
   (`Doc-Update: neo4j graph-view`), or an explicit `tools/knowledge/record-feature.mjs`.
2. **Accumulate.** `implementation_notes` becomes the running ledger that already
   backs `docs/implementation-progress.md`.
3. **Regenerate.** The doc generator folds notes into the generated docs:
   - `docs/data-source-support-status.md` maturity column,
   - `docs/feature-matrix.md` backlog-status cells,
   - the **Irodori-specific behavior** and **status** sections of the relevant
     cheatsheet (e.g. promoting Neo4j's "graph visualization is planned" line once
     the graph view ships).
4. **Trigger.** Run the generator in CI on merge to `main`; commit the regenerated
   docs or open a follow-up PR. Same generator, whether triggered by a knowledge
   refresh (#4) or a feature event (#5).

## Build order (smallest valuable step first)

1. **Land the docs spine** (done): support-status inventory, cheatsheet
   README/template, flagship Neo4j cheatsheet, this plan.
2. **`engines.json` seed + `support-status.mjs --check`** (done): CI-checked
   registry drift guard. Pure-local, no network, no model.
3. **`engines.json` emitter + support-status renderer**: make ask #1 sections 1–3
   *rendered* from `engines.json` (not just checked). Not yet built — the curated
   doc + membership check cover it for now.
4. **`cheatsheet.mjs` generator** (done): validates `<!-- seed -->` pages
   (`neo4j.md`) and renders others from `knowledge/cheatsheets/<id>.json` fixtures
   or `area='cheatsheet'` facts (`postgres.md` is the first generated page).
   `--check` guards staleness in CI.
5. **Scheduled refresh + regenerate** (done): `.github/workflows/knowledge-refresh.yml`
   runs `refresh` → `analyze --changed-only` → `ml-extract` → `cheatsheet`, then
   opens a PR (ask #4 collection). Mirrored by `make knowledge-refresh` / `make docs`.
6. **ML extractor** (done): `tools/knowledge/ml-extract.mjs` calls any
   OpenAI-compatible endpoint (local or hosted) to emit `area='cheatsheet'` facts
   with full provenance. Optional — a no-op offline (ask #4 quality).
7. **Feature-event recording** (done): `tools/knowledge/record-feature.mjs` writes
   to `implementation_notes` (flags or `Doc-Update:` commit trailers). PR validation
   is `.github/workflows/docs-check.yml`; scheduled regeneration carries it into the
   generated docs. Folding notes into per-cheatsheet "Irodori-specific behavior"
   sections is the remaining piece (ask #5).

Only step 3 (full doc rendering from `engines.json`) remains; everything else is
wired and runs green via `make docs-check`.

## Open decisions

- **Memgraph & vector DBs:** finish or defer (see support-status §5) before
  generating cheatsheets for them.
- **Model provider for #4 extraction:** decided — any **OpenAI-compatible**
  endpoint (local Ollama/LM Studio/vLLM or a hosted gateway) via
  `IRODORI_LLM_BASE_URL` / `IRODORI_LLM_MODEL` / `IRODORI_LLM_API_KEY`. Offline
  rule-based stays the default; ML is off unless those are set.
- **Generated-doc commit policy:** the scheduled job opens a PR (review before
  merge) rather than committing to `main` directly. Revisit if the volume makes
  review noise.
