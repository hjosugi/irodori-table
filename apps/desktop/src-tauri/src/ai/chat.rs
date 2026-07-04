//! AI-002 — schema-aware, streaming AI chat with an optional agent loop.
//!
//! A conversational layer over the same pluggable providers that back SQL
//! generation (embedded local model, Ollama, any OpenAI-compatible API — OpenAI,
//! Gemini, DeepSeek, … — or a CLI agent like Claude Code / Codex / Copilot).
//! Tokens stream to the UI over a Tauri [`Channel`], mirroring the terminal's PTY
//! transport.
//!
//! When *agent mode* is on and a connection is selected, the assistant can ask
//! for data: it emits a fenced ```sql``` SELECT, which this layer runs **safely**
//! and feeds back so the model can analyze real results (Cortex-Analyst style).
//! Safety is non-negotiable — every auto-run query is:
//!   * **read-only**: only `SELECT`/`WITH` statements are ever executed;
//!   * **bounded**: capped row count so a huge table can't flood memory;
//!   * **time-boxed + cancellable**: run through [`run_query_managed_impl`] with a
//!     timeout and a `query_id`, so on *any* abnormal end (user stop, panel
//!     close, error) `ai_chat_cancel` signals the DB driver to stop the query and
//!     the token is always deregistered. The connected database is never left
//!     holding a runaway statement.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use irodori_error::{IrodoriError, IrodoriErrorKind, Result as IrodoriResult};
use irodori_generate::{ChatMessage, ChatRole, DecodeOptions};

use crate::db::{DbEngine, DbState, QueryResult};

use super::{
    build_chat_provider, chat_handle, register_chat, snapshot_to_gen_schema, unregister_chat,
    AiState,
};

/// Most agent turns before we stop looping, regardless of what the model asks.
const MAX_AGENT_TURNS: usize = 4;
/// Row cap for an auto-run agent query (keeps memory + context bounded).
const AGENT_MAX_ROWS: usize = 200;
/// Rows of an agent result fed back to the model as text (the rest is summarized).
const AGENT_FEEDBACK_ROWS: usize = 50;
/// Hard deadline for an auto-run query so a slow statement can't hang the chat.
const AGENT_QUERY_TIMEOUT_MS: u64 = 30_000;

/// Cancellation handle for one in-flight chat session (see [`AiState`]).
#[derive(Default)]
pub(crate) struct ChatHandle {
    /// Set by `ai_chat_cancel` to stop the agent loop at the next boundary.
    pub stop: AtomicBool,
    /// The `query_id` of the agent query currently running, if any.
    pub query_id: Mutex<Option<String>>,
}

/// One message from the frontend conversation. The backend owns the system
/// prompt, so a client-sent `system` role is treated as `user`.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessageDto {
    pub role: String,
    pub content: String,
}

/// Events streamed to the chat UI over the Tauri channel.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    /// A chunk of assistant text.
    Token { text: String },
    /// A SQL statement the assistant produced (offer "insert" / "run" in the UI).
    Sql { sql: String },
    /// An agent query is about to run; `queryId` lets the UI show a stop control.
    QueryStart { sql: String, query_id: String },
    /// An agent query returned rows.
    QueryResult {
        columns: Vec<String>,
        rows: Vec<Vec<serde_json::Value>>,
        row_count: u64,
        truncated: bool,
        elapsed_ms: u64,
    },
    /// An agent query failed (surfaced, then fed back to the model).
    QueryError { message: String },
    /// A short progress note (e.g. "Running query…").
    Step { message: String },
    /// The turn finished cleanly.
    Done {
        model: String,
        tokens_in: u32,
        tokens_out: u32,
    },
    /// The turn failed.
    Error { message: String },
}

