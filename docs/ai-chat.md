# AI chat and SQL generation

Two surfaces share one provider configuration: the **AI Chat** side panel
(`Mod+Shift+I`) and the **Generate SQL with AI** dialog.

> **Nothing works until you choose a provider.** The default provider is the
> embedded local model, and no shipped build compiles it in. Out of the box
> every request fails with *local AI generation is not available in this build*
> and the picker shows **Local model support is not compiled in**. Step 1 below
> is not optional.

## Step 1 — choose a provider

There is no AI section in Settings. Provider configuration lives inside the
features themselves:

- **AI Chat panel** — the provider picker at the top, with advanced fields
  behind the **Provider settings** toggle.
- **Generate SQL dialog** — the collapsed **Model provider** disclosure.

Four kinds are supported:

| Kind | Label |
| --- | --- |
| `local` | **Local (embedded model)** |
| `ollama` | **Ollama (local server)** |
| `openaiCompat` | **OpenAI-compatible API** |
| `command` | **CLI (Claude Code / Codex / any)** |

The chat panel offers presets:

| Preset | Model | Endpoint or program |
| --- | --- | --- |
| **Local (embedded)** | — | — |
| **Ollama** | `qwen2.5-coder` | `http://localhost:11434` |
| **OpenAI (ChatGPT)** | `gpt-4o-mini` | `https://api.openai.com` |
| **Google Gemini** | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| **DeepSeek** | `deepseek-chat` | `https://api.deepseek.com` |
| **Claude Code (CLI)** | — | `claude -p` |
| **Codex (CLI)** | — | `codex exec` |
| **Copilot (CLI)** | — | `copilot -p` |

Anthropic's API is not supported natively — Claude is reached by shelling out to
the `claude` CLI. Editing any preset field switches the selection to
**Custom…**.

Fill in **Model**, **Endpoint** (or **Program** and **Arguments** for a CLI),
and **API key** where needed, then press **Use this model** or **Save
provider**.

### Where the API key goes

**Into the OS keychain.** It is written there on save, stripped from anything
the backend returns, and reloaded at startup.

The field's placeholder reads *"sk-… (kept in memory only)"*. **That text is
stale and wrong** — the key is persisted and survives restarts. Remove it by
clearing the field and saving.

### Cloud disclosure

Selecting a cloud provider shows a one-time disclosure naming the host:

> Prompts, selected schema metadata, query context, generated SQL, and API keys
> used for authentication may leave this device. Requests go to {host}. Review
> that provider's retention and training settings before use.

Accepting is recorded per machine. Note any OpenAI-compatible endpoint is
treated as cloud, even a local one.

All provider traffic leaves from the Rust backend, not the webview.

## Using the chat

`Mod+Shift+I` toggles the panel. Type a question and press `Enter`
(`Shift+Enter` for a newline). Replies stream in.

Per reply: **Insert into editor**, **Copy reply**, **Regenerate**. **Stop**
halts generation. **Clear conversation** empties the thread.

### What the model can see

| Context | Included? |
| --- | --- |
| Schema of the selected connection | **Yes** — if metadata is already cached |
| The SQL in your editor | **No** |
| The rows in your results grid | **No** |
| Previous turns of this conversation | Yes |

Schema is inlined into the system prompt as `schema.table(col type, …)`, capped
at **60 tables** and **40 columns per table**, with an "… and N more tables"
note beyond that. Without a connection selected the prompt says so, and the chat
answers generically.

Ignore the panel's own hint text here — **Ask about SQL, schema, or the current
results.** and the agent-mode tooltip **Use schema and result context when
replying** both imply the grid is visible to the model. It is not. "Results"
means results of queries the agent ran itself.

### Agent mode

Ticking **Agent mode** lets the assistant run a query and read the rows back.
The loop is text-based, not tool-calling: the model emits a fenced ` ```sql `
block, the app extracts it and runs it, then feeds the rows back as another
message.

Guard rails, all fixed:

| Limit | Value |
| --- | --- |
| Agent turns per question | 4 |
| Rows fetched per agent query | 200 |
| Rows fed back to the model | 50 |
| Query timeout | 30 s |

Only read-only statements run automatically — a query must begin with `SELECT`
or `WITH` and contain no `;`. Anything else is refused with **Skipped auto-run:
only read-only SELECT queries run automatically.** Agent mode needs a selected
connection.

## Generate SQL

**Generate SQL with AI** opens a dialog: describe what you want, press
**Generate** or `Ctrl+Enter`. The result is reported as **SQL generated** with
the model and token count. It has no default keyboard shortcut.

## Gaps

- **The default provider cannot work in any distributed build.** The embedded
  local model is behind a Cargo feature that no release enables. Choose Ollama,
  an OpenAI-compatible endpoint, or a CLI.
- **There is no model downloader.** Even in a build with local support
  compiled in, nothing fetches the model file, and **Delete local model** is
  one-way — there is no in-app path to get it back.
- **The API key placeholder misstates where the key goes** (see above).
- **No AI settings section.** Provider configuration is unreachable without
  opening the chat panel or the generate dialog.
- **The assistant cannot see your editor or your results**, despite hint text
  suggesting otherwise.
- **No tool calling.** SQL is recovered by scanning for fenced code blocks.
- **No "run this" button** on a suggested query — the backend emits a SQL event
  for each agent turn and the UI discards it. You can only **Insert into
  editor** and run it yourself.
- **Query timing is captured but never displayed** in chat results.
- **Two runtime messages are not translated**: **Skipped auto-run: only
  read-only SELECT queries run automatically.** and **Running query…**.
- **The cloud consent cannot be revoked from the UI** once accepted.
