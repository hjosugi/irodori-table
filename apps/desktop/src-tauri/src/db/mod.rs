//! Real database connectivity, split per engine behind a `Connection` trait.
//!
//! Each engine lives in its own submodule with its native pool/driver and
//! per-type decoder:
//!
//! - [`postgres`] / [`mysql`] / [`sqlite`] — native sqlx pools
//! - [`mssql`] — pure-Rust tiberius (TDS), no SQL Server client needed
//! - `duck` (behind `--features duckdb`) — embedded DuckDB
//!
//! The DBeaver-studied lesson drives the shape (SRC-001a): instead of a closed
//! `enum` matched at every call site, a live connection is an object behind the
//! [`Connection`] trait, and [`connect_engine`] is the single connector/registry
//! that maps an engine's wire protocol to a concrete client. Adding a wire-
//! compatible engine (CockroachDB, YugabyteDB, Redshift, TimescaleDB on Postgres;
//! MariaDB, TiDB on MySQL) is just a [`DbEngine`] variant; adding a new wire is a
//! `Connection` impl plus one connector arm. Value decoding stays native per
//! engine, with exact numerics/temporals rendered as strings to avoid precision
//! and timezone loss. Oracle awaits a pure-Rust thin TNS driver.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::security::SecurityState;
use irodori_completion::metadata::MetadataCache;

#[cfg(feature = "bigquery")]
mod bigquery;
#[cfg(feature = "bigtable")]
mod bigtable;
#[cfg(feature = "cassandra")]
mod cassandra;
mod clickhouse;
mod commands;
mod connection;
#[cfg(feature = "duckdb")]
mod duck;
mod edit;
mod engine;
mod influx;
mod meta;
#[cfg(feature = "mongo")]
mod mongo;
#[cfg(feature = "sqlserver")]
mod mssql;
mod mysql;
#[cfg(feature = "neo4j")]
mod neo4j;
#[cfg(feature = "oracle")]
mod oracle;
mod postgres;
mod profile;
mod query;
#[cfg(feature = "redis-connector")]
mod redis;
mod snowflake;
mod spill;
mod sqlite;
mod stream;
mod transport;

pub use commands::*;
use connection::{connect_engine, Connection};
pub use edit::{AppliedEdits, CellValue, RowDelete, RowInsert, RowUpdate, TableEdits};
pub use engine::DbEngine;
use meta::{convert_inspection_card, convert_metadata_to_snapshot, convert_snapshot_to_metadata};
pub use meta::{
    DbColumnInspection, DbColumnReference, DbCompletionItem, DbCompletionItemKind,
    DbInspectionCard, DbObjectInspection,
};
pub use profile::ConnectionProfile;
use profile::{normalize_profile, redact_secret_text};
pub(crate) use query::{
    bounded_query_cap, prepare_query, query_result_from_sets, query_result_set,
    split_sql_statements, PreparedQuery, RawResultSet, RowSet,
};
pub use query::{
    query_parameter_prompt_set, QueryParameterInput, QueryParameterKey, QueryParameterPrompt,
    QueryParameterPromptSet, QueryResult, QueryResultSet, QueryStreamEvent,
    QueryStreamResultSetSummary, ResultWindow, SpillRunResult,
};
use spill::ResultStore;
pub use spill::SpillConfig;

/// Default page size when the caller does not pass `max_rows`. Keeps memory
/// bounded so a `select *` over a 10M-row table cannot exhaust RAM (the
/// TablePlus problem). Full extraction goes through run-to-file (IO-001); a
/// later ticket adds optional disk offload for very large windows (EXEC-010).
pub(crate) const DEFAULT_MAX_ROWS: usize = 10_000;
pub(crate) const MAX_RESULT_ROWS: usize = 100_000;

/// Hard ceiling on rows retained by a disk-offloaded result (EXEC-010). Bounds
/// temp-file size and server work even when offload lets a result exceed the
/// interactive in-memory page.
pub(crate) const MAX_SPILL_ROWS: usize = 20_000_000;
/// Finished result stores kept for windowed paging before the oldest is evicted
/// (closing its temp file). One per recent run/tab is plenty.
const MAX_RETAINED_RESULTS: usize = 16;

const MAX_SQL_BYTES: usize = 4 * 1024 * 1024;