/// Hold a streaming, optionally agentic conversation. Returns once the assistant
/// has finished (and, in agent mode, after any queries it ran). All output —
/// tokens, SQL, query results, errors — arrives on `on_event`.
#[tauri::command]
pub async fn ai_chat(
    db: State<'_, DbState>,
    ai: State<'_, AiState>,
    app: AppHandle,
    session_id: String,
    messages: Vec<ChatMessageDto>,
    connection_id: Option<String>,
    engine: Option<DbEngine>,
    agent_mode: bool,
    on_event: Channel<ChatEvent>,
) -> IrodoriResult<()> {
    let result = run_chat(
        &db,
        &ai,
        &app,
        &session_id,
        messages,
        connection_id,
        engine,
        agent_mode,
        &on_event,
    )
    .await;

    unregister_chat(&ai, &session_id);

    if let Err(err) = result {
        let _ = on_event.send(ChatEvent::Error {
            message: err.to_string(),
        });
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_chat(
    db: &DbState,
    ai: &AiState,
    app: &AppHandle,
    session_id: &str,
    messages: Vec<ChatMessageDto>,
    connection_id: Option<String>,
    engine: Option<DbEngine>,
    agent_mode: bool,
    on_event: &Channel<ChatEvent>,
) -> IrodoriResult<()> {
    let model = build_chat_provider(ai, app)?;
    let handle = register_chat(ai, session_id);

    // Schema context — only when a connection is selected and we have metadata.
    let schema_context = match &connection_id {
        Some(id) => schema_context_for(db, id).await,
        None => None,
    };

    let mut conversation = vec![ChatMessage::system(system_prompt(
        agent_mode && connection_id.is_some(),
        schema_context.as_deref(),
        engine,
    ))];
    for message in messages {
        let role = match message.role.as_str() {
            "assistant" => ChatRole::Assistant,
            // The client never dictates the system prompt.
            _ => ChatRole::User,
        };
        conversation.push(ChatMessage::new(role, message.content));
    }

    let options = DecodeOptions {
        max_tokens: 1024,
        temperature: 0.2,
        ..Default::default()
    };

    let mut model_name = String::new();
    let mut total_in = 0u32;
    let mut total_out = 0u32;

    for _ in 0..MAX_AGENT_TURNS {
        if handle.stop.load(Ordering::SeqCst) {
            break;
        }

        // Stream one assistant turn off the async runtime.
        let output = {
            let model = model.clone();
            let convo = conversation.clone();
            let opts = options.clone();
            let sender = on_event.clone();
            tokio::task::spawn_blocking(move || {
                model.chat(&convo, &opts, &mut |chunk| {
                    let _ = sender.send(ChatEvent::Token {
                        text: chunk.to_string(),
                    });
                })
            })
            .await
            .map_err(|e| {
                IrodoriError::new(IrodoriErrorKind::Internal, format!("chat task failed: {e}"))
            })??
        };

        model_name = model.describe().name;
        total_in = total_in.saturating_add(output.tokens_in);
        total_out = total_out.saturating_add(output.tokens_out);
        conversation.push(ChatMessage::assistant(output.text.clone()));

        // In plain chat (or with no connection), one turn is the whole reply.
        let Some(conn_id) = connection_id.clone() else {
            break;
        };
        if !agent_mode {
            break;
        }

        // Does the assistant want to run a query?
        let Some(sql) = extract_sql_block(&output.text) else {
            break;
        };
        let _ = on_event.send(ChatEvent::Sql { sql: sql.clone() });

        if !is_read_only_sql(&sql) {
            // Surface it for manual insertion, but never auto-run a write.
            let _ = on_event.send(ChatEvent::Step {
                message: "Skipped auto-run: only read-only SELECT queries run automatically."
                    .to_string(),
            });
            break;
        }
        if handle.stop.load(Ordering::SeqCst) {
            break;
        }

        // Run it safely: bounded rows, a timeout, and a cancellable query_id.
        let query_id = format!("aichat-{session_id}-{}", short_id(&sql));
        *handle.query_id.lock().unwrap() = Some(query_id.clone());
        let _ = on_event.send(ChatEvent::QueryStart {
            sql: sql.clone(),
            query_id: query_id.clone(),
        });
        let _ = on_event.send(ChatEvent::Step {
            message: "Running query…".to_string(),
        });

        let run = crate::db::run_query_managed_impl(
            db,
            conn_id,
            sql.clone(),
            Some(AGENT_MAX_ROWS),
            Some(AGENT_QUERY_TIMEOUT_MS),
            Some(query_id.clone()),
        )
        .await;
        *handle.query_id.lock().unwrap() = None;

        match run {
            Ok(result) => {
                let feedback = format_result_table(&result, AGENT_FEEDBACK_ROWS);
                on_event
                    .send(ChatEvent::QueryResult {
                        columns: result.columns.clone(),
                        rows: result.rows.clone(),
                        row_count: result.row_count,
                        truncated: result.truncated,
                        elapsed_ms: result.elapsed_ms,
                    })
                    .ok();
                conversation.push(ChatMessage::user(format!(
                    "Query result (showing up to {AGENT_FEEDBACK_ROWS} rows of {}):\n{feedback}\n\nAnswer the original question using these results. If you need another query, output one more ```sql``` block; otherwise give the final answer in prose.",
                    result.row_count
                )));
            }
            Err(message) => {
                let _ = on_event.send(ChatEvent::QueryError {
                    message: message.to_string(),
                });
                conversation.push(ChatMessage::user(format!(
                    "The query failed: {message}. Either correct the SQL in a new ```sql``` block or explain the problem to the user."
                )));
            }
        }
        // Loop: let the model analyze the results or issue a corrected query.
    }

    let _ = on_event.send(ChatEvent::Done {
        model: model_name,
        tokens_in: total_in,
        tokens_out: total_out,
    });
    Ok(())
}

/// Cancel a running chat: stop the agent loop and, if a query is in flight, signal
/// the database driver to abort it so nothing is left running on the connection.
#[tauri::command]
pub async fn ai_chat_cancel(
    db: State<'_, DbState>,
    ai: State<'_, AiState>,
    session_id: String,
) -> IrodoriResult<()> {
    if let Some(handle) = chat_handle(&ai, &session_id) {
        handle.stop.store(true, Ordering::SeqCst);
        let query_id = handle.query_id.lock().ok().and_then(|q| q.clone());
        if let Some(query_id) = query_id {
            crate::db::cancel_query_impl(&db, query_id).await;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// Build the schema context block for the system prompt, if metadata is cached.
async fn schema_context_for(db: &DbState, connection_id: &str) -> Option<String> {
    let cache = db.metadata_cache.lock().await;
    let snapshot = cache.snapshot(connection_id)?;
    let schema = snapshot_to_gen_schema(snapshot);
    if schema.tables.is_empty() {
        return None;
    }
    Some(render_schema(&schema))
}

/// Compact, token-frugal schema rendering: `schema.table(col type, …)`, capped so
/// a giant database can't blow the context window.
fn render_schema(schema: &irodori_generate::GenSchema) -> String {
    const MAX_TABLES: usize = 60;
    const MAX_COLS: usize = 40;
    let mut out = String::new();
    for table in schema.tables.iter().take(MAX_TABLES) {
        match &table.schema {
            Some(s) => out.push_str(&format!("{s}.{}", table.name)),
            None => out.push_str(&table.name),
        }
        out.push('(');
        let cols: Vec<String> = table
            .columns
            .iter()
            .take(MAX_COLS)
            .map(|c| format!("{} {}", c.name, c.data_type))
            .collect();
        out.push_str(&cols.join(", "));
        if table.columns.len() > MAX_COLS {
            out.push_str(", …");
        }
        out.push_str(")\n");
    }
    if schema.tables.len() > MAX_TABLES {
        out.push_str(&format!(
            "… and {} more tables\n",
            schema.tables.len() - MAX_TABLES
        ));
    }
    out
}

fn system_prompt(agent: bool, schema: Option<&str>, engine: Option<DbEngine>) -> String {
    let mut out = String::from(
        "You are an AI data assistant embedded in Irodori Table, a database client. \
         Help the user understand and query their data. Be concise and concrete. \
         When you write SQL, put it in a fenced ```sql code block and target the \
         connected database's dialect.",
    );
    if let Some(engine) = engine {
        out.push_str(&format!(" The connected database engine is {engine:?}."));
    }
    if agent {
        out.push_str(
            " To answer questions about the actual data, emit a single read-only \
             SELECT in a ```sql block as the last thing in your message; it will be \
             run and the results returned to you. Only SELECT/WITH queries are run \
             automatically. After you receive results, analyze them and give the \
             user a clear answer.",
        );
    }
    if let Some(schema) = schema {
        out.push_str("\n\nThe connected database has these tables:\n");
        out.push_str(schema);
    } else {
        out.push_str(
            "\n\nNo schema metadata is loaded; ask the user to select a connection \
             or expand its schema if you need table details.",
        );
    }
    out
}

/// Extract a SQL statement from a fenced code block in the assistant's reply.
/// Prefers a ```sql-labelled block, then any block that looks like a query.
fn extract_sql_block(text: &str) -> Option<String> {
    let mut blocks: Vec<String> = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find("```") {
        let after = &rest[open + 3..];
        let Some(close_rel) = after.find("```") else {
            break;
        };
        let mut body = &after[..close_rel];
        // Drop an optional language tag on the opening fence line.
        if let Some(nl) = body.find('\n') {
            let tag = body[..nl].trim();
            if tag.is_empty()
                || tag.eq_ignore_ascii_case("sql")
                || !tag.contains(char::is_whitespace)
            {
                body = &body[nl + 1..];
            }
        }
        blocks.push(body.trim().to_string());
        rest = &after[close_rel + 3..];
    }

    blocks
        .into_iter()
        .find(|b| starts_with_query_keyword(b))
        .filter(|b| !b.is_empty())
}

fn starts_with_query_keyword(sql: &str) -> bool {
    let head = sql.trim_start().to_ascii_uppercase();
    head.starts_with("SELECT") || head.starts_with("WITH")
}

/// A statement is safe to auto-run only if it is a single read-only query.
fn is_read_only_sql(sql: &str) -> bool {
    if !starts_with_query_keyword(sql) {
        return false;
    }
    // Reject anything that smuggles a second statement (allow one trailing `;`).
    let trimmed = sql.trim().trim_end_matches(';');
    !trimmed.contains(';')
}

/// Render a result set as a small text table for feeding back to the model.
fn format_result_table(result: &QueryResult, max_rows: usize) -> String {
    let mut out = String::new();
    out.push_str(&result.columns.join(" | "));
    out.push('\n');
    for row in result.rows.iter().take(max_rows) {
        let cells: Vec<String> = row.iter().map(cell_to_string).collect();
        out.push_str(&cells.join(" | "));
        out.push('\n');
    }
    if result.rows.len() > max_rows {
        out.push_str(&format!("… ({} more rows)\n", result.rows.len() - max_rows));
    }
    out
}

fn cell_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// A short, stable-ish suffix for a query id (avoids `Date`/`rand`, unavailable
/// here): a hash of the SQL text.
fn short_id(sql: &str) -> String {
    let mut hash: u64 = 1469598103934665603;
    for byte in sql.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_labelled_sql_block() {
        let text = "Here you go:\n```sql\nSELECT 1\n```\nDone.";
        assert_eq!(extract_sql_block(text).as_deref(), Some("SELECT 1"));
    }

    #[test]
    fn ignores_non_query_blocks() {
        let text = "```python\nprint('hi')\n```";
        assert_eq!(extract_sql_block(text), None);
    }

    #[test]
    fn read_only_guard_rejects_writes_and_multi_statements() {
        assert!(is_read_only_sql("SELECT * FROM t"));
        assert!(is_read_only_sql("WITH x AS (SELECT 1) SELECT * FROM x;"));
        assert!(!is_read_only_sql("DELETE FROM t"));
        assert!(!is_read_only_sql("SELECT 1; DROP TABLE t"));
    }
}
