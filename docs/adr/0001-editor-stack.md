# ADR 0001 — SQL Editor Stack (engine · highlighting · formatter)

- **Status:** Accepted implementation direction; last reconciled 2026-06-25 JST.
- **Backlog:** decides **EDIT-001**; gates **EDIT-002** (highlighting) and **EDIT-008** (formatter). Related: THEME-001, EDIT-005 (Vim), EDIT-007 (SQL-aware selection), completion-and-ai-strategy.md.
- **Current implementation snapshot:** CM6 editor exists, `sql-formatter` is wired, and desktop schema-aware completion is smoke-tested from live metadata. The shared completion contract for local API and future hosts remains open.

## Context

At the time this ADR was opened, the query editor was a plain `<textarea>` in
`apps/desktop/src/App.tsx` with hand-rolled SQL helpers (`statementDelimiters`,
`dollarTagAt`, `compactSql`). The first CM6 implementation now exists. The
ADR records the path to production-quality dialect-aware **syntax highlighting**
and **SQL formatting**, while preserving room for deterministic completion, Vim,
multi-cursor, and large-file performance.

Constraints from existing docs:

- **Multi-dialect, multi-language mandate.** Not just SQL: Cypher, time-series SQL/native, document/KV, search DSLs, warehouse dialects (`completion-and-ai-strategy.md`).
- **Host portability.** A future move off the Tauri WebView to a native Rust GUI must not be foreclosed; keep the semantic layer and completion contracts portable across hosts.
- **License.** Core is `MIT OR 0BSD`; every editor dependency must be permissive and compatible.
- **"Tree-sitter where strong, dialect fallback."** EDIT-002 already commits to this wording; SQL tree-sitter grammar quality varies by dialect.

## Decision

1. **Editor host → CodeMirror 6** (MIT).
2. **Highlighting → two layers:** CM6 **Lezer** (`@codemirror/lang-sql`) as the *paint* layer now; **`web-tree-sitter` (WASM)** as the *semantic/parse* layer (completion context, outline, SQL-aware selection, folding).
3. **Formatter → `sql-formatter` v15** (MIT), pluggable and dialect-mapped; a CST-based formatter is a later v2.

## Reference-project evidence (verified 2026-06-22)

| Client | Editor | License posture | Takeaway |
|---|---|---|---|
| **Beekeeper Studio** | **CodeMirror 6** (incl. CM6 Vim keymap) | GPL → behavior only | The OSS daily-driver baseline runs CM6 + Vim. |
| **Outerbase / LibSQL Studio** | **CodeMirror 6** + `@codemirror/lang-sql` (dialect select, function-hint, autocomplete) | AGPL → behavior only | Closest web-DB-GUI peer; CM6 carries dialect highlighting + completion. |
| **Zequel** | Monaco | Elastic → behavior only | Monaco is viable but heavier; the outlier. |
| **DBeaver / DataGrip** | Native per-dialect parsers (Eclipse / IntelliJ PSI) | DBeaver Apache-2.0 (adaptable) | Informs the per-engine `SQLDialect` concept, not the web host. |

→ Among web/Electron DB clients — the closest architectural peers to a Tauri WebView — **CodeMirror 6 is the dominant, proven choice.**

## Why CodeMirror 6 over Monaco / native

| Criterion | CodeMirror 6 | Monaco | Native + tree-sitter only |
|---|---|---|---|
| Bundle / startup in a WebView | Small, modular, tree-shakeable | Large (~MBs), worker-based | n/a (no web) |
| Deep completion customization | First-class extension API | Possible but opinionated | Full control, all DIY |
| Vim quality | `@codemirror/vim`, proven by Beekeeper | Available, less idiomatic | DIY |
| Dialect highlighting out of the box | `@codemirror/lang-sql`: PG/MySQL/MariaDB/MSSQL/SQLite | TextMate/Monarch, more wiring | DIY |
| "Perfect quickly" | **Best** | Medium | Worst |
| Future native-host move | Re-host needed | Re-host needed | Already native |

Net: CM6 is the fastest route to a production-quality editor now, and the semantic layer (below) is what we carry across a possible native move — not the host.

## Why tree-sitter as the *semantic* layer (answering "treesitter使う？")

**Yes — but as parse-context, not the day-1 paint layer.**

