use std::collections::BTreeMap;
use std::time::Instant;

use irodori_core::{AuditEventKind, IrodoriError, Result as IrodoriResult};
use tokio::sync::mpsc;

use crate::security::SecurityState;

use super::*;

#[tauri::command]
pub async fn db_autocomplete(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    prefix: String,
    schema: Option<String>,
    object: Option<String>,
    limit: Option<usize>,
) -> IrodoriResult<Vec<DbCompletionItem>> {
    Ok(state
        .inner()
        .metadata_manager()
        .autocomplete(connection_id, prefix, schema, object, limit)
        .await)
}

#[tauri::command]
pub async fn db_inspect_object(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    object: String,
) -> IrodoriResult<Option<DbInspectionCard>> {
    Ok(state
        .inner()
        .metadata_manager()
        .inspect_object(connection_id, schema, object)
        .await)
}

#[tauri::command]
pub async fn db_inspect_column(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    object: String,
    column: String,
) -> IrodoriResult<Option<DbInspectionCard>> {
    Ok(state
        .inner()
        .metadata_manager()
        .inspect_column(connection_id, schema, object, column)
        .await)
}

#[tauri::command]
pub async fn db_invalidate_cache(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: Option<String>,
    object: Option<String>,
) -> IrodoriResult<bool> {
    Ok(state
        .inner()
        .metadata_manager()
        .invalidate_cache(connection_id, schema, object)
        .await)
}

// ---- Tauri commands -----------------------------------------------------------

#[tauri::command]
pub async fn db_connect(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    profile: ConnectionProfile,
) -> IrodoriResult<ConnectionInfo> {
    let connection_id = profile.id.clone();
    let engine = format!("{:?}", profile.engine);
    let started = Instant::now();
    match connect_impl(state.inner(), security.inner(), profile).await {
        Ok(info) => {
            security
                .record(
                    AuditEventKind::ConnectionOpen,
                    Some(info.id.clone()),
                    format!("opened {engine} connection"),
                    BTreeMap::from([
                        (
                            "elapsedMs".to_string(),
                            started.elapsed().as_millis().to_string(),
                        ),
                        ("serverVersion".to_string(), info.server_version.clone()),
                    ]),
                )
                .await;
            Ok(info)
        }
        Err(error) => {
            security
                .record(
                    AuditEventKind::ConnectionFailed,
                    Some(connection_id),
                    error.clone(),
                    BTreeMap::from([("engine".to_string(), engine)]),
                )
                .await;
            Err(IrodoriError::from(error))
        }
    }
}

#[tauri::command]
pub async fn db_query_parameters(sql: String) -> IrodoriResult<QueryParameterPromptSet> {
    query_parameter_prompt_set(&sql).map_err(IrodoriError::from)
}

#[tauri::command]
pub async fn db_explain_query(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    connection_id: String,
    sql: String,
    mode: QueryPlanMode,
) -> IrodoriResult<QueryPlanAnalysis> {
    let audit_connection_id = connection_id.clone();
    let audit_sql = sql.clone();
    match state
        .inner()
        .query_executor()
        .explain(connection_id, sql, mode)
        .await
    {
        Ok(plan) => {
            security
                .record(
                    AuditEventKind::QueryRun,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([
                        ("planMode".to_string(), format!("{:?}", plan.mode)),
                        ("planSource".to_string(), format!("{:?}", plan.source)),
                        ("planNodes".to_string(), plan.nodes.len().to_string()),
                    ]),
                )
                .await;
            Ok(plan)
        }
        Err(error) => {
            security
                .record(
                    AuditEventKind::QueryFailed,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([("error".to_string(), error.clone())]),
                )
                .await;
            Err(IrodoriError::from(error))
        }
    }
}