/// Rows per streamed batch. Small enough that the grid paints the first rows
/// almost immediately, large enough to keep the channel/event overhead low.
pub(crate) const STREAM_BATCH_ROWS: usize = 500;

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub(crate) fn audited_sql(sql: &str) -> sqlx::AssertSqlSafe<&str> {
    sqlx::AssertSqlSafe(sql)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub engine: DbEngine,
    pub server_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DatabaseMetadata {
    pub schemas: Vec<SchemaMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SchemaMetadata {
    pub name: String,
    pub objects: Vec<DbObjectMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DbObjectMetadata {
    pub schema: String,
    pub name: String,
    pub kind: DbObjectMetadataKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ddl: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub row_estimate: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sample: Option<DbQuickSample>,
    pub columns: Vec<ColumnMetadata>,
    pub indexes: Vec<IndexMetadata>,
    /// Primary-key column names in key order (empty when there is no PK). Used for
    /// safe edit keys and the ER diagram's key markers.
    #[serde(default)]
    pub primary_key: Vec<String>,
    /// Outgoing foreign keys — the edges of the ER diagram.
    #[serde(default)]
    pub foreign_keys: Vec<ForeignKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ForeignKey {
    pub columns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub references_schema: Option<String>,
    pub references_table: String,
    pub references_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DbQuickSample {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DbObjectMetadataKind {
    Table,
    View,
    Index,
    Procedure,
    Function,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub ordinal: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub default_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct IndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

/// Open connections keyed by connection id. Lives in Tauri managed state.
#[derive(Clone)]
pub struct DbState {
    conns: Arc<Mutex<HashMap<String, Arc<dyn Connection>>>>,
    /// In-flight cancellable queries keyed by a caller-supplied `query_id`, so
    /// `db_cancel` can stop a specific run. Entries are removed when the run ends.
    cancels: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub metadata_cache: Arc<Mutex<MetadataCache>>,
    tunnels: Arc<Mutex<HashMap<String, tokio_util::sync::CancellationToken>>>,
    /// Retained disk-offloaded results (EXEC-010), keyed by handle, for windowed
    /// paging. Bounded by `MAX_RETAINED_RESULTS`; evicting an entry closes its file.
    results: Arc<Mutex<HashMap<String, ResultEntry>>>,
    /// Monotonic counter for handle generation and oldest-first eviction.
    result_seq: Arc<std::sync::atomic::AtomicU64>,
}

/// A retained result store plus the bookkeeping eviction and disconnect-cleanup
/// need.
struct ResultEntry {
    seq: u64,
    connection_id: String,
    store: Arc<Mutex<ResultStore>>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            conns: Arc::new(Mutex::new(HashMap::new())),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            metadata_cache: Arc::new(Mutex::new(MetadataCache::new())),
            tunnels: Arc::new(Mutex::new(HashMap::new())),
            results: Arc::new(Mutex::new(HashMap::new())),
            result_seq: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
}

fn trigger_background_refresh(state: DbState, connection_id: String) {
    tokio::spawn(async move {
        let conn = {
            let guard = state.conns.lock().await;
            guard.get(&connection_id).cloned()
        };
        if let Some(conn) = conn {
            match conn.metadata().await {
                Ok(db_meta) => {
                    let mut cache = state.metadata_cache.lock().await;
                    let snapshot = convert_metadata_to_snapshot(&connection_id, &db_meta);
                    cache.upsert_snapshot(snapshot);
                    let _ = cache.drain_refresh_requests();
                }
                Err(e) => {
                    eprintln!(
                        "background metadata refresh failed for connection {connection_id}: {e}"
                    );
                }
            }
        }
    });
}

use irodori_proxy::start_forwarder;
use transport::resolve_transport;

pub async fn connect_impl(
    state: &DbState,
    security: &SecurityState,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    let mut profile = normalize_profile(profile)?;
    let mut resolved_tunnel = None;

    if let Some(transport) = &profile.transport {
        if !matches!(
            transport,
            irodori_core::TransportConfig::Direct(_) | irodori_core::TransportConfig::LocalFile(_)
        ) {
            let resolved = resolve_transport(security.store(), transport).await?;
            let (local_port, cancel_token) = start_forwarder(resolved)
                .await
                .map_err(|e| format!("failed to start local forwarder: {e}"))?;
            profile.host = Some("127.0.0.1".to_string());
            profile.port = Some(local_port);
            profile.url = None;
            resolved_tunnel = Some(cancel_token);
        }
    }

    let conn_res = connect_engine(&profile).await;
    let conn = match conn_res {
        Ok(conn) => conn,
        Err(error) => {
            if let Some(cancel_token) = resolved_tunnel {
                cancel_token.cancel();
            }
            return Err(redact_secret_text(&error, &profile));
        }
    };

    let server_version = conn.version().await.unwrap_or_else(|| "unknown".into());
    let old = state.conns.lock().await.insert(profile.id.clone(), conn);
    if let Some(old) = old {
        old.close().await;
    }

    if let Some(cancel_token) = resolved_tunnel {
        let old = state
            .tunnels
            .lock()
            .await
            .insert(profile.id.clone(), cancel_token);
        if let Some(old) = old {
            old.cancel();
        }
    }

    // Trigger background refresh immediately to warm up the cache!
    trigger_background_refresh(state.clone(), profile.id.clone());

    Ok(ConnectionInfo {
        id: profile.id,
        engine: profile.engine,
        server_version,
    })
}

/// Bound a query future by an optional wall-clock deadline. `None` preserves the
/// run-to-completion behavior; `Some(ms)` returns a clean timeout error if the
/// query has not finished, and dropping the future cancels the in-flight request
/// for the pooled (sqlx) engines. A non-positive value means "no limit".
async fn with_timeout<T>(
    timeout_ms: Option<u64>,
    fut: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    match timeout_ms.filter(|ms| *ms > 0) {
        Some(ms) => tokio::time::timeout(Duration::from_millis(ms), fut)
            .await
            .map_err(|_| format!("query timed out after {ms}ms"))?,
        None => fut.await,
    }
}

pub async fn run_query_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    run_query_with_params_impl(state, connection_id, sql, max_rows, None).await
}

pub async fn run_query_with_params_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    params: Option<Vec<QueryParameterInput>>,
) -> Result<QueryResult, String> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err("connection id is required".into());
    }
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err("query is empty".into());
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err(format!("query text must be at most {MAX_SQL_BYTES} bytes"));
    }
    // Clone the handle out of the lock so the query does not hold the mutex.
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };

    let cap = bounded_query_cap(max_rows)?;
    let prepared = prepare_query(conn.wire(), &sql, params.as_deref())?;
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
    Ok(query_result_from_sets(result_sets, elapsed_ms))
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
) -> Result<QueryResult, String> {
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
) -> Result<QueryResult, String> {
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
            _ = token.cancelled() => Err("query cancelled".to_string()),
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
) -> Result<stream::StreamSummary, String> {
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
) -> Result<stream::StreamSummary, String> {
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
) -> Result<stream::StreamSummary, String> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err("connection id is required".into());
    }
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err("query is empty".into());
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err(format!("query text must be at most {MAX_SQL_BYTES} bytes"));
    }
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };
    let prepared = prepare_query(conn.wire(), &sql, params.as_deref())?;

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
            _ = token.cancelled() => Err("query cancelled".to_string()),
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
) -> Result<SpillRunResult, String> {
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
        Ok::<(), String>(())
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
) -> Result<ResultWindow, String> {
    let store = {
        let results = state.results.lock().await;
        results
            .get(&handle)
            .map(|entry| entry.store.clone())
            .ok_or_else(|| format!("no such result: {handle}"))?
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
async fn release_results_for_connection(state: &DbState, connection_id: &str) {
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

pub async fn list_objects_impl(
    state: &DbState,
    connection_id: String,
) -> Result<DatabaseMetadata, String> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err("connection id is required".into());
    }

    let now = std::time::SystemTime::now();
    let (has_snapshot, is_stale) = {
        let mut cache = state.metadata_cache.lock().await;
        let has = cache.snapshot(&connection_id).is_some();
        let stale = has && cache.snapshot(&connection_id).unwrap().is_stale(now);
        cache.ensure_fresh(&connection_id, now);
        (has, stale)
    };

    if has_snapshot {
        if is_stale {
            trigger_background_refresh(state.clone(), connection_id.clone());
        }
        let cache = state.metadata_cache.lock().await;
        if let Some(snapshot) = cache.snapshot(&connection_id) {
            return Ok(convert_snapshot_to_metadata(snapshot));
        }
    }

    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };
    let db_meta = conn.metadata().await?;
    {
        let mut cache = state.metadata_cache.lock().await;
        let snapshot = convert_metadata_to_snapshot(&connection_id, &db_meta);
        cache.upsert_snapshot(snapshot);
        let _ = cache.drain_refresh_requests();
    }
    Ok(db_meta)
}

pub async fn apply_edits_impl(
    state: &DbState,
    connection_id: String,
    edits: TableEdits,
) -> Result<AppliedEdits, String> {
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };
    conn.apply_edits(&edits).await
}

pub async fn disconnect_impl(state: &DbState, connection_id: String) -> Result<(), String> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err("connection id is required".into());
    }
    if let Some(conn) = state.conns.lock().await.remove(&connection_id) {
        conn.close().await;
    }
    if let Some(cancel_token) = state.tunnels.lock().await.remove(&connection_id) {
        cancel_token.cancel();
    }
    release_results_for_connection(state, &connection_id).await;
    {
        let mut cache = state.metadata_cache.lock().await;
        cache.invalidate_connection(&connection_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
