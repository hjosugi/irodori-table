use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

use super::error::{DbError, DbResult};
use super::explain;
use super::query::{
    bounded_query_cap, prepare_query, query_result_from_sets, query_result_set, sql_may_write,
    RawResultSet,
};
use super::result_spill_manager::ResultEntry;
use super::spill::{ResultStore, SpillConfig};
use super::state::{ensure_connection_can_run_sql, MAX_RETAINED_RESULTS};
use super::{
    stream, DbState, QueryParameterInput, QueryPlanAnalysis, QueryPlanMode, QueryResult,
    ResultWindow, SpillRunResult, DEFAULT_MAX_ROWS, MAX_RESULT_ROWS, MAX_SPILL_ROWS, MAX_SQL_BYTES,
    STREAM_BATCH_ROWS,
};

/// Bound a query future by an optional wall-clock deadline. `None` preserves the
/// run-to-completion behavior; `Some(ms)` returns a clean timeout error if the
/// query has not finished, and dropping the future cancels the in-flight request
/// for the pooled (sqlx) engines. A non-positive value means "no limit".
pub(crate) async fn with_timeout<T>(
    timeout_ms: Option<u64>,
    fut: impl Future<Output = DbResult<T>>,
) -> DbResult<T> {
    match timeout_ms.filter(|ms| *ms > 0) {
        Some(ms) => tokio::time::timeout(Duration::from_millis(ms), fut)
            .await
            .map_err(|_| DbError::timeout(format!("query timed out after {ms}ms")))?,
        None => fut.await,
    }
}

pub async fn run_query_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> DbResult<QueryResult> {
    run_query_with_params_impl(state, connection_id, sql, max_rows, None).await
}

pub async fn run_query_with_params_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    params: Option<Vec<QueryParameterInput>>,
) -> DbResult<QueryResult> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err(DbError::validation("connection id is required"));
    }
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err(DbError::validation("query is empty"));
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err(DbError::validation(format!(
            "query text must be at most {MAX_SQL_BYTES} bytes"
        )));
    }
    // Clone the handle out of the lock so the query does not hold the mutex.
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| DbError::not_found(format!("no open connection: {connection_id}")))?
    };
    ensure_connection_can_run_sql(state, &connection_id, &sql).await?;

    let cap = bounded_query_cap(max_rows)?;
    let prepared = prepare_query(conn.wire(), &sql, params.as_deref())?;
    let metadata_sql = prepared.sql.clone();
    let start = Instant::now();
    let sets = if prepared.params.is_empty() {
        conn.run_query_sets(&prepared.sql, cap).await?
    } else {
        let (columns, rows, truncated) = conn.run_prepared_query(&prepared, cap).await?;
        vec![RawResultSet {
            statement_index: 0,
            statement: sql,
            columns,
            rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
        }]
    };
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let result_sets = sets
        .into_iter()
        .map(|set| query_result_set(set, cap))
        .collect();
    state
        .metadata_manager()
        .refresh_after_query_if_needed(&connection_id, &metadata_sql)
        .await;
    Ok(query_result_from_sets(result_sets, elapsed_ms))
}

pub async fn explain_query_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    mode: QueryPlanMode,
) -> DbResult<QueryPlanAnalysis> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err(DbError::validation("connection id is required"));
    }
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err(DbError::validation("query is empty"));
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err(DbError::validation(format!(
            "query text must be at most {MAX_SQL_BYTES} bytes"
        )));
    }
    if mode == QueryPlanMode::Analyze && sql_may_write(&sql) {
        return Err(DbError::validation(
            "Explain Analyse is blocked for write statements because it can execute the statement",
        ));
    }

    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| DbError::not_found(format!("no open connection: {connection_id}")))?
    };
    match conn.explain_query(&sql, mode).await {
        Ok(plan) => Ok(plan),
        Err(error) => {
            Ok(explain::static_analysis(conn.wire(), &sql, mode)
                .with_native_error(error.to_string()))
        }
    }
}

