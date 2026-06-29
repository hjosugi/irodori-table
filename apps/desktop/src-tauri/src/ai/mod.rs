//! AI-001 — local, grammar-constrained SQL generation commands.
//!
//! Thin Tauri layer over the `irodori-generate` engine: it turns the live schema
//! (the completion metadata cache) into the engine's [`GenSchema`], runs the
//! grammar-constrained generator, and returns SQL the caller inserts into the
//! editor. It never executes the SQL. The embedded model is opt-in (cargo feature
//! `llama`) and loaded lazily; without it (or without a preinstalled model) the
//! commands fail cleanly so the deterministic completion path is unaffected.

pub mod chat;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use irodori_completion::{MetadataObjectKind, MetadataSnapshot};
use irodori_core::{IrodoriError, IrodoriErrorKind, Result as IrodoriResult};
use irodori_generate::{
    generate, ChatModel, CommandConfig, CommandModel, DecodeOptions, GenColumn, GenForeignKey,
    GenSchema, GenTable, GenerateRequest, GrammarChatAdapter, GrammarModel, HttpConfig,
    OllamaModel, OpenAiCompatModel, RelationKind,
};
use irodori_secure_store::{connection_secret_ref, SecretPurpose, SecretValue, SecureStore};

use crate::db::{DbEngine, DbState, QueryPlanAnalysis};
use crate::security::SecurityState;

pub use chat::{ai_chat, ai_chat_cancel};

/// Default local model: small, strong at text-to-SQL, CPU-friendly (~0.4 GB).
const DEFAULT_MODEL_FILE: &str = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";

/// Permissive grammar: accept any free-form prose. The embedded llama path needs
/// a grammar to decode against; the HTTP/Ollama/CLI providers ignore it.
const PROSE_GBNF: &str = "root ::= char+\nchar ::= [^\\x00]";

/// Lazily-loaded engine handle, shared across commands.
#[derive(Default)]
pub struct AiState {
    inner: Mutex<AiInner>,
    /// In-flight chat sessions, keyed by the session id the frontend assigns, so
    /// `ai_chat_cancel` can stop a run and any query it spawned. Cleaned up when
    /// the session ends (normally or by error).
    chats: Mutex<HashMap<String, Arc<chat::ChatHandle>>>,
}

#[derive(Default)]
struct AiInner {
    model: Option<Arc<dyn GrammarModel>>,
    loaded_path: Option<PathBuf>,
    provider: AiProviderConfig,
}

/// Which backend powers generation. The pipeline (schema projection → planning →
/// validate/repair) is identical for all; only the model differs, and the verify
/// gate keeps every one of them safe.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum AiProviderKind {
    /// Embedded llama.cpp (grammar-constrained; needs the `llama` build).
    #[default]
    Local,
    /// A local Ollama server.
    Ollama,
    /// Any OpenAI-compatible chat API (OpenAI, Azure, OpenRouter, gateways, …).
    OpenaiCompat,
    /// An external CLI (Claude Code, Codex, Copilot, any command).
    Command,
}

/// Provider selection. `apiKey` is held in memory only and never returned by
/// `ai_get_provider`; persist it via the OS keychain (`security_store_secret`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub kind: AiProviderKind,
    #[serde(default)]
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// Result of a generation request.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiGenerateResult {
    pub sql: String,
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    /// True when validation canonicalized the model's output.
    pub repaired: bool,
    /// Tables the planner selected from the prompt.
    pub tables: Vec<String>,
}

/// Whether local generation is available and where the model lives.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AiEngineStatus {
    /// Built with the `llama` feature.
    pub compiled: bool,
    /// The model file is present on disk.
    pub model_present: bool,
    /// The model is loaded in memory.
    pub loaded: bool,
    pub model_file: String,
    pub model_path: String,
}