#[tauri::command]
pub async fn db_run_query(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
) -> IrodoriResult<QueryResult> {
    // The managed run applies the optional timeout deadline and registers the
    // optional `query_id` so `db_cancel` can stop this specific statement.
    let audit_connection_id = connection_id.clone();
    let audit_sql = sql.clone();
    match state
        .inner()
        .query_executor()
        .run_managed_with_params(connection_id, sql, max_rows, timeout_ms, query_id, params)
        .await
    {
        Ok(result) => {
            security
                .record(
                    AuditEventKind::QueryRun,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([
                        ("rowCount".to_string(), result.row_count.to_string()),
                        ("elapsedMs".to_string(), result.elapsed_ms.to_string()),
                        ("truncated".to_string(), result.truncated.to_string()),
                    ]),
                )
                .await;
            Ok(result)
        }
        Err(error) => {
            security
                .record(
                    AuditEventKind::QueryFailed,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([("error".to_string(), error.clone())]),
                )
                .await;
            Err(IrodoriError::from(error))
        }
    }
}

/// Cancel the in-flight query the UI started under `query_id`. Returns `true` when
/// a matching run was found and signalled, `false` if it already finished.
#[tauri::command]
pub async fn db_cancel(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    query_id: String,
) -> IrodoriResult<bool> {
    let cancelled = state
        .inner()
        .query_executor()
        .cancel(query_id.clone())
        .await;
    if cancelled {
        security
            .record(
                AuditEventKind::QueryCancel,
                None,
                "query cancelled",
                BTreeMap::from([("queryId".to_string(), query_id)]),
            )
            .await;
    }
    Ok(cancelled)
}

/// Run a query and stream its rows to the frontend over `on_event` (columns →
/// batched rows → done/error) so the grid fills incrementally. Honors the same
/// optional `timeout_ms`/`query_id` as `db_run_query`; `db_cancel(query_id)` stops
/// it mid-stream. The fetch and the channel-forwarding run concurrently so batches
/// reach the UI as they are produced.
#[tauri::command]
pub async fn db_run_query_stream(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
    on_event: tauri::ipc::Channel<QueryStreamEvent>,
) -> IrodoriResult<()> {
    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let started = Instant::now();
    let audit_connection_id = connection_id.clone();
    let audit_sql = sql.clone();

    let fetch = state.inner().query_executor().stream_with_params(
        connection_id,
        sql,
        max_rows,
        timeout_ms,
        query_id,
        params,
        tx,
    );
    let forward = async {
        while let Some(event) = rx.recv().await {
            let out = match event {
                stream::FetchEvent::Columns {
                    result_set_index,
                    columns,
                } => QueryStreamEvent::Columns {
                    result_set_index,
                    columns,
                },
                stream::FetchEvent::Rows {
                    result_set_index,
                    rows,
                } => QueryStreamEvent::Rows {
                    result_set_index,
                    rows,
                },
            };
            on_event
                .send(out)
                .map_err(|e| IrodoriError::transport(e.to_string()))?;
        }
        Ok::<(), IrodoriError>(())
    };

    let (summary, forwarded) = tokio::join!(fetch, forward);
    forwarded?;
    let final_event = match summary {
        Ok(s) => {
            let elapsed_ms = started.elapsed().as_millis() as u64;
            security
                .record(
                    AuditEventKind::QueryRun,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([
                        ("rowCount".to_string(), s.row_count.to_string()),
                        ("elapsedMs".to_string(), elapsed_ms.to_string()),
                        ("truncated".to_string(), s.truncated.to_string()),
                    ]),
                )
                .await;
            QueryStreamEvent::Done {
                row_count: s.row_count,
                truncated: s.truncated,
                elapsed_ms,
                result_sets: s
                    .result_sets
                    .into_iter()
                    .map(|set| QueryStreamResultSetSummary {
                        result_set_index: set.result_set_index,
                        row_count: set.row_count,
                        elapsed_ms: set.elapsed_ms,
                        truncated: set.truncated,
                    })
                    .collect(),
            }
        }
        Err(message) => {
            security
                .record(
                    AuditEventKind::QueryFailed,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([("error".to_string(), message.clone())]),
                )
                .await;
            QueryStreamEvent::Error { message }
        }
    };
    on_event
        .send(final_event)
        .map_err(|e| IrodoriError::transport(e.to_string()))?;
    Ok(())
}

