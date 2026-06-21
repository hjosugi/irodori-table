//! Real database connectivity, split per engine.
//!
//! This file owns the shared types and the dispatch layer; each engine lives in
//! its own submodule with its native pool/driver and per-type decoder:
//!
//! - [`postgres`] / [`mysql`] / [`sqlite`] — native sqlx pools
//! - [`mssql`] — pure-Rust tiberius (TDS), no SQL Server client needed
//! - `duck` (behind `--features duckdb`) — embedded DuckDB
//!
//! Postgres-wire engines (CockroachDB, YugabyteDB, Redshift, TimescaleDB) and
//! MySQL-wire engines (MariaDB, TiDB) reuse those drivers; routing lives in
//! [`engine`]. Oracle awaits a pure-Rust thin TNS driver (no Instant Client).
//!
//! The Beekeeper-studied lesson drives the shape: keep dispatch/registry engine-
//! agnostic, but route value decoding through native drivers by column type and
//! force exact numerics/temporals to strings to avoid precision/timezone loss.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

mod engine;
mod mssql;
mod mysql;
mod postgres;
mod sqlite;
#[cfg(feature = "duckdb")]
mod duck;

pub use engine::DbEngine;
use engine::Wire;

/// One query's decoded result: `(column names, rows of JSON cells, truncated)`.
pub(crate) type RowSet = (Vec<String>, Vec<Vec<serde_json::Value>>, bool);

/// Default page size when the caller does not pass `max_rows`. Keeps memory
/// bounded so a `select *` over a 10M-row table cannot exhaust RAM (the
/// TablePlus problem). Full extraction goes through run-to-file (IO-001); a
/// later ticket adds optional disk offload for very large windows (EXEC-010).
pub(crate) const DEFAULT_MAX_ROWS: usize = 10_000;

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// How to reach a database. Either give structured fields or a raw `url`/DSN.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub engine: DbEngine,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub database: Option<String>,
    /// Raw connection URL/DSN. Overrides the structured fields when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub url: Option<String>,
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
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub elapsed_ms: u64,
    /// True when the result was capped at `max_rows` and more rows remain on the
    /// server, so the UI can offer "load more" / run-to-file instead of silently
    /// hiding data.
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

/// A live connection: one native pool/handle, tagged by engine. Cloneable
/// because every pool is an `Arc` handle.
#[derive(Clone)]
enum EnginePool {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    SqlServer(Arc<Mutex<mssql::MssqlClient>>),
    #[cfg(feature = "duckdb")]
    DuckDb(Arc<std::sync::Mutex<duckdb::Connection>>),
}

/// Open pools keyed by connection id. Lives in Tauri managed state.
#[derive(Default)]
pub struct DbState {
    pools: Mutex<HashMap<String, EnginePool>>,
}

pub async fn connect_impl(
    state: &DbState,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    let pool = match profile.engine.wire() {
        Wire::Postgres => EnginePool::Postgres(postgres::connect(&engine::build_url(&profile)?).await?),
        Wire::Mysql => EnginePool::Mysql(mysql::connect(&engine::build_url(&profile)?).await?),
        Wire::Sqlite => EnginePool::Sqlite(sqlite::connect(&engine::build_url(&profile)?).await?),
        Wire::SqlServer => EnginePool::SqlServer(Arc::new(Mutex::new(mssql::connect(&profile).await?))),
        Wire::DuckDb => {
            #[cfg(feature = "duckdb")]
            {
                EnginePool::DuckDb(Arc::new(std::sync::Mutex::new(duck::connect(&profile)?)))
            }
            #[cfg(not(feature = "duckdb"))]
            {
                return Err(
                    "DuckDB support is not built in. Rebuild with `--features duckdb`.".into(),
                );
            }
        }
        Wire::Oracle => return Err(engine::oracle_pending_message()),
    };

    let server_version = version(&pool).await;
    state.pools.lock().await.insert(profile.id.clone(), pool);
    Ok(ConnectionInfo {
        id: profile.id,
        engine: profile.engine,
        server_version,
    })
}

async fn version(pool: &EnginePool) -> String {
    let v = match pool {
        EnginePool::Postgres(p) => postgres::version(p).await,
        EnginePool::Mysql(p) => mysql::version(p).await,
        EnginePool::Sqlite(p) => sqlite::version(p).await,
        EnginePool::SqlServer(c) => mssql::version(c).await,
        #[cfg(feature = "duckdb")]
        EnginePool::DuckDb(c) => duck::version(c),
    };
    v.unwrap_or_else(|| "unknown".into())
}