/// Generate a single `SELECT` from natural language, grounded in the connection's
/// schema. Returns SQL to insert (never runs it).
#[tauri::command]
pub async fn ai_generate_sql(
    db: State<'_, DbState>,
    ai: State<'_, AiState>,
    app: AppHandle,
    connection_id: String,
    prompt: String,
    engine: DbEngine,
) -> IrodoriResult<AiGenerateResult> {
    if prompt.trim().is_empty() {
        return Err(IrodoriError::validation("a prompt is required"));
    }

    let schema = {
        let cache = db.metadata_cache.lock().await;
        let snapshot = cache.snapshot(&connection_id).ok_or_else(|| {
            IrodoriError::new(
                IrodoriErrorKind::NotFound,
                format!(
                    "no schema metadata for connection `{connection_id}`; expand the schema or run a query first"
                ),
            )
        })?;
        snapshot_to_gen_schema(snapshot)
    };
    if schema.tables.is_empty() {
        return Err(IrodoriError::new(
            IrodoriErrorKind::NotFound,
            "no tables found in the connection schema",
        ));
    }

    let model = build_provider(&ai, &app)?;

    let outcome = tokio::task::spawn_blocking(move || {
        let dialect = engine.dialect();
        let request = GenerateRequest::new(prompt, schema);
        generate(model.as_ref(), &request, dialect.as_ref())
    })
    .await
    .map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Internal,
            format!("generation task failed: {e}"),
        )
    })??;

    Ok(AiGenerateResult {
        sql: outcome.sql,
        model: outcome.model,
        tokens_in: outcome.tokens_in,
        tokens_out: outcome.tokens_out,
        repaired: outcome.repaired,
        tables: outcome.tables,
    })
}

/// Narrate an already-computed query plan in plain prose with the active AI
/// provider. Opt-in; the deterministic `plan.summary` is always available without
/// it. Takes the `QueryPlanAnalysis` the UI already holds (it is `Deserialize`),
/// so no database round-trip is needed here.
#[tauri::command]
pub async fn ai_explain_plan(
    ai: State<'_, AiState>,
    app: AppHandle,
    plan: QueryPlanAnalysis,
) -> IrodoriResult<String> {
    let prompt = build_plan_prompt(&plan);
    let model = build_provider(&ai, &app)?;

    let output = tokio::task::spawn_blocking(move || {
        model.complete(
            &prompt,
            PROSE_GBNF,
            &DecodeOptions {
                max_tokens: 512,
                temperature: 0.2,
                ..Default::default()
            },
        )
    })
    .await
    .map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Internal,
            format!("narration task failed: {e}"),
        )
    })??;

    Ok(output.text.trim().to_string())
}

/// Build a compact text prompt from the plan: instruction, headline/summary,
/// engine, the highest-impact nodes, and the findings. We never dump the raw
/// EXPLAIN output — the normalized fields are enough and keep tokens low.
fn build_plan_prompt(plan: &QueryPlanAnalysis) -> String {
    let mut out = String::new();
    out.push_str(
        "You are a database performance assistant. Explain this query execution plan in plain \
         language for an engineer. Cover: what the query does, where the time goes and why, and \
         the single highest-impact fix. Briefly teach how to read the key metrics (rows, cost, \
         time, scans). Be concise and concrete; do not invent details that are not in the plan.\n\n",
    );

    out.push_str(&format!("Headline: {}\n", plan.headline));
    out.push_str(&format!("Engine: {}\n", plan.engine_family));
    out.push_str(&format!("Deterministic summary: {}\n\n", plan.summary));

    let mut nodes: Vec<&_> = plan.nodes.iter().collect();
    nodes.sort_by(|a, b| b.impact_score.total_cmp(&a.impact_score));
    out.push_str("Top plan nodes (by relative impact):\n");
    for node in nodes.iter().take(8) {
        let mut parts = vec![format!("operation={}", node.operation)];
        if let Some(object) = &node.object {
            parts.push(format!("object={object}"));
        }
        if let Some(rows) = node.estimated_rows {
            parts.push(format!("estRows={}", trim_num(rows)));
        }
        if let Some(rows) = node.actual_rows {
            parts.push(format!("actualRows={}", trim_num(rows)));
        }
        if let Some(cost) = node.total_cost {
            parts.push(format!("cost={}", trim_num(cost)));
        }
        if let Some(ms) = node.actual_total_ms {
            parts.push(format!("ms={}", trim_num(ms)));
        }
        out.push_str(&format!("- {}\n", parts.join(", ")));
    }
    out.push('\n');

    out.push_str("Findings:\n");
    for finding in &plan.findings {
        out.push_str(&format!(
            "- [{:?}] {}: {} Fix: {}\n",
            finding.severity, finding.title, finding.detail, finding.action
        ));
    }

    out
}

fn trim_num(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
    }
}

/// Report whether generation is available and where the model lives.
#[tauri::command]
pub fn ai_engine_status(ai: State<'_, AiState>, app: AppHandle) -> IrodoriResult<AiEngineStatus> {
    let path = model_path(&app)?;
    let loaded = ai
        .inner
        .lock()
        .map(|inner| inner.model.is_some())
        .unwrap_or(false);
    Ok(AiEngineStatus {
        compiled: cfg!(feature = "llama"),
        model_present: path.exists(),
        loaded,
        model_file: DEFAULT_MODEL_FILE.to_string(),
        model_path: path.display().to_string(),
    })
}