/// Run a query with bounded-memory disk offload (EXEC-010). The resident first
/// page streams to `on_event` (columns → rows) for an immediate paint exactly like
/// `db_run_query_stream`, while the full result is retained behind a temp-SQLite
/// store. The returned [`SpillRunResult`] carries the `handle` the grid uses to
/// page the rest from disk via `db_result_window`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn db_run_query_spill(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    connection_id: String,
    sql: String,
    memory_budget: Option<usize>,
    offload_enabled: Option<bool>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
    on_event: tauri::ipc::Channel<QueryStreamEvent>,
) -> IrodoriResult<SpillRunResult> {
    let config = bounded_spill_config(memory_budget, offload_enabled);
    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let audit_connection_id = connection_id.clone();
    let audit_sql = sql.clone();

    let fetch = state.inner().result_spill_manager().run_query_spill(
        connection_id,
        sql,
        config,
        timeout_ms,
        query_id,
        params,
        tx,
    );
    let forward = async {
        while let Some(event) = rx.recv().await {
            let out = match event {
                stream::FetchEvent::Columns {
                    result_set_index,
                    columns,
                } => QueryStreamEvent::Columns {
                    result_set_index,
                    columns,
                },
                stream::FetchEvent::Rows {
                    result_set_index,
                    rows,
                } => QueryStreamEvent::Rows {
                    result_set_index,
                    rows,
                },
            };
            on_event
                .send(out)
                .map_err(|e| IrodoriError::transport(e.to_string()))?;
        }
        Ok::<(), IrodoriError>(())
    };

    let (outcome, forwarded) = tokio::join!(fetch, forward);
    forwarded?;
    match outcome {
        Ok(result) => {
            security
                .record(
                    AuditEventKind::QueryRun,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([
                        ("rowCount".to_string(), result.total_rows.to_string()),
                        (
                            "inMemoryRows".to_string(),
                            result.in_memory_rows.to_string(),
                        ),
                        ("spilled".to_string(), result.spilled.to_string()),
                        ("elapsedMs".to_string(), result.elapsed_ms.to_string()),
                        ("truncated".to_string(), result.truncated.to_string()),
                    ]),
                )
                .await;
            Ok(result)
        }
        Err(error) => {
            security
                .record(
                    AuditEventKind::QueryFailed,
                    Some(audit_connection_id),
                    audit_sql,
                    BTreeMap::from([("error".to_string(), error.clone())]),
                )
                .await;
            Err(IrodoriError::from(error))
        }
    }
}

/// Read one page of a retained disk-offloaded result for the grid (EXEC-010).
#[tauri::command]
pub async fn db_result_window(
    state: tauri::State<'_, DbState>,
    handle: String,
    offset: u64,
    limit: usize,
) -> IrodoriResult<ResultWindow> {
    state
        .inner()
        .result_spill_manager()
        .result_window(handle, offset, limit)
        .await
        .map_err(IrodoriError::from)
}

/// Release a retained disk-offloaded result, removing its temp file (EXEC-010).
#[tauri::command]
pub async fn db_release_result(
    state: tauri::State<'_, DbState>,
    handle: String,
) -> IrodoriResult<bool> {
    Ok(state
        .inner()
        .result_spill_manager()
        .release_result(handle)
        .await)
}

/// Commit staged result-grid edits (updates/inserts/deletes) for one table in a
/// single transaction; returns how many rows each kind affected.
#[tauri::command]
pub async fn db_apply_edits(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    edits: TableEdits,
) -> IrodoriResult<AppliedEdits> {
    apply_edits_impl(state.inner(), connection_id, edits)
        .await
        .map_err(IrodoriError::from)
}

#[tauri::command]
pub async fn db_list_objects(
    state: tauri::State<'_, DbState>,
    connection_id: String,
) -> IrodoriResult<DatabaseMetadata> {
    state
        .inner()
        .metadata_manager()
        .list_objects(connection_id)
        .await
        .map_err(IrodoriError::from)
}

#[tauri::command]
pub async fn db_disconnect(
    state: tauri::State<'_, DbState>,
    security: tauri::State<'_, SecurityState>,
    connection_id: String,
) -> IrodoriResult<()> {
    let audit_connection_id = connection_id.clone();
    disconnect_impl(state.inner(), connection_id)
        .await
        .map_err(IrodoriError::from)?;
    security
        .record(
            AuditEventKind::ConnectionClose,
            Some(audit_connection_id),
            "closed connection",
            BTreeMap::new(),
        )
        .await;
    Ok(())
}