/// Run a query under the lifecycle controls the UI needs: an optional `timeout_ms`
/// deadline and an optional `query_id` that registers a [`CancellationToken`] so a
/// concurrent [`cancel_query_impl`] (the `db_cancel` command) can stop it. A
/// timeout or a cancel both drop the query future, which cancels the in-flight
/// request on the pooled engines. The token is always deregistered when the run
/// ends, including on the error/timeout paths.
pub async fn run_query_managed_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
) -> DbResult<QueryResult> {
    run_query_managed_with_params_impl(
        state,
        connection_id,
        sql,
        max_rows,
        timeout_ms,
        query_id,
        None,
    )
    .await
}

pub async fn run_query_managed_with_params_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
) -> DbResult<QueryResult> {
    let token = CancellationToken::new();
    if let Some(qid) = &query_id {
        state
            .cancels
            .lock()
            .await
            .insert(qid.clone(), token.clone());
    }

    let run = async {
        tokio::select! {
            biased;
            _ = token.cancelled() => Err(DbError::cancelled("query cancelled")),
            result = run_query_with_params_impl(state, connection_id, sql, max_rows, params) => result,
        }
    };
    let result = with_timeout(timeout_ms, run).await;

    if let Some(qid) = &query_id {
        state.cancels.lock().await.remove(qid);
    }
    result
}

/// Signal a running query (registered under `query_id` by
/// [`run_query_managed_impl`]) to stop. Returns whether a matching in-flight query
/// was found; a no-op `false` when the id is unknown or the run already finished.
pub async fn cancel_query_impl(state: &DbState, query_id: String) -> bool {
    if let Some(token) = state.cancels.lock().await.remove(&query_id) {
        token.cancel();
        true
    } else {
        false
    }
}

/// Streaming twin of [`run_query_managed_impl`]: rows flow out incrementally
/// through `sink` (the `db_run_query_stream` command forwards them to a Tauri
/// channel) instead of being buffered into a `QueryResult`. Applies the same
/// optional timeout + `query_id` cancellation, and always deregisters the token.
/// Tauri-free so it can be unit-tested with an `mpsc` receiver.
#[cfg(test)]
pub(crate) async fn run_query_stream_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    sink: mpsc::Sender<stream::FetchEvent>,
) -> DbResult<stream::StreamSummary> {
    run_query_stream_with_params_impl(
        state,
        connection_id,
        sql,
        max_rows,
        timeout_ms,
        query_id,
        None,
        sink,
    )
    .await
}

pub(crate) async fn run_query_stream_with_params_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
    sink: mpsc::Sender<stream::FetchEvent>,
) -> DbResult<stream::StreamSummary> {
    let cap = bounded_query_cap(max_rows)?;
    run_query_stream_capped_impl(
        state,
        connection_id,
        sql,
        cap,
        timeout_ms,
        query_id,
        params,
        sink,
    )
    .await
}