/// Unload the embedded local model from memory, freeing its RAM at once. The next
/// local request reloads it lazily (cheap mmap), so this is a safe "stop" the user
/// can hit any time to reclaim resources without losing the ability to resume.
#[tauri::command]
pub fn ai_unload_local(ai: State<'_, AiState>) -> IrodoriResult<()> {
    let mut inner = ai
        .inner
        .lock()
        .map_err(|_| IrodoriError::new(IrodoriErrorKind::Internal, "ai state poisoned"))?;
    inner.model = None;
    inner.loaded_path = None;
    Ok(())
}

/// Delete the embedded model file from disk to reclaim storage. Unloads it first
/// so the file is no longer mmapped. A no-op (Ok) if the file is already gone.
#[tauri::command]
pub fn ai_delete_local_model(ai: State<'_, AiState>, app: AppHandle) -> IrodoriResult<()> {
    {
        let mut inner = ai
            .inner
            .lock()
            .map_err(|_| IrodoriError::new(IrodoriErrorKind::Internal, "ai state poisoned"))?;
        inner.model = None;
        inner.loaded_path = None;
    }
    let path = model_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| {
            IrodoriError::new(
                IrodoriErrorKind::Internal,
                format!("could not delete model at {}: {e}", path.display()),
            )
        })?;
    }
    Ok(())
}

/// Set the active generation/chat provider (local model, Ollama, an HTTP API, or a
/// CLI). The selection is persisted so it survives a restart: non-secret fields go
/// to a small JSON file in the app data dir, and the API key (if any) goes to the
/// OS keychain — so the user never re-enters it. A blank key leaves any stored key
/// untouched.
#[tauri::command]
pub fn ai_set_provider(
    ai: State<'_, AiState>,
    security: State<'_, SecurityState>,
    app: AppHandle,
    config: AiProviderConfig,
) -> IrodoriResult<()> {
    persist_provider(&app, &security, &config)?;

    // Resolve the in-memory key: use the freshly entered one, else fall back to
    // whatever is already in the keychain so the provider can authenticate now.
    let mut effective = config;
    if effective
        .api_key
        .as_deref()
        .map(|k| k.trim().is_empty())
        .unwrap_or(true)
    {
        effective.api_key = load_secret(&security);
    }

    let mut inner = ai
        .inner
        .lock()
        .map_err(|_| IrodoriError::new(IrodoriErrorKind::Internal, "ai state poisoned"))?;
    inner.provider = effective;
    Ok(())
}

/// Keychain handle for the AI provider API key (one shared slot, like the rest of
/// the AI provider config).
fn ai_secret_ref() -> IrodoriResult<irodori_core::SecretRef> {
    connection_secret_ref("ai-provider", SecretPurpose::Token)
        .map_err(|e| IrodoriError::new(IrodoriErrorKind::Internal, format!("secret ref: {e}")))
}

fn load_secret(security: &SecurityState) -> Option<String> {
    let secret = ai_secret_ref().ok()?;
    security.store().get(&secret).ok().flatten()
}

fn provider_config_path(app: &AppHandle) -> IrodoriResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Internal,
            format!("could not resolve app data dir: {e}"),
        )
    })?;
    Ok(dir.join("ai-provider.json"))
}

/// Write the provider selection: non-secret fields to JSON, the key to the keychain.
fn persist_provider(
    app: &AppHandle,
    security: &SecurityState,
    config: &AiProviderConfig,
) -> IrodoriResult<()> {
    let path = provider_config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            IrodoriError::new(
                IrodoriErrorKind::Internal,
                format!("create config dir: {e}"),
            )
        })?;
    }
    let mut sanitized = config.clone();
    sanitized.api_key = None;
    let json = serde_json::to_string_pretty(&sanitized).map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Internal,
            format!("serialize provider: {e}"),
        )
    })?;
    std::fs::write(&path, json).map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Internal,
            format!("write provider config: {e}"),
        )
    })?;

    if let Some(key) = config.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        let secret = ai_secret_ref()?;
        let value = SecretValue::new(key)
            .map_err(|e| IrodoriError::new(IrodoriErrorKind::Internal, format!("secret: {e}")))?;
        security.store().put(&secret, value).map_err(|e| {
            IrodoriError::new(IrodoriErrorKind::Internal, format!("store key: {e}"))
        })?;
    }
    Ok(())
}

