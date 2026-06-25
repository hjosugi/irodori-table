# Completion And AI Strategy

Last checked: 2026-06-26 JST.

AI can make Irodori nicer, but it must not be required for a great query editor. The base product should feel nearly perfect with no network, no model, and no external account.

Current product status: the desktop editor now has deterministic schema/table/column autocomplete from live metadata, with unit coverage for the local completion engine and browser E2E coverage for CodeMirror popup suggestions. The remaining cross-platform product requirement is the shared serializable completion request/response contract for local API and future hosts, plus broader engine fixtures beyond the desktop smoke.

Layering rule:

1. Deterministic completion is the core editor contract. It runs locally, works offline, uses structured metadata, and must be good enough before any AI path matters.
2. Optional AI is an overlay. It can explain, draft, repair, or propose text/diffs, but it is off by default, permission-scoped, and must never replace or block deterministic completion.
3. ML infrastructure is required even though user-facing AI is optional. Ranking experiments, provider/model evaluation, local dataset preparation, and quality regression checks must run through the same background job and privacy model as huge index builds and other batch work.

## Deterministic Completion First

The completion engine should be built from structured local knowledge. SQL is the first target, but the design must also cover Cypher, time-series SQL/native queries, document queries, key-value commands, search DSLs, and warehouse dialects.

- Incremental SQL parse context from Tree-sitter or dialect-specific parsers.
- Dialect metadata for keywords, functions, operators, DDL/DML syntax, bind variables, comments, quoting rules, and procedural SQL.
- Metadata cache populated by introspection, including schemas, tables, views, columns, indexes, constraints, foreign keys, functions, procedures, packages, triggers, sequences, enum-like values, comments, and privileges.
- Scope resolver for aliases, CTEs, recursive CTEs, derived tables, subqueries, lateral joins, temp tables, table-valued functions, window definitions, and DDL files.
- Query-local symbols from the current editor, unsaved scratch buffers, selected connection, active schema, and tab/session binding.
- Ranking from current context, foreign-key paths, recently used objects, pinned/favorite objects, history, cursor position, and statement type.

Completion categories:

- Keywords and syntax snippets.
- Database, schema, table, view, column, alias, CTE, and subquery output names.
- Function/procedure/package signatures, named parameters, overloads, and return types.
- Join suggestions from foreign keys and naming conventions.
- Insert/update column lists, generated select lists, and group-by/order-by helpers.
- Query parameters and local variables.
- File paths, connection names, tab/session names, and run configurations.
- Dialect-specific explain, analyze, transaction, and administrative commands.
- Graph labels, relationship types, property keys, path patterns, Cypher procedures/functions, and graph result variables.
- Time-series buckets/measurements/tables, tags, fields, time columns, retention policies, aggregate/window helpers, downsampling snippets, and time-range templates.
- Document/KV/search names such as collections, indexes, keys, commands, aggregation stages, JSON paths, search fields, and module-specific functions.

Quality bars:

- No false confidence: prefer fewer precise suggestions over noisy lists.
- Suggestions must be cancellable, fast, and stable while metadata refreshes in the background.
- Completion must work offline and without AI.
- Completion must never leak result data or secrets to an external provider.
- Large metadata/search indexes must build incrementally in background jobs with progress, cancellation, checkpoint/resume, bounded memory, and measurable throughput.

## ML And Batch Requirements

ML is a product-quality requirement for ranking, evaluation, and optional assistant
quality, but it must not turn the editor into a network-dependent product.

- Dataset generation uses only permitted local artifacts: dialect facts, source snapshots, schema metadata, query history, selected editor context, execution errors, and opt-in result samples.
- Evaluation runs are versioned jobs with reproducible inputs, model/provider metadata, quality metrics, latency/cost metrics, and artifact hashes.
- Huge index builds, embedding/vector indexes, metadata indexes, and source-search indexes are cancellable, checkpointed, and disk-backed where needed.
- Batch work uses the shared job model so desktop, local API, and future hosts can inspect progress, cancel work, resume where safe, and collect logs/artifacts consistently.
- External provider calls are forbidden unless workspace policy explicitly permits the specific data classes used by that run.

## Optional AI Layer

AI should sit above the deterministic engine as an opt-in assistant. The items below are target capabilities, not a claim that the product ships them today:

- Natural-language-to-SQL generation.
- Inline SQL ghost text and patch-style suggestions, only when enabled.
- AI Shell (open work): a dockable chat panel scoped to the current connection/workspace.
- Query/error explanation and suggested fixes.
- Explain-plan summary.
- Schema-aware chat.
- Refactor SQL, format intent, or generate migration draft.
- Test data or sample query generation.

Provider model:

- Local providers: Ollama or other local OpenAI-compatible endpoints.
- Cloud providers: OpenAI-compatible, Anthropic, Gemini, Azure OpenAI, Amazon Bedrock, and similar via extension providers.
- MCP/Copilot-compatible bridge: expose Irodori context through scoped local tools so supported clients can request schema/query context where allowed; do not share database credentials, result samples, or query text unless the workspace policy explicitly permits that class of data.

Privacy rules:

- AI is off by default.
- The user must opt in per provider and per workspace.
- Schema metadata, query text, result samples, and execution plans are separate permissions.
- Result data is never sent unless the user explicitly allows it for the current action.
- Redaction should run before provider calls.
- Every AI request should be inspectable in an audit panel.

Execution boundary:

- AI suggestions are text until the user inserts them into the editor.
- The AI Shell cannot run SQL directly; it can only populate the editor or call explicitly scoped read-only tools.
- Query Magics are not AI. The desktop baseline is local, explicit, line-leading commands such as `\describe`, `\explain`, `\export`, `\erd`, and `\params`; command-palette equivalents, structured action audit/history, and run-to-file magic remain open.

## Copilot Compatibility Direction

Directly embedding GitHub Copilot inside a standalone app may not be available as a stable public integration path. The safer first target is a cross-platform Irodori MCP server plus optional editor/provider extensions. The same scoped tool contracts should serve desktop, the local API, and future hosts instead of creating a desktop-only Copilot path.

Milestones:

- `irodori-mcp`: expose safe tools for schema search, object details, explain-plan fetch, scoped read-only query execution, SQL history search, and SQL diagnostics.
- Shared context envelope: separate selected SQL, cursor context, schema metadata, execution plans, result samples, and history snippets so policy can allow or deny each class independently.
- Copilot-style inline autocomplete: provide opt-in text/diff suggestions from selected SQL, cursor context, and permissioned schema metadata; never execute suggestions automatically.
- VS Code config generator: create `.vscode/mcp.json` for connecting Copilot Chat to a local Irodori MCP server.
- Extension SDK provider API: allow third-party AI providers and Copilot-style bridges without hard-coding a vendor into core.
- Policy controls: disable external AI, allow only local models, allow only schema metadata, or allow result samples per workspace.

Sources:

- https://docs.github.com/en/copilot/concepts/context/mcp
- https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp
- https://docs.snowflake.com/en/user-guide/snowflake-copilot-inline
- https://www.jetbrains.com/help/datagrip/ai-assistant.html

## Research Notes

- JetBrains' full-line completion work is relevant because it emphasizes local, latency-aware, syntax-safe suggestions rather than pure cloud generation.
- The Mellum work is relevant because it focuses on compact, IDE-oriented completion models with context packing and permissively licensed training data.
- Control/gating models are relevant because AI completion should trigger only when useful, reducing noise, cost, and privacy exposure.

Sources:

- https://arxiv.org/abs/2405.08704
- https://arxiv.org/abs/2510.05788
- https://arxiv.org/abs/2601.20223