/// Streaming core shared by the regular stream command and the disk-offload
/// (EXEC-010) path. Identical to [`run_query_stream_with_params_impl`] except the
/// caller passes an explicit row `cap` instead of going through
/// [`bounded_query_cap`], so the spill path can fetch far past the interactive
/// 100k page limit while the resident page stays bounded.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_query_stream_capped_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    cap: usize,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
    sink: mpsc::Sender<stream::FetchEvent>,
) -> DbResult<stream::StreamSummary> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err(DbError::validation("connection id is required"));
    }
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err(DbError::validation("query is empty"));
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err(DbError::validation(format!(
            "query text must be at most {MAX_SQL_BYTES} bytes"
        )));
    }
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| DbError::not_found(format!("no open connection: {connection_id}")))?
    };
    ensure_connection_can_run_sql(state, &connection_id, &sql).await?;
    let prepared = prepare_query(conn.wire(), &sql, params.as_deref())?;
    let metadata_sql = prepared.sql.clone();

    let token = CancellationToken::new();
    if let Some(qid) = &query_id {
        state
            .cancels
            .lock()
            .await
            .insert(qid.clone(), token.clone());
    }
    let ctx = stream::StreamCtx {
        cap,
        batch_rows: STREAM_BATCH_ROWS,
        result_set_index: 0,
        token: token.clone(),
        sink,
    };

    let run = async {
        tokio::select! {
            biased;
            _ = token.cancelled() => Err(DbError::cancelled("query cancelled")),
            result = async {
                if prepared.params.is_empty() {
                    conn.stream_query_sets(&prepared.sql, &ctx).await
                } else {
                    conn.stream_prepared_query(&prepared, &ctx).await
                }
            } => result,
        }
    };
    let result = with_timeout(timeout_ms, run).await;

    if let Some(qid) = &query_id {
        state.cancels.lock().await.remove(qid);
    }
    if result.is_ok() {
        state
            .metadata_manager()
            .refresh_after_query_if_needed(&connection_id, &metadata_sql)
            .await;
    }
    result
}

/// Clamp UI-supplied offload settings into a safe [`SpillConfig`]. The memory
/// budget is bounded to the interactive page limit, and the hard ceiling caps
/// total retained rows regardless of what the UI requests.
pub(crate) fn bounded_spill_config(
    memory_budget: Option<usize>,
    offload_enabled: Option<bool>,
) -> SpillConfig {
    let memory_budget = memory_budget
        .unwrap_or(DEFAULT_MAX_ROWS)
        .clamp(1, MAX_RESULT_ROWS);
    SpillConfig {
        memory_budget,
        offload_enabled: offload_enabled.unwrap_or(true),
        max_total_rows: MAX_SPILL_ROWS,
    }
}

