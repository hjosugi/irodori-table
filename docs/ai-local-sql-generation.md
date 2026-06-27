# Local SQL generation (軽量llama × 完璧な構文木)

Irodori Table can generate SQL from natural language with a **lightweight local
model**, designed so correctness comes from a real SQL grammar rather than from
model size. A tiny quantized model runs entirely on-device; every token it emits
is forced through a schema-specialized SQL grammar, and the result is parsed back
and validated against the schema. Deterministic completion stays the default —
this is an opt-in, offline generation path.

## Why it's correct by construction

A small model is unreliable on its own. The design removes that risk:

- **完璧な構文木** — a real, dialect-aware SQL parser + AST + GBNF grammar
  (`irodori-sql`: `ast.rs`, `parser.rs`, `grammar.rs`).
- **Grammar-constrained decoding** — the model can only sample tokens the GBNF
  grammar allows, so output is always syntactically valid.
- **Schema projection** — table/column names become *closed* grammar terminals,
  so a hallucinated relation is literally unsamplable.
- **事前の調整 (planning)** — tables and foreign-key joins are resolved
  deterministically before the model runs, shrinking its job so a 0.5B model
  suffices.
- **Validate + repair** — output is parsed and every identifier is proven to
  exist; anything else is rejected, not returned.

## Pipeline

```
NL prompt + connection schema
  → project   (GenSchema → GBNF grammar + SchemaIndex)
  → plan      (mentioned tables + FK joins + compact prompt)
  → decode    (llama.cpp, grammar-constrained, greedy)
  → verify    (parse + schema-validate + canonical re-render)
  → SQL inserted into the editor (never executed)
```

## Crates

- **`irodori-sql`** — `ast`, `parser`, `grammar` (the shared syntax tree). Pure
  Rust, dialect-parameterized.
- **`irodori-generate`** — `project`, `plan`, `verify`, `runtime` and the
  orchestrator. The `llama` feature adds the embedded runtime (`llama.rs`).
  Without it (or without a model) the engine returns `unsupported`/`not found`.
- **desktop (`src-tauri/src/ai`)** — the `ai_generate_sql`, `ai_engine_status`,
  and `ai_download_model` commands. The schema comes from the existing completion
  metadata cache; the dialect from the connection engine.

## Runtime & model

- Embedded **llama.cpp** via `llama-cpp-2`, **CPU only**, behind the `llama`
  cargo feature (the C++ build stays opt-in, like `duckdb`).
- Default model: **Qwen2.5-Coder-0.5B-Instruct Q4_K_M** (~0.4 GB), strong at
  text-to-SQL at its size.
- Lightness: mmapped weights, model loaded once and reused, a fresh context per
  request (KV cache freed between calls), small `n_ctx`, capped threads, and the
  grammar prunes the token space so fewer decode steps are needed.

## Build & use

```bash
# Standard build: AI generation compiled out, everything else unaffected.
cargo build -p irodori-table-desktop

# With local generation (compiles llama.cpp; set TMPDIR for the C++ build):
TMPDIR=.irodori-local/cc-tmp cargo build -p irodori-table-desktop --features llama
```

The model downloads on first use via the background `ai_download_model` job
(visible in the jobs dashboard) into the app data dir under `models/`. After it's
cached, generation works fully offline.

## Safety

AI generation is opt-in, only ever **inserts** SQL into the editor (it never runs
it), and references only objects that exist in the connected schema. This keeps
the A5SQL-style read-only / AI-disabled posture intact.

## Follow-ups

- A dedicated `JobKind::ModelDownload` (currently uses `JobKind::Other` to avoid a
  cross-repo tag bump of `irodori-knowledge`).
- Expand the grammar/AST beyond `SELECT` (DML/DDL) over later iterations.
- Optional idle-unload timer to drop the model from memory after inactivity.
- Cut `irodori-sql` tag `v0.2.24` once the AST/grammar API is stable and remove
  the local `[patch]` in the workspace `Cargo.toml`.
