//! AI-001 — local, grammar-constrained SQL generation commands.
//!
//! Thin Tauri layer over the `irodori-generate` engine: it turns the live schema
//! (the completion metadata cache) into the engine's [`GenSchema`], runs the
//! grammar-constrained generator, and returns SQL the caller inserts into the
//! editor. It never executes the SQL. The embedded model is opt-in (cargo feature
//! `llama`) and loaded lazily; without it (or without a downloaded model) the
//! commands fail cleanly so the deterministic completion path is unaffected.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use irodori_completion::{MetadataObjectKind, MetadataSnapshot};
use irodori_core::{
    run_job, BatchOutcome, BatchResult, IrodoriError, IrodoriErrorKind, JobArtifact, JobKind,
    JobLogLevel, JobRuntime, JobSpec, Result as IrodoriResult,
};
use irodori_generate::{
    generate, CommandConfig, CommandModel, GenColumn, GenForeignKey, GenSchema, GenTable,
    GenerateRequest, GrammarModel, HttpConfig, OllamaModel, OpenAiCompatModel, RelationKind,
};

use crate::db::{DbEngine, DbState};
use crate::jobs::JobState;

/// Default local model: small, strong at text-to-SQL, CPU-friendly (~0.4 GB).
const DEFAULT_MODEL_FILE: &str = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";
const DEFAULT_MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";

/// Lazily-loaded engine handle, shared across commands.
#[derive(Default)]
pub struct AiState {
    inner: Mutex<AiInner>,
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
    pub download_url: String,
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
        download_url: DEFAULT_MODEL_URL.to_string(),
    })
}

/// Download the default model in the background; returns the job id to watch in
/// the jobs dashboard.
#[tauri::command]
pub async fn ai_download_model(jobs: State<'_, JobState>, app: AppHandle) -> IrodoriResult<String> {
    let path = model_path(&app)?;
    if path.exists() {
        return Err(IrodoriError::validation("the model is already downloaded"));
    }
    let url = DEFAULT_MODEL_URL.to_string();
    let spec = JobSpec {
        source: Some(url.clone()),
        tags: vec!["ai".to_string(), "model".to_string()],
        ..JobSpec::new(
            JobKind::Other,
            format!("download model: {DEFAULT_MODEL_FILE}"),
        )
    };
    let record = jobs.runtime().submit(spec)?;
    let job_id = record.id.clone();

    let runtime = jobs.runtime_arc();
    let spawned = job_id.clone();
    tokio::spawn(async move {
        let _ = download_model_job(&runtime, &spawned, &url, &path).await;
    });
    Ok(job_id)
}

/// Set the active generation provider (local model, Ollama, an HTTP API, or a CLI).
#[tauri::command]
pub fn ai_set_provider(ai: State<'_, AiState>, config: AiProviderConfig) -> IrodoriResult<()> {
    let mut inner = ai
        .inner
        .lock()
        .map_err(|_| IrodoriError::new(IrodoriErrorKind::Internal, "ai state poisoned"))?;
    inner.provider = config;
    Ok(())
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
                "local model not found at {}; download it from settings first",
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

/// Convert the completion metadata snapshot into the engine's schema shape.
fn snapshot_to_gen_schema(snapshot: &MetadataSnapshot) -> GenSchema {
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

async fn download_model_job(
    runtime: &JobRuntime,
    job_id: &str,
    url: &str,
    path: &Path,
) -> IrodoriResult<()> {
    let url = url.to_string();
    let path = path.to_path_buf();
    run_job(runtime, job_id, move |ctx| async move {
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                IrodoriError::new(IrodoriErrorKind::Internal, format!("create dir: {e}"))
            })?;
        }
        ctx.log(JobLogLevel::Info, format!("downloading {url}"))?;

        let response = reqwest::get(&url)
            .await
            .map_err(|e| IrodoriError::transport(format!("download request failed: {e}")))?;
        if !response.status().is_success() {
            return Err(IrodoriError::transport(format!(
                "download failed: HTTP {}",
                response.status()
            )));
        }
        let total = response.content_length();

        let tmp = path.with_extension("part");
        let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| {
            IrodoriError::new(IrodoriErrorKind::Internal, format!("create file: {e}"))
        })?;

        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if ctx.should_cancel() {
                drop(file);
                let _ = tokio::fs::remove_file(&tmp).await;
                return Ok(BatchResult::new(
                    BatchOutcome::cancelled("download cancelled"),
                    (),
                ));
            }
            let chunk =
                chunk.map_err(|e| IrodoriError::transport(format!("download error: {e}")))?;
            file.write_all(&chunk).await.map_err(|e| {
                IrodoriError::new(IrodoriErrorKind::Internal, format!("write: {e}"))
            })?;
            downloaded += chunk.len() as u64;
            ctx.report_progress(downloaded, total, "bytes", "downloading model")?;
        }
        file.flush().await.ok();
        drop(file);
        tokio::fs::rename(&tmp, &path)
            .await
            .map_err(|e| IrodoriError::new(IrodoriErrorKind::Internal, format!("finalize: {e}")))?;

        let artifact = JobArtifact {
            id: "model".to_string(),
            name: DEFAULT_MODEL_FILE.to_string(),
            path: path.display().to_string(),
            media_type: Some("application/octet-stream".to_string()),
            size_bytes: Some(downloaded),
        };
        Ok(BatchResult::new(
            BatchOutcome::completed_with(format!("downloaded {downloaded} bytes"), vec![artifact]),
            (),
        ))
    })
    .await?;
    Ok(())
}