/// Restore the persisted provider into memory at startup (called from the Tauri
/// `setup` hook). Best-effort: a missing/corrupt file just leaves the default.
pub fn hydrate_provider(app: &AppHandle, ai: &AiState, security: &SecurityState) {
    let Ok(path) = provider_config_path(app) else {
        return;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut config) = serde_json::from_str::<AiProviderConfig>(&text) else {
        return;
    };
    config.api_key = load_secret(security);
    if let Ok(mut inner) = ai.inner.lock() {
        inner.provider = config;
    }
}

/// Get the active provider with the API key stripped.
#[tauri::command]
pub fn ai_get_provider(ai: State<'_, AiState>) -> IrodoriResult<AiProviderConfig> {
    let inner = ai
        .inner
        .lock()
        .map_err(|_| IrodoriError::new(IrodoriErrorKind::Internal, "ai state poisoned"))?;
    let mut config = inner.provider.clone();
    config.api_key = None;
    Ok(config)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// Build the configured provider. Local is cached (mmapped model); the HTTP and
/// CLI providers are cheap to construct, so they're built per request.
fn build_provider(ai: &AiState, app: &AppHandle) -> IrodoriResult<Arc<dyn GrammarModel>> {
    let config = ai
        .inner
        .lock()
        .map(|inner| inner.provider.clone())
        .unwrap_or_default();

    match config.kind {
        AiProviderKind::Local => ensure_model(ai, app),
        AiProviderKind::Ollama => {
            if config.model.trim().is_empty() {
                return Err(IrodoriError::validation("an Ollama model name is required"));
            }
            let endpoint = config
                .endpoint
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            let model: Arc<dyn GrammarModel> =
                Arc::new(OllamaModel::new(HttpConfig::new(endpoint, config.model)));
            Ok(model)
        }
        AiProviderKind::OpenaiCompat => {
            let endpoint = config
                .endpoint
                .ok_or_else(|| IrodoriError::validation("an API endpoint is required"))?;
            if config.model.trim().is_empty() {
                return Err(IrodoriError::validation("a model id is required"));
            }
            let mut http = HttpConfig::new(endpoint, config.model);
            if let Some(key) = config.api_key {
                http = http.with_api_key(key);
            }
            let model: Arc<dyn GrammarModel> = Arc::new(OpenAiCompatModel::new(http));
            Ok(model)
        }
        AiProviderKind::Command => {
            if config.program.trim().is_empty() {
                return Err(IrodoriError::validation("a command program is required"));
            }
            let label = config.program.clone();
            let model: Arc<dyn GrammarModel> = Arc::new(CommandModel::new(CommandConfig::new(
                config.program,
                config.args,
                label,
            )));
            Ok(model)
        }
    }
}

fn model_path(app: &AppHandle) -> IrodoriResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Internal,
            format!("could not resolve app data dir: {e}"),
        )
    })?;
    Ok(dir.join("models").join(DEFAULT_MODEL_FILE))
}

fn ensure_model(ai: &AiState, app: &AppHandle) -> IrodoriResult<Arc<dyn GrammarModel>> {
    if !cfg!(feature = "llama") {
        return Err(IrodoriError::new(
            IrodoriErrorKind::Unsupported,
            "local AI generation is not available in this build",
        ));
    }
    if let Ok(inner) = ai.inner.lock() {
        if let Some(model) = &inner.model {
            return Ok(Arc::clone(model));
        }
    }

    let path = model_path(app)?;
    if !path.exists() {
        return Err(IrodoriError::new(
            IrodoriErrorKind::NotFound,
            format!(
                "local model not found at {}; preinstall it or choose another provider",
                path.display()
            ),
        ));
    }

    let model = load_model(&path)?;
    let arc: Arc<dyn GrammarModel> = Arc::from(model);
    if let Ok(mut inner) = ai.inner.lock() {
        inner.model = Some(Arc::clone(&arc));
        inner.loaded_path = Some(path);
    }
    Ok(arc)
}

#[cfg(feature = "llama")]
fn load_model(path: &Path) -> IrodoriResult<Box<dyn GrammarModel>> {
    let config = irodori_generate::llama::LlamaConfig::new(path);
    let model = irodori_generate::llama::LlamaSqlModel::load(config)?;
    Ok(Box::new(model))
}

#[cfg(not(feature = "llama"))]
fn load_model(_path: &Path) -> IrodoriResult<Box<dyn GrammarModel>> {
    Err(IrodoriError::new(
        IrodoriErrorKind::Unsupported,
        "local AI generation is not available in this build",
    ))
}

