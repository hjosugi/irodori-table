use serde::{Deserialize, Serialize};
use sql_dialect_fmt_formatter::{format as format_snowflake_sql, Dialect, FormatOptions};
use ts_rs::TS;

pub mod ai;
pub mod db;
pub mod git;
pub mod indexing;
pub mod jobs;
pub mod pty;
pub mod security;

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
enum DbObjectKind {
    Table,
    View,
    Procedure,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
enum ConnectionStatus {
    Connected,
    Idle,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
struct DbObject {
    name: String,
    kind: DbObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    rows: Option<String>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
struct Connection {
    id: String,
    name: String,
    engine: String,
    status: ConnectionStatus,
    latency_ms: u16,
    proxy: String,
    objects: Vec<DbObject>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    connections: Vec<Connection>,
    active_connection_id: String,
}

#[tauri::command]
fn workspace_snapshot() -> WorkspaceSnapshot {
    // Ship an empty workspace: the app starts with no sample connections or
    // objects. Users add their own connection through the Connection Manager.
    WorkspaceSnapshot {
        active_connection_id: String::new(),
        connections: Vec::new(),
    }
}

#[tauri::command]
fn open_developer_tools(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
        Err("Developer Tools are available in development builds.".into())
    }
}

#[tauri::command]
fn sql_format_snowflake(
    sql: String,
    line_width: Option<usize>,
    indent_width: Option<usize>,
    uppercase_keywords: Option<bool>,
) -> Result<String, String> {
    let options = FormatOptions::default()
        .with_dialect(Dialect::Snowflake)
        .with_line_width(line_width.unwrap_or(100))
        .with_indent_width(indent_width.unwrap_or(4))
        .with_uppercase_keywords(uppercase_keywords.unwrap_or(true));
    Ok(format_snowflake_sql(&sql, &options))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(db::DbState::default())
        .manage(jobs::JobState::default())
        .manage(indexing::SchemaIndexState::default())
        .manage(security::SecurityState::default())
        .manage(ai::AiState::default())
        .manage(pty::PtyState::default())
        .setup(|app| {
            // Restore the persisted AI provider (selection + keychain API key) so
            // the user doesn't reconfigure it on every launch.
            use tauri::Manager;
            let handle = app.handle().clone();
            let ai = app.state::<ai::AiState>();
            let security = app.state::<security::SecurityState>();
            ai::hydrate_provider(&handle, &ai, &security);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            open_developer_tools,
            sql_format_snowflake,
            jobs::jobs_list,
            jobs::jobs_get,
            indexing::db_search_schema,
            db::db_engine_build_support,
            db::db_connect,
            db::db_query_parameters,
            db::db_explain_query,
            db::db_run_query,
            db::db_run_query_stream,
            db::db_run_query_spill,
            db::db_result_window,
            db::db_release_result,
            db::db_cancel,
            db::db_apply_edits,
            db::migration_build_plan,
            db::db_list_objects,
            db::db_disconnect,
            db::db_autocomplete,
            db::db_inspect_object,
            db::db_inspect_column,
            db::db_invalidate_cache,
            git::git_status,
            git::git_log,
            git::git_diff,
            git::git_commit_all,
            git::git_commit_staged,
            git::git_push,
            git::git_fetch,
            git::git_pull,
            git::git_stage_files,
            git::git_unstage_files,
            git::git_discard_files,
            git::git_checkout_branch,
            git::git_delete_branch,
            security::security_get_privacy_mode,
            security::security_set_privacy_mode,
            security::security_redact_text,
            security::security_export_audit,
            security::security_store_secret,
            security::security_delete_secret,
            security::network_transport_plan,
            security::network_diagnose_transport,
            ai::ai_generate_sql,
            ai::ai_explain_plan,
            ai::ai_engine_status,
            ai::ai_set_provider,
            ai::ai_get_provider,
            ai::chat::ai_chat,
            ai::chat::ai_chat_cancel,
            ai::ai_unload_local,
            ai::ai_delete_local_model,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod typegen {
    use super::*;
    use std::fs;
    use std::path::Path;
    use typeship::ir::{Decl, TsType};
    use typeship::{Arg, Bridge, Command};
    use typeship_ts_rs::decl;

    const GENERATED: &str = "../src/generated/irodori-api.ts";

    fn normalized_bindings(contents: &str) -> String {
        let mut normalized = contents
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n");
        normalized.push('\n');
        normalized
    }

    /// The single source of truth for the desktop TypeScript boundary.
    ///
    /// Each Rust type is rendered by ts-rs via [`decl`]; `typeship` assembles the
    /// module header, the typed Tauri command wrappers, and (in CI) the drift
    /// check. `JsonValue` is a hand-declared alias because `serde_json::Value`
    /// renders to a bare `JsonValue` reference under ts-rs's `serde-json-impl`.
    fn bridge() -> Bridge {
        Bridge::tauri()
            .header("// @generated by cargo test export_typescript_bindings. Do not edit.")
            .decl(&Decl::alias("JsonValue", TsType::unknown()))
            .decl(&decl::<irodori_core::IrodoriErrorKind>())
            .decl(&decl::<irodori_core::IrodoriError>())
            .decl(&decl::<irodori_core::CommandResult<serde_json::Value>>())
            .decl(&decl::<irodori_core::JobKind>())
            .decl(&decl::<irodori_core::JobStatus>())
            .decl(&decl::<irodori_core::JobLogLevel>())
            .decl(&decl::<irodori_core::JobRetryPolicy>())
            .decl(&decl::<irodori_core::JobConcurrencyPolicy>())
            .decl(&decl::<irodori_core::JobResourceBudget>())
            .decl(&decl::<irodori_core::JobSpec>())
            .decl(&decl::<irodori_core::JobProgress>())
            .decl(&decl::<irodori_core::JobCheckpoint>())
            .decl(&decl::<irodori_core::JobArtifact>())
            .decl(&decl::<irodori_core::JobLogEntry>())
            .decl(&decl::<irodori_core::JobRecord>())
            .decl(&decl::<irodori_core::JobSummary>())
            .decl(&decl::<irodori_core::JobList>())
            .decl(&decl::<irodori_core::JobRuntimeConfig>())
            .decl(&decl::<irodori_core::PrivacyMode>())
            .decl(&decl::<irodori_core::RedactionReport>())
            .decl(&decl::<irodori_core::RedactedExport>())
            .decl(&decl::<irodori_core::SecretRef>())
            .decl(&decl::<irodori_core::TransportConfig>())
            .decl(&decl::<irodori_core::DirectTransport>())
            .decl(&decl::<irodori_core::LocalFileTransport>())
            .decl(&decl::<irodori_core::SshTunnelTransport>())
            .decl(&decl::<irodori_core::SshAuthConfig>())
            .decl(&decl::<irodori_core::ProxyTransport>())
            .decl(&decl::<irodori_core::ProxyAuthConfig>())
            .decl(&decl::<irodori_core::ProxyChainTransport>())
            .decl(&decl::<irodori_core::ProxyChainHop>())
            .decl(&decl::<irodori_core::ProxyHopConfig>())
            .decl(&decl::<irodori_core::SshProxyHop>())
            .decl(&decl::<irodori_proxy::DialTarget>())
            .decl(&decl::<irodori_proxy::TransportStepKind>())
            .decl(&decl::<irodori_proxy::TransportStep>())
            .decl(&decl::<irodori_proxy::TransportPlan>())
            .decl(&decl::<irodori_proxy::DiagnosticStageKind>())
            .decl(&decl::<irodori_proxy::DiagnosticStatus>())
            .decl(&decl::<irodori_proxy::DiagnosticStage>())
            .decl(&decl::<irodori_proxy::ConnectionDiagnostics>())
            .decl(&decl::<security::DesktopSecretPurpose>())
            .decl(&decl::<ai::AiGenerateResult>())
            .decl(&decl::<ai::AiEngineStatus>())
            .decl(&decl::<ai::AiProviderKind>())
            .decl(&decl::<ai::AiProviderConfig>())
            .decl(&decl::<DbObjectKind>())
            .decl(&decl::<ConnectionStatus>())
            .decl(&decl::<DbObject>())
            .decl(&decl::<Connection>())
            .decl(&decl::<WorkspaceSnapshot>())
            .decl(&decl::<db::DbEngine>())
            .decl(&decl::<db::EngineBuildSupport>())
            .decl(&decl::<db::ConnectionProfile>())
            .decl(&decl::<db::ConnectionInfo>())
            .decl(&decl::<db::QueryResultSet>())
            .decl(&decl::<db::QueryResult>())
            .decl(&decl::<db::SpillRunResult>())
            .decl(&decl::<db::ResultWindow>())
            .decl(&decl::<db::QueryParameterKey>())
            .decl(&decl::<db::QueryParameterInput>())
            .decl(&decl::<db::QueryParameterPrompt>())
            .decl(&decl::<db::QueryParameterPromptSet>())
            .decl(&decl::<db::QueryPlanMode>())
            .decl(&decl::<db::QueryPlanSource>())
            .decl(&decl::<db::QueryPlanSeverity>())
            .decl(&decl::<db::QueryPlanProperty>())
            .decl(&decl::<db::QueryPlanNode>())
            .decl(&decl::<db::QueryPlanEdge>())
            .decl(&decl::<db::QueryPlanFlameFrame>())
            .decl(&decl::<db::QueryPlanMetric>())
            .decl(&decl::<db::QueryPlanFinding>())
            .decl(&decl::<db::QueryPlanMetricGuide>())
            .decl(&decl::<db::QueryPlanCopyFormat>())
            .decl(&decl::<db::QueryPlanAnalysis>())
            .decl(&decl::<db::DatabaseMetadata>())
            .decl(&decl::<db::SchemaMetadata>())
            .decl(&decl::<db::ForeignKey>())
            .decl(&decl::<db::DbQuickSample>())
            .decl(&decl::<db::DbObjectMetadata>())
            .decl(&decl::<db::DbObjectMetadataKind>())
            .decl(&decl::<db::ColumnMetadata>())
            .decl(&decl::<db::IndexMetadata>())
            .decl(&decl::<db::CellValue>())
            .decl(&decl::<db::RowUpdate>())
            .decl(&decl::<db::RowInsert>())
            .decl(&decl::<db::RowDelete>())
            .decl(&decl::<db::TableEdits>())
            .decl(&decl::<db::AppliedEdits>())
            .decl(&decl::<db::MigrationPlanExportFormat>())
            .decl(&decl::<db::MigrationPlanInput>())
            .decl(&decl::<db::MigrationPlanTaskLevel>())
            .decl(&decl::<db::MigrationPlanTask>())
            .decl(&decl::<db::MigrationPlanOutput>())
            .decl(&decl::<db::DbCompletionItem>())
            .decl(&decl::<db::DbCompletionItemKind>())
            .decl(&decl::<db::DbInspectionCard>())
            .decl(&decl::<db::DbObjectInspection>())
            .decl(&decl::<db::DbColumnInspection>())
            .decl(&decl::<db::DbColumnReference>())
            .decl(&decl::<indexing::SchemaSearchHit>())
            .decl(&decl::<git::GitChangeKind>())
            .decl(&decl::<git::GitRemoteProvider>())
            .decl(&decl::<git::GitFileStatus>())
            .decl(&decl::<git::GitCommitSummary>())
            .decl(&decl::<git::GitRemoteSummary>())
            .decl(&decl::<git::GitBranchSummary>())
            .decl(&decl::<git::GitStatusSummary>())
            .decl(&decl::<git::GitDiffResult>())
            .decl(&decl::<git::GitCommandOutput>())
            .command(Command::new("workspace_snapshot", "WorkspaceSnapshot"))
            .command(Command::returning("open_developer_tools", TsType::void()))
            .command(
                Command::new("sql_format_snowflake", "string")
                    .arg(Arg::new("sql", TsType::string()))
                    .arg(Arg::rust("line_width", TsType::number()).optional())
                    .arg(Arg::rust("indent_width", TsType::number()).optional())
                    .arg(Arg::rust("uppercase_keywords", TsType::boolean()).optional()),
            )
            .command(Command::new("jobs_list", "JobList"))
            .command(
                Command::new("jobs_get", "JobRecord | null")
                    .arg(Arg::rust("job_id", TsType::string())),
            )
            .command(
                Command::new("db_search_schema", "Array<SchemaSearchHit>")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("term", TsType::string()))
                    .arg(Arg::rust("limit", TsType::number()).optional()),
            )
            .command(Command::new(
                "db_engine_build_support",
                "Array<EngineBuildSupport>",
            ))
            .command(
                Command::new("db_connect", "ConnectionInfo")
                    .arg(Arg::new("profile", TsType::named("ConnectionProfile"))),
            )
            .command(
                Command::new("db_query_parameters", "QueryParameterPromptSet")
                    .arg(Arg::new("sql", TsType::string())),
            )
            .command(
                Command::new("db_explain_query", "QueryPlanAnalysis")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("sql", TsType::string()))
                    .arg(Arg::new("mode", TsType::named("QueryPlanMode"))),
            )
            .command(
                Command::new("db_run_query", "QueryResult")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("sql", TsType::string()))
                    .arg(Arg::rust("max_rows", TsType::number()).optional())
                    .arg(Arg::rust("timeout_ms", TsType::number()).optional())
                    .arg(Arg::rust("query_id", TsType::string()).optional())
                    .arg(
                        Arg::new("params", TsType::named("Array<QueryParameterInput>")).optional(),
                    ),
            )
            .command(
                Command::returning("db_cancel", TsType::boolean())
                    .arg(Arg::rust("query_id", TsType::string())),
            )
            // `db_run_query_spill` takes a streaming `Channel`, so (like
            // `db_run_query_stream`) its wrapper is hand-written in `db-stream.ts`;
            // only its read/release companions are generated here. The
            // `SpillRunResult` / `ResultWindow` types are declared above so the
            // hand-written wrapper stays typed.
            .command(
                Command::new("db_result_window", "ResultWindow")
                    .arg(Arg::new("handle", TsType::string()))
                    .arg(Arg::new("offset", TsType::number()))
                    .arg(Arg::new("limit", TsType::number())),
            )
            .command(
                Command::returning("db_release_result", TsType::boolean())
                    .arg(Arg::new("handle", TsType::string())),
            )
            .command(
                Command::new("db_apply_edits", "AppliedEdits")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("edits", TsType::named("TableEdits"))),
            )
            .command(
                Command::new("migration_build_plan", "MigrationPlanOutput")
                    .arg(Arg::new("input", TsType::named("MigrationPlanInput"))),
            )
            .command(
                Command::new("db_list_objects", "DatabaseMetadata")
                    .arg(Arg::rust("connection_id", TsType::string())),
            )
            .command(
                Command::returning("db_disconnect", TsType::void())
                    .arg(Arg::rust("connection_id", TsType::string())),
            )
            .command(
                Command::new("db_autocomplete", "Array<DbCompletionItem>")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("prefix", TsType::string()))
                    .arg(Arg::rust("schema", TsType::string()).optional())
                    .arg(Arg::rust("object", TsType::string()).optional())
                    .arg(Arg::rust("limit", TsType::number()).optional()),
            )
            .command(
                Command::new("db_inspect_object", "DbInspectionCard | null")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("schema", TsType::string()))
                    .arg(Arg::new("object", TsType::string())),
            )
            .command(
                Command::new("db_inspect_column", "DbInspectionCard | null")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("schema", TsType::string()))
                    .arg(Arg::new("object", TsType::string()))
                    .arg(Arg::new("column", TsType::string())),
            )
            .command(
                Command::returning("db_invalidate_cache", TsType::boolean())
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::rust("schema", TsType::string()).optional())
                    .arg(Arg::rust("object", TsType::string()).optional()),
            )
            .command(
                Command::new("git_status", "GitStatusSummary")
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_log", "Array<GitCommitSummary>")
                    .arg(Arg::rust("repo_path", TsType::string()).optional())
                    .arg(Arg::new("limit", TsType::number()).optional()),
            )
            .command(
                Command::new("git_diff", "GitDiffResult")
                    .arg(Arg::rust("repo_path", TsType::string()).optional())
                    .arg(Arg::rust("file_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_commit_all", "GitCommandOutput")
                    .arg(Arg::new("message", TsType::string()))
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_commit_staged", "GitCommandOutput")
                    .arg(Arg::new("message", TsType::string()))
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_push", "GitCommandOutput")
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_fetch", "GitCommandOutput")
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_pull", "GitCommandOutput")
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_stage_files", "GitCommandOutput")
                    .arg(Arg::new("paths", TsType::named("Array<string>")))
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_unstage_files", "GitCommandOutput")
                    .arg(Arg::new("paths", TsType::named("Array<string>")))
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_discard_files", "GitCommandOutput")
                    .arg(Arg::new("paths", TsType::named("Array<string>")))
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_checkout_branch", "GitCommandOutput")
                    .arg(Arg::new("branch", TsType::string()))
                    .arg(Arg::new("create", TsType::boolean()).optional())
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(
                Command::new("git_delete_branch", "GitCommandOutput")
                    .arg(Arg::new("branch", TsType::string()))
                    .arg(Arg::new("force", TsType::boolean()).optional())
                    .arg(Arg::rust("repo_path", TsType::string()).optional()),
            )
            .command(Command::new("security_get_privacy_mode", "PrivacyMode"))
            .command(
                Command::new("security_set_privacy_mode", "PrivacyMode")
                    .arg(Arg::new("mode", TsType::named("PrivacyMode"))),
            )
            .command(
                Command::new("security_redact_text", "RedactionReport")
                    .arg(Arg::new("text", TsType::string())),
            )
            .command(Command::new("security_export_audit", "RedactedExport"))
            .command(
                Command::new("security_store_secret", "SecretRef")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("purpose", TsType::named("DesktopSecretPurpose")))
                    .arg(Arg::new("value", TsType::string())),
            )
            .command(
                Command::returning("security_delete_secret", TsType::void())
                    .arg(Arg::new("secret", TsType::named("SecretRef"))),
            )
            .command(
                Command::new("network_transport_plan", "TransportPlan")
                    .arg(Arg::new("transport", TsType::named("TransportConfig"))),
            )
            .command(
                Command::new("network_diagnose_transport", "ConnectionDiagnostics")
                    .arg(Arg::new("transport", TsType::named("TransportConfig"))),
            )
            .command(
                Command::new("ai_generate_sql", "AiGenerateResult")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("prompt", TsType::string()))
                    .arg(Arg::new("engine", TsType::named("DbEngine"))),
            )
            .command(
                Command::new("ai_explain_plan", "string")
                    .arg(Arg::new("plan", TsType::named("QueryPlanAnalysis"))),
            )
            .command(Command::new("ai_engine_status", "AiEngineStatus"))
            .command(
                Command::returning("ai_set_provider", TsType::void())
                    .arg(Arg::new("config", TsType::named("AiProviderConfig"))),
            )
            .command(Command::new("ai_get_provider", "AiProviderConfig"))
    }

    /// Locally (and through `npm run typegen`) this regenerates the committed
    /// bindings. Under `CI` it instead asserts they are up to date, turning a Rust
    /// type change without a regenerate into a failing build.
    #[test]
    fn export_typescript_bindings() {
        let rendered = bridge().render();
        let path = Path::new(GENERATED);
        let normalized = normalized_bindings(&rendered.contents);

        if std::env::var_os("CI").is_some() {
            let committed = fs::read_to_string(path).expect("read generated bindings");
            assert!(
                normalized == committed,
                "stale bindings: {GENERATED} differs after normalization — run `npm run typegen` and commit the result"
            );
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("create generated bindings directory");
            }
            fs::write(path, normalized).expect("write generated bindings");
        }
    }
}