pub async fn run_query_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    // Clone the pool handle out of the lock so the query does not hold the mutex.
    let pool = {
        let guard = state.pools.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };

    let cap = max_rows.unwrap_or(DEFAULT_MAX_ROWS);
    let start = Instant::now();

    let (columns, rows, truncated) = match &pool {
        EnginePool::Postgres(p) => postgres::run_query(p, &sql, cap).await?,
        EnginePool::Mysql(p) => mysql::run_query(p, &sql, cap).await?,
        EnginePool::Sqlite(p) => sqlite::run_query(p, &sql, cap).await?,
        EnginePool::SqlServer(c) => mssql::run_query(c, &sql, cap).await?,
        #[cfg(feature = "duckdb")]
        EnginePool::DuckDb(c) => duck::run_query(c, &sql, cap).await?,
    };

    let elapsed_ms = start.elapsed().as_millis() as u64;
    let row_count = rows.len() as u64;
    Ok(QueryResult {
        columns,
        rows,
        row_count,
        elapsed_ms,
        truncated,
        message: None,
    })
}

pub async fn disconnect_impl(state: &DbState, connection_id: String) -> Result<(), String> {
    if let Some(pool) = state.pools.lock().await.remove(&connection_id) {
        match pool {
            EnginePool::Postgres(p) => p.close().await,
            EnginePool::Mysql(p) => p.close().await,
            EnginePool::Sqlite(p) => p.close().await,
            // tiberius/duckdb close when their last handle drops.
            EnginePool::SqlServer(_) => {}
            #[cfg(feature = "duckdb")]
            EnginePool::DuckDb(_) => {}
        }
    }
    Ok(())
}

// ---- Tauri commands -----------------------------------------------------------

#[tauri::command]
pub async fn db_connect(
    state: tauri::State<'_, DbState>,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    connect_impl(state.inner(), profile).await
}

#[tauri::command]
pub async fn db_run_query(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    run_query_impl(state.inner(), connection_id, sql, max_rows).await
}

#[tauri::command]
pub async fn db_disconnect(
    state: tauri::State<'_, DbState>,
    connection_id: String,
) -> Result<(), String> {
    disconnect_impl(state.inner(), connection_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_sqlite_profile(id: &str) -> ConnectionProfile {
        let mut path = std::env::temp_dir();
        path.push(format!("irodori_dbtest_{id}_{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        ConnectionProfile {
            id: id.to_string(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: None,
            url: Some(format!("sqlite://{}?mode=rwc", path.display())),
        }
    }

    #[tokio::test]
    async fn sqlite_connect_and_query_round_trip() {
        let state = DbState::default();
        let info = connect_impl(&state, temp_sqlite_profile("rt"))
            .await
            .expect("connect");
        assert_eq!(info.engine, DbEngine::Sqlite);

        run_query_impl(
            &state,
            "rt".into(),
            "create table t(a integer, b text, c real)".into(),
            None,
        )
        .await
        .expect("create table");
        run_query_impl(
            &state,
            "rt".into(),
            "insert into t(a,b,c) values (1,'hi',1.5),(2,null,2.5)".into(),
            None,
        )
        .await
        .expect("insert");

        let result = run_query_impl(
            &state,
            "rt".into(),
            "select a,b,c from t order by a".into(),
            None,
        )
        .await
        .expect("select");
        assert_eq!(result.columns, vec!["a", "b", "c"]);
        assert_eq!(result.row_count, 2);
        assert_eq!(result.rows[0][0], serde_json::json!(1));
        assert_eq!(result.rows[0][1], serde_json::json!("hi"));
        assert_eq!(result.rows[1][1], serde_json::Value::Null);

        disconnect_impl(&state, "rt".into())
            .await
            .expect("disconnect");
    }

    #[tokio::test]
    async fn oracle_reports_thin_driver_plan() {
        let state = DbState::default();
        let profile = ConnectionProfile {
            id: "ora".into(),
            engine: DbEngine::Oracle,
            host: Some("localhost".into()),
            port: Some(1521),
            user: Some("system".into()),
            password: Some("secret".into()),
            database: Some("FREEPDB1".into()),
            url: None,
        };
        let err = connect_impl(&state, profile).await.unwrap_err();
        assert!(err.contains("thin"));
    }
}