- The CM6 Lezer grammar paints instantly and is themeable today. The SQL **tree-sitter ecosystem is fragmented per dialect** (DerekStride/tree-sitter-sql is MySQL-leaning; `tree-sitter-postgres` is generated from the PG18 Bison grammar; BigQuery is a separate grammar; **Oracle PL/SQL coverage is weak**). There is no single solid multi-dialect SQL tree-sitter grammar, so painting from tree-sitter *now* would be slower to perfect and patchy — contradicting "perfect quickly."
- Tree-sitter earns its place for **incremental CST → semantic features**: completion scope (aliases, CTEs, recursive CTEs, derived tables, subqueries, lateral joins), document outline, **SQL-aware selection expansion** (token → expression → clause → statement, EDIT-007), and folding. Its uniform grammar interface also extends to **Cypher and other non-SQL languages** the strategy targets.
- **Portability dividend:** `web-tree-sitter` runs in the WebView today and the *same* grammars run in native Rust later → this is the layer that survives a host move.
- **Integration boundary:** keep tree-sitter decoupled from CM painting initially. Only bridge tree-sitter captures into CM highlighting later if it clearly beats Lezer for a given dialect (this realizes EDIT-002's "Tree-sitter where the grammar is solid, with a dialect fallback").

## Formatter detail (EDIT-008)

- **`sql-formatter` v15.8.1** (MIT, ~500 dependents) covers Postgres, MySQL, MariaDB, TiDB, SQLite (`sql`), T-SQL, PL/SQL, Redshift, DuckDB, ClickHouse, Snowflake, Spark, Trino, BigQuery, DB2 — a near-exact match to Irodori's engine list. Map `DbEngine → sql-formatter language`.
- Wire a **format hook + "Format SQL" command**; formatter choice is **configurable** (EDIT-008 requires this). Comment-toggle and bracket-matching ride CM6 built-ins.
- **v2:** a CST/tree-sitter-driven formatter for dialect-perfect output where `sql-formatter` falls short (e.g. exotic PL/SQL, vendor extensions).

## Consequences / risks

- Frontend deps: CM6 packages and `sql-formatter` are part of the current editor path; `web-tree-sitter` + per-dialect grammar `.wasm` remain pending for the semantic layer. Benchmark bundle size and large-file responsiveness (EDIT-001 done-when).
- **THEME-001 is the real prerequisite** for EDIT-002: map Lezer highlight tags (and, later, tree-sitter captures) into one normalized theme model — do **not** assume TextMate-only scopes.
- Verify each per-dialect tree-sitter grammar's license individually before bundling (keep the core `MIT OR 0BSD`-clean).

## Rejected

- **Monaco** — heavier bundle, worker model, harder deep-customization of completion/Vim; better suited to full IDEs.
- **Native / tree-sitter-only editor now** — rebuilding text editing, IME, accessibility, and selection from scratch is too slow to "perfect quickly"; revisit only if/when the host goes native.
- **Keep `<textarea>` + highlight overlay** — does not scale to highlighting + completion + Vim + multi-cursor.

## First steps (prototype = EDIT-001 done-when)

1. ✅ **Done** — CM6 editor in `apps/desktop` (`src/SqlEditor.tsx`), `@codemirror/lang-sql` dialect bound to the active `DbEngine` via a Compartment; `basicSetup` brings line numbers, bracket matching, history, active-line, and keyword autocomplete. `tsc` clean, `vite build` green.
2. ✅ **Done** — `sql-formatter` wired behind the toolbar "Format SQL" action, dialect-mapped per engine.
3. ⏳ **Partial** — Vim mode smoke is covered in browser Playwright (`@replit/codemirror-vim` toggle + CM Vim panel). Remaining: large-file responsiveness (5–20k lines) and a focused Vim behavior suite for motions/operators/registers; full Tauri runtime smoke still needs a Tauri runner.
4. ⏳ **Pending** — `web-tree-sitter` + one grammar (Postgres) as a non-painting outline/selection spike to de-risk the semantic layer.

5. ⏳ **Open / revalidate** — schema-aware completion: product status should be treated as keyword/basic autocomplete only until active `DatabaseMetadata` produces user-facing schema/table/column suggestions through a tested shared completion contract. That contract should feed CM6 now and future hosts later; tree-sitter scope resolution layers on after the schema/table/column baseline is proven.

> Bundle note: CM6 adds ~ to the client bundle (961 kB raw / 293 kB gzip total with React + lucide). Acceptable for a desktop shell; revisit code-splitting if it grows.