/// Run a query, retaining the full result behind a disk-offloaded [`ResultStore`]
/// (EXEC-010) while streaming only the in-memory prefix to the UI over `ui_sink`.
///
/// The producer (engine stream) and the consumer (append-to-store + forward the
/// prefix) run concurrently, so the first page paints as it arrives even while the
/// rest of a huge result is still spilling to disk. On completion the store is
/// finalized and registered under a fresh handle, and a [`SpillRunResult`] returns
/// the handle, total row count, and resident-page size.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_query_spill_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    config: SpillConfig,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    params: Option<Vec<QueryParameterInput>>,
    ui_sink: mpsc::Sender<stream::FetchEvent>,
) -> DbResult<SpillRunResult> {
    let started = Instant::now();
    let store = Arc::new(Mutex::new(ResultStore::new(Vec::new(), config)));
    let (prod_tx, mut prod_rx) = mpsc::channel::<stream::FetchEvent>(16);

    let producer = run_query_stream_capped_impl(
        state,
        connection_id.clone(),
        sql,
        config.fetch_cap(),
        timeout_ms,
        query_id,
        params,
        prod_tx,
    );

    let consume_store = store.clone();
    let consumer = async move {
        let budget = config.memory_budget as u64;
        // Absolute row index of the next streamed row in result set 0.
        let mut set0_seen: u64 = 0;
        while let Some(event) = prod_rx.recv().await {
            match event {
                stream::FetchEvent::Columns {
                    result_set_index,
                    columns,
                } => {
                    if result_set_index == 0 {
                        consume_store.lock().await.set_columns(columns.clone());
                    }
                    // Forwarding failures (UI channel gone) are non-fatal: keep
                    // spilling so the retained store stays complete for paging.
                    let _ = ui_sink
                        .send(stream::FetchEvent::Columns {
                            result_set_index,
                            columns,
                        })
                        .await;
                }
                stream::FetchEvent::Rows {
                    result_set_index,
                    rows,
                } => {
                    if result_set_index == 0 {
                        // Forward only the still-missing slice of the resident page.
                        if set0_seen < budget {
                            let take = ((budget - set0_seen) as usize).min(rows.len());
                            if take > 0 {
                                let _ = ui_sink
                                    .send(stream::FetchEvent::Rows {
                                        result_set_index,
                                        rows: rows[..take].to_vec(),
                                    })
                                    .await;
                            }
                        }
                        let produced = rows.len() as u64;
                        consume_store.lock().await.append(rows).await?;
                        set0_seen += produced;
                    } else {
                        // Extra result sets (rare under spill) stream through whole.
                        let _ = ui_sink
                            .send(stream::FetchEvent::Rows {
                                result_set_index,
                                rows,
                            })
                            .await;
                    }
                }
            }
        }
        Ok::<(), DbError>(())
    };

    let (producer_result, consumer_result) = tokio::join!(producer, consumer);
    consumer_result?;
    let summary = producer_result?;

    let (total, columns, in_memory, spilled, truncated) = {
        let mut guard = store.lock().await;
        guard.finalize().await?;
        (
            guard.total(),
            guard.columns().to_vec(),
            guard.memory_len() as u64,
            guard.spilled(),
            guard.truncated() || summary.truncated,
        )
    };
    let handle = register_result(state, &connection_id, store).await;

    Ok(SpillRunResult {
        handle,
        columns,
        total_rows: total,
        in_memory_rows: in_memory,
        spilled,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// Register a finished store under a fresh handle, evicting the oldest retained
/// result (and closing its temp file) when over `MAX_RETAINED_RESULTS`.
async fn register_result(
    state: &DbState,
    connection_id: &str,
    store: Arc<Mutex<ResultStore>>,
) -> String {
    let seq = state
        .result_seq
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let handle = format!("result-{seq}");
    let evicted = {
        let mut results = state.results.lock().await;
        results.insert(
            handle.clone(),
            ResultEntry {
                seq,
                connection_id: connection_id.to_string(),
                store,
            },
        );
        if results.len() > MAX_RETAINED_RESULTS {
            // Evict the oldest by sequence.
            let oldest = results
                .iter()
                .min_by_key(|(_, entry)| entry.seq)
                .map(|(key, _)| key.clone());
            oldest.and_then(|key| results.remove(&key))
        } else {
            None
        }
    };
    if let Some(entry) = evicted {
        entry.store.lock().await.close().await;
    }
    handle
}

/// Read one page `[offset, offset+limit)` of a retained result, transparently
/// reading resident rows from RAM and spilled rows from disk.
pub async fn result_window_impl(
    state: &DbState,
    handle: String,
    offset: u64,
    limit: usize,
) -> DbResult<ResultWindow> {
    let store = {
        let results = state.results.lock().await;
        results
            .get(&handle)
            .map(|entry| entry.store.clone())
            .ok_or_else(|| DbError::not_found(format!("no such result: {handle}")))?
    };
    let limit = limit.min(MAX_RESULT_ROWS);
    let rows = store.lock().await.window(offset, limit).await?;
    Ok(ResultWindow { offset, rows })
}

/// Release a retained result, closing its temp file. Idempotent.
pub async fn release_result_impl(state: &DbState, handle: String) -> bool {
    let entry = state.results.lock().await.remove(&handle);
    if let Some(entry) = entry {
        entry.store.lock().await.close().await;
        true
    } else {
        false
    }
}

/// Release every retained result for a connection (called on disconnect).
pub(super) async fn release_results_for_connection(state: &DbState, connection_id: &str) {
    let evicted: Vec<ResultEntry> = {
        let mut results = state.results.lock().await;
        let keys: Vec<String> = results
            .iter()
            .filter(|(_, entry)| entry.connection_id == connection_id)
            .map(|(key, _)| key.clone())
            .collect();
        keys.into_iter()
            .filter_map(|key| results.remove(&key))
            .collect()
    };
    for entry in evicted {
        entry.store.lock().await.close().await;
    }
}
