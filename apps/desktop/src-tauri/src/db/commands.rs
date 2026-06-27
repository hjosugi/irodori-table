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
    let state_inner = state.inner();
    let now = std::time::SystemTime::now();

    let needs_immediate_fetch = {
        let mut cache = state_inner.metadata_cache.lock().await;
        !cache.ensure_fresh(&connection_id, now)
    };

    if needs_immediate_fetch {
        let conn = {
            let guard = state_inner.conns.lock().await;
            guard.get(&connection_id).cloned()
        };
        if let Some(conn) = conn {
            let generation = metadata_generation(state_inner);
            if let Ok(db_meta) = conn.metadata().await {
                let _ = upsert_metadata_snapshot_if_current(
                    state_inner,
                    &connection_id,
                    &db_meta,
                    generation,
                )
                .await;
            }
        }
    } else {
        let is_stale = {
            let cache = state_inner.metadata_cache.lock().await;
            cache
                .snapshot(&connection_id)
                .map(|s| s.is_stale(now))
                .unwrap_or(false)
        };
        if is_stale {
            trigger_background_refresh(state_inner.clone(), connection_id.clone());
        }
    }

    let cache = state_inner.metadata_cache.lock().await;
    let engine = irodori_completion::CompletionEngine::new();
    let mut req = irodori_completion::CompletionRequest::new(&connection_id).with_prefix(prefix);
    if let Some(s) = schema {
        req = req.in_schema(s);
    }
    if let Some(o) = object {
        req = req.for_object(o);
    }
    if let Some(l) = limit {
        req.limit = l;
    }

    let items = engine.complete(&cache, &req);
    let mapped = items
        .into_iter()
        .map(|item| DbCompletionItem {
            label: item.label,
            insert_text: item.insert_text,
            kind: match item.kind {
                irodori_completion::CompletionItemKind::Schema => DbCompletionItemKind::Schema,
                irodori_completion::CompletionItemKind::Table => DbCompletionItemKind::Table,
                irodori_completion::CompletionItemKind::View => DbCompletionItemKind::View,
                irodori_completion::CompletionItemKind::Column => DbCompletionItemKind::Column,
                irodori_completion::CompletionItemKind::Function => DbCompletionItemKind::Function,
                irodori_completion::CompletionItemKind::Procedure => {
                    DbCompletionItemKind::Procedure
                }
                irodori_completion::CompletionItemKind::Keyword => DbCompletionItemKind::Keyword,
            },
            detail: item.detail,
        })
        .collect();

    Ok(mapped)
}

#[tauri::command]
pub async fn db_inspect_object(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    object: String,
) -> IrodoriResult<Option<DbInspectionCard>> {
    let state_inner = state.inner();
    let cache = state_inner.metadata_cache.lock().await;
    let card =
        irodori_completion::inspection::inspect_object(&cache, &connection_id, &schema, &object);
    Ok(card.map(convert_inspection_card))
}

#[tauri::command]
pub async fn db_inspect_column(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: String,
    object: String,
    column: String,
) -> IrodoriResult<Option<DbInspectionCard>> {
    let state_inner = state.inner();
    let cache = state_inner.metadata_cache.lock().await;
    let card = irodori_completion::inspection::inspect_column(
        &cache,
        &connection_id,
        &schema,
        &object,
        &column,
    );
    Ok(card.map(convert_inspection_card))
}

#[tauri::command]
pub async fn db_invalidate_cache(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    schema: Option<String>,
    object: Option<String>,
) -> IrodoriResult<bool> {
    let state_inner = state.inner();
    let mut cache = state_inner.metadata_cache.lock().await;
    let invalidated = if let Some(obj) = object {
        if let Some(sch) = schema {
            cache.invalidate_object(&connection_id, &sch, &obj)
        } else {
            false
        }
    } else if let Some(sch) = schema {
        cache.invalidate_schema(&connection_id, &sch)
    } else {
        cache.invalidate_connection(&connection_id)
    };

    if invalidated {
        trigger_background_refresh(state_inner.clone(), connection_id);
    }

    Ok(invalidated)
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
    match run_query_managed_with_params_impl(
        state.inner(),
        connection_id,
        sql,
        max_rows,
        timeout_ms,
        query_id,
        params,
    )
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
    let cancelled = cancel_query_impl(state.inner(), query_id.clone()).await;
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

    let fetch = run_query_stream_with_params_impl(
        state.inner(),
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

    let fetch = run_query_spill_impl(
        state.inner(),
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
    result_window_impl(state.inner(), handle, offset, limit)
        .await
        .map_err(IrodoriError::from)
}

/// Release a retained disk-offloaded result, removing its temp file (EXEC-010).
#[tauri::command]
pub async fn db_release_result(
    state: tauri::State<'_, DbState>,
    handle: String,
) -> IrodoriResult<bool> {
    Ok(release_result_impl(state.inner(), handle).await)
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
    list_objects_impl(state.inner(), connection_id)
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