/// Build the configured provider as a streaming chat model. Mirrors
/// [`build_provider`]: Local reuses the cached embedded model (wrapped so its
/// single-shot completion satisfies the chat trait); the HTTP and CLI providers
/// stream natively and are cheap to construct per request.
pub(crate) fn build_chat_provider(
    ai: &AiState,
    app: &AppHandle,
) -> IrodoriResult<Arc<dyn ChatModel>> {
    let config = ai
        .inner
        .lock()
        .map(|inner| inner.provider.clone())
        .unwrap_or_default();

    match config.kind {
        AiProviderKind::Local => {
            let model = ensure_model(ai, app)?;
            Ok(Arc::new(GrammarChatAdapter::new(model)))
        }
        AiProviderKind::Ollama => {
            if config.model.trim().is_empty() {
                return Err(IrodoriError::validation("an Ollama model name is required"));
            }
            let endpoint = config
                .endpoint
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            Ok(Arc::new(OllamaModel::new(HttpConfig::new(
                endpoint,
                config.model,
            ))))
        }
        AiProviderKind::OpenaiCompat => {
            let endpoint = config
                .endpoint
                .ok_or_else(|| IrodoriError::validation("an API endpoint is required"))?;
            if config.model.trim().is_empty() {
                return Err(IrodoriError::validation("a model id is required"));
            }
            let mut http = HttpConfig::new(endpoint, config.model);
            if let Some(key) = config.api_key {
                http = http.with_api_key(key);
            }
            Ok(Arc::new(OpenAiCompatModel::new(http)))
        }
        AiProviderKind::Command => {
            if config.program.trim().is_empty() {
                return Err(IrodoriError::validation("a command program is required"));
            }
            let label = config.program.clone();
            Ok(Arc::new(CommandModel::new(CommandConfig::new(
                config.program,
                config.args,
                label,
            ))))
        }
    }
}

/// Register a chat session so it can be cancelled; returns its cancellation handle.
pub(crate) fn register_chat(ai: &AiState, session_id: &str) -> Arc<chat::ChatHandle> {
    let handle = Arc::new(chat::ChatHandle::default());
    if let Ok(mut chats) = ai.chats.lock() {
        chats.insert(session_id.to_string(), Arc::clone(&handle));
    }
    handle
}

/// Drop a finished chat session from the cancellation registry.
pub(crate) fn unregister_chat(ai: &AiState, session_id: &str) {
    if let Ok(mut chats) = ai.chats.lock() {
        chats.remove(session_id);
    }
}

/// Look up a live chat session's cancellation handle.
pub(crate) fn chat_handle(ai: &AiState, session_id: &str) -> Option<Arc<chat::ChatHandle>> {
    ai.chats.lock().ok()?.get(session_id).cloned()
}

/// Convert the completion metadata snapshot into the engine's schema shape.
pub(crate) fn snapshot_to_gen_schema(snapshot: &MetadataSnapshot) -> GenSchema {
    let mut tables = Vec::new();
    for schema in &snapshot.schemas {
        for object in &schema.objects {
            let kind = match object.kind {
                MetadataObjectKind::Table => RelationKind::Table,
                MetadataObjectKind::View | MetadataObjectKind::MaterializedView => {
                    RelationKind::View
                }
                // Non-relational objects don't belong in SELECT generation.
                MetadataObjectKind::Collection | MetadataObjectKind::Other => continue,
            };
            let columns = object
                .columns
                .iter()
                .map(|c| GenColumn {
                    name: c.name.clone(),
                    data_type: c.data_type.clone(),
                    nullable: c.nullable,
                })
                .collect();
            let primary_key = object
                .indexes
                .iter()
                .find(|index| index.primary)
                .map(|index| index.columns.clone())
                .unwrap_or_default();
            let foreign_keys = object
                .foreign_keys
                .iter()
                .map(|fk| GenForeignKey {
                    columns: fk.columns.clone(),
                    ref_schema: Some(fk.references_schema.clone()),
                    ref_table: fk.references_object.clone(),
                    ref_columns: fk.references_columns.clone(),
                })
                .collect();
            tables.push(GenTable {
                schema: Some(schema.name.clone()),
                name: object.name.clone(),
                kind,
                columns,
                primary_key,
                foreign_keys,
            });
        }
    }
    GenSchema {
        default_schema: snapshot.schemas.first().map(|s| s.name.clone()),
        tables,
    }
}
