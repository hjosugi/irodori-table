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
- **Scoped grammar** — on large schemas the GBNF is projected down to just the
  planned tables (+ their FK neighbors), so the grammar a big DB produces stays
  small: faster decode, lower memory, and the model can't even mention an
  irrelevant table.
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
  `ai_set_provider`, and `ai_get_provider` commands. The schema comes from the
  existing completion metadata cache; the dialect from the connection engine.

## Runtime & model

- Embedded **llama.cpp** via `llama-cpp-2`, **CPU only**, behind the `llama`
  cargo feature (the C++ build stays opt-in, like `duckdb`).
- Default model: **Qwen2.5-Coder-0.5B-Instruct Q4_K_M** (~0.4 GB), strong at
  text-to-SQL at its size.
- Lightness: mmapped weights, model loaded once and reused, a fresh context per
  request (KV cache freed between calls), small `n_ctx`, capped threads, and the
  grammar prunes the token space so fewer decode steps are needed.

## Providers — connect any model (extensibility)

Everything talks to one trait, `GrammarModel` (`runtime.rs`), so backends are
fully pluggable. The **verify gate is what makes every provider safe**: output is
parsed and schema-validated regardless of source, so a backend that can't honor
the GBNF grammar just gets its mistakes *rejected* instead of *prevented* — never
returned as invalid/hallucinated SQL.

Built-in providers:

| Provider | Crate item | Feature | Notes |
| --- | --- | --- | --- |
| Embedded llama.cpp | `LlamaSqlModel` | `llama` | GBNF-constrained, fully local/offline |
| Ollama | `OllamaModel` | `http` | any local Ollama model (7B/14B/32B…) |
| OpenAI-compatible API | `OpenAiCompatModel` | `http` | OpenAI, Azure, OpenRouter, gateways, many self-hosted/Anthropic-compatible |
| External CLI | `CommandModel` | *(none)* | Claude Code, Codex, Copilot, or any command — reuses your subscription |
| Echo (tests) | `EchoModel` | *(none)* | deterministic stand-in |

The desktop selects a provider at runtime via `ai_set_provider` /
`ai_get_provider` (`AiProviderConfig` { kind, model, endpoint, apiKey, program,
args }), surfaced in the generate dialog's "Model provider" section. The `http`
and CLI providers are compiled in by default, so **external/subscription models
work without the heavy `llama` build**; the embedded model stays opt-in. API keys
are held in memory only (persist via the OS keychain through
`security_store_secret`).

Adding another provider (e.g. Anthropic-native, a local server, a queue) is a new
`impl GrammarModel` plus one `AiProviderKind` arm — no pipeline changes.

## Build & use

```bash
# Standard build: AI generation compiled out, everything else unaffected.
cargo build -p irodori-table-desktop

# With local generation (compiles llama.cpp; set TMPDIR for the C++ build):
TMPDIR=.irodori-local/cc-tmp cargo build -p irodori-table-desktop --features llama
```

The embedded model is read only when it already exists in the app data dir under
`models/`. The desktop UI does not start a background download job; preinstall
the model for local generation, or use Ollama / API / CLI providers.

## Safety

AI generation is opt-in, only ever **inserts** SQL into the editor (it never runs
it), and references only objects that exist in the connected schema. This keeps
the A5SQL-style read-only / AI-disabled posture intact.

## Follow-ups

- Optional admin tooling for preinstalling local models outside the desktop UI.
- Expand the grammar/AST beyond `SELECT` (DML/DDL) over later iterations.
- Optional idle-unload timer to drop the model from memory after inactivity.
