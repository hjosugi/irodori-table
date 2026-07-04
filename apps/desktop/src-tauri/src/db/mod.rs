//! Real database connectivity, split per engine behind a `Connection` trait.
//!
//! Each engine lives in its own submodule with its native pool/driver and
//! per-type decoder:
//!
//! - [`postgres`] / [`mysql`] / [`sqlite`] — native sqlx pools
//! - [`mssql`] — pure-Rust tiberius (TDS), no SQL Server client needed
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

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::security::SecurityState;

#[cfg(feature = "bigquery")]
mod bigquery;
#[cfg(feature = "bigtable")]
mod bigtable;
#[cfg(feature = "cassandra")]
mod cassandra;
mod clickhouse;
mod commands;
mod connection;
mod edit;
mod engine;
mod error;
mod explain;
mod influx;
mod meta;
mod metadata_manager;
mod metadata_types;
mod migration;
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
mod query_executor;
#[cfg(feature = "redis-connector")]
mod redis;
mod result_spill_manager;
mod runner;
mod snowflake;
mod spill;
mod sqlite;
mod state;
mod stream;
mod transport;

pub use commands::*;
use connection::connect_engine;
pub use edit::{AppliedEdits, CellValue, RowDelete, RowInsert, RowUpdate, TableEdits};
pub use engine::{DbEngine, EngineBuildSupport};
pub use error::{DbError, DbResult};
pub use explain::{
    QueryPlanAnalysis, QueryPlanCopyFormat, QueryPlanEdge, QueryPlanFinding, QueryPlanFlameFrame,
    QueryPlanMetric, QueryPlanMetricGuide, QueryPlanMode, QueryPlanNode, QueryPlanProperty,
    QueryPlanSeverity, QueryPlanSource,
};
use meta::{convert_inspection_card, convert_snapshot_to_metadata};
pub use meta::{
    DbColumnInspection, DbColumnReference, DbCompletionItem, DbCompletionItemKind,
    DbInspectionCard, DbObjectInspection,
};
pub use metadata_types::{
    ColumnMetadata, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind, DbQuickSample,
    ForeignKey, IndexMetadata, SchemaMetadata,
};
pub use migration::*;
pub use profile::ConnectionProfile;
use profile::{normalize_profile, redact_secret_text};
pub use query::{
    query_parameter_prompt_set, QueryParameterInput, QueryParameterKey, QueryParameterPrompt,
    QueryParameterPromptSet, QueryResult, QueryResultSet, QueryStreamEvent,
    QueryStreamResultSetSummary, ResultWindow, SpillRunResult,
};
pub(crate) use query::{split_sql_statements, PreparedQuery, RawResultSet, RowSet};
#[cfg(test)]
pub(crate) use query::{sql_may_change_metadata, sql_may_write};
pub(crate) use runner::{
    bounded_spill_config, run_query_spill_impl, run_query_stream_with_params_impl,
};
pub use runner::{
    cancel_query_impl, explain_query_impl, release_result_impl, result_window_impl, run_query_impl,
    run_query_managed_impl, run_query_managed_with_params_impl, run_query_with_params_impl,
};
#[cfg(test)]
pub(crate) use runner::{run_query_stream_impl, with_timeout};
pub use spill::SpillConfig;
pub use state::DbState;
use state::{
    ensure_connection_writable, metadata_generation, trigger_background_refresh,
    upsert_metadata_snapshot_if_current,
};

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
pub(crate) const MAX_SQL_BYTES: usize = 4 * 1024 * 1024;

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

use irodori_proxy::start_forwarder;
use transport::resolve_transport;

pub async fn connect_impl(
    state: &DbState,
    security: &SecurityState,
    app: Option<&tauri::AppHandle>,
    profile: ConnectionProfile,
) -> DbResult<ConnectionInfo> {
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
                .map_err(|e| DbError::transport(format!("failed to start local forwarder: {e}")))?;
            profile.host = Some("127.0.0.1".to_string());
            profile.port = Some(local_port);
            profile.url = None;
            resolved_tunnel = Some(cancel_token);
        }
    }

    let conn_res = connect_engine(&profile, app).await;
    let conn = match conn_res {
        Ok(conn) => conn,
        Err(error) => {
            if let Some(cancel_token) = resolved_tunnel {
                cancel_token.cancel();
            }
            let redacted = redact_secret_text(error.message(), &profile);
            return Err(error.with_message(redacted));
        }
    };

    let server_version = conn.version().await.unwrap_or_else(|| "unknown".into());
    let connection_id = profile.id.clone();
    let read_only = profile.read_only;
    let old = state.conns.lock().await.insert(connection_id.clone(), conn);
    if let Some(old) = old {
        old.close().await;
    }
    {
        let mut read_only_connections = state.read_only_connections.lock().await;
        if read_only {
            read_only_connections.insert(connection_id.clone());
        } else {
            read_only_connections.remove(&connection_id);
        }
    }

    if let Some(cancel_token) = resolved_tunnel {
        let old = state
            .tunnels
            .lock()
            .await
            .insert(connection_id.clone(), cancel_token);
        if let Some(old) = old {
            old.cancel();
        }
    }

    // Trigger background refresh immediately to warm up the cache!
    trigger_background_refresh(state.clone(), connection_id.clone());

    Ok(ConnectionInfo {
        id: connection_id,
        engine: profile.engine,
        server_version,
    })
}

pub async fn list_objects_impl(
    state: &DbState,
    connection_id: String,
) -> DbResult<DatabaseMetadata> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err(DbError::validation("connection id is required"));
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
            .ok_or_else(|| DbError::not_found(format!("no open connection: {connection_id}")))?
    };
    let generation = metadata_generation(state);
    let db_meta = conn.metadata().await?;
    let _ = upsert_metadata_snapshot_if_current(state, &connection_id, &db_meta, generation).await;
    Ok(db_meta)
}

pub async fn apply_edits_impl(
    state: &DbState,
    connection_id: String,
    edits: TableEdits,
) -> DbResult<AppliedEdits> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err(DbError::validation("connection id is required"));
    }
    ensure_connection_writable(state, &connection_id).await?;
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| DbError::not_found(format!("no open connection: {connection_id}")))?
    };
    conn.apply_edits(&edits).await
}

pub async fn disconnect_impl(state: &DbState, connection_id: String) -> DbResult<()> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err(DbError::validation("connection id is required"));
    }
    if let Some(conn) = state.conns.lock().await.remove(&connection_id) {
        conn.close().await;
    }
    if let Some(cancel_token) = state.tunnels.lock().await.remove(&connection_id) {
        cancel_token.cancel();
    }
    state
        .read_only_connections
        .lock()
        .await
        .remove(&connection_id);
    state
        .result_spill_manager()
        .release_for_connection(&connection_id)
        .await;
    {
        let mut cache = state.metadata_cache.lock().await;
        cache.invalidate_connection(&connection_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
