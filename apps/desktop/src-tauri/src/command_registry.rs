use serde::{Deserialize, Serialize};
use sql_dialect_fmt_formatter::{format as format_snowflake_sql, Dialect, FormatOptions};
use ts_rs::TS;

use crate::{ai, crash_report, db, extensions, git, indexing, jobs, pty, security};

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub(crate) enum DbObjectKind {
    Table,
    View,
    Procedure,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub(crate) enum ConnectionStatus {
    Connected,
    Idle,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub(crate) struct DbObject {
    name: String,
    kind: DbObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    rows: Option<String>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub(crate) struct Connection {
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
pub(crate) struct WorkspaceSnapshot {
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

pub(crate) fn invoke_handler() -> Box<tauri::ipc::InvokeHandler<tauri::Wry>> {
    Box::new(tauri::generate_handler![
        workspace_snapshot,
        open_developer_tools,
        sql_format_snowflake,
        crash_report::crash_report_status,
        jobs::jobs_list,
        jobs::jobs_get,
        jobs::jobs_cancel,
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
        extensions::ext_list,
        extensions::ext_install,
        extensions::ext_uninstall,
        extensions::ext_set_enabled,
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
}
