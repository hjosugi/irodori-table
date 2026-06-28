# Path to 1.0

1.0 is the **excellent, stable core** — not every roadmap item. The strategic call
is to ship a polished cross-platform SQL GUI for the core SQL engines and
explicitly defer the exotic surfaces. Current version: **0.3.0**.

## P0 — blockers (must do for 1.0)

1. **Declare the supported-engine line.** 1.0 = PostgreSQL, MySQL/MariaDB, SQLite,
   SQL Server, Oracle as *supported*; everything else (lakehouse, graph, vector,
   time-series, the long in-progress list) is *experimental*. Without this, 1.0
   never closes.
2. **Stabilize the build.** `cargo build` green on default features (the DB-connector
   feature refactor is mid-flight and only builds via `--features legacy-connectors`),
   remove the dev `[patch]`, and cut **`irodori-sql` v0.2.24**.
3. **Core data workflows (Phase 6):** schema compare + migration preview (engine
   already exists in `irodori-sql/schema.rs` — mostly wiring), editable results +
   table designer + index/constraint UI, data compare + safe bulk edit.
4. **UI / theme completeness:** finish `THEME-001b` (no hardcoded colors — all
   theme variables) + `THEME-002` (theme import/save/switch). *(In progress: the
   AI dialog + terminal were converted to theme variables.)*
5. **Release mechanics:** code signing/notarization (macOS/Windows), the Tauri
   in-app updater (see [distribution.md](distribution.md)), and green CI (typegen
   drift, unit, browser smoke, Rust tests, security).

## P1 — strongly wanted

- `PERF-001`: settle the result-grid rendering path; prove 1M-row smoothness.
- Workspace basics polish (tab CRUD, history search, saved queries, per-tab
  connection binding).
- Git graph hardening (commit actions, branch ops).
- AI generation stays **opt-in + audited** (it's optional, never required).

## Defer to post-1.0

Lakehouse/Iceberg, Snowflake full-auth, Neo4j/graph, InfluxDB/time-series, vector
DBs, the headless API as a shipped product, the extension *registry* (local SDK is
enough), team/workspace sync — and keep the new **integrated terminal** and
**local AI generation** behind feature flags so they don't gate 1.0.

## Recommended next step

Schema compare + migration preview (highest functional leverage; the diff/migration
engine already exists in `irodori-sql`), then build-stabilization + theme
completeness.
