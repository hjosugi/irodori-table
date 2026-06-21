//! Real database connectivity.
//!
//! PostgreSQL, MySQL, and SQLite share one code path through sqlx's `Any` driver.
//! Oracle is deliberately not wired here yet: the plan is a pure-Rust *thin* TNS
//! driver that needs no Oracle Instant Client (the same idea as A5:SQL Mk-2's
//! "direct connection" mode), built by inheriting the permissively licensed
//! `oracle-rs` crate. Until that spike (SRC-004) lands, Oracle returns a clear,
//! honest error instead of pretending to work.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use futures_util::TryStreamExt;
use sqlx::any::{AnyPoolOptions, AnyRow};
use sqlx::{Column, Row, ValueRef};
use tokio::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Sqlite,
    Oracle,
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

/// One query's results as a column header plus JSON cells, so the frontend can
/// render any shape without a per-type binding. Rich typing is a later ticket.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub elapsed_ms: u64,
    /// True when the result was capped at `max_rows` and more rows remain on the
    /// server. The UI uses this to offer "load more" / run-to-file instead of
    /// silently hiding data.
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

/// Open connection pools keyed by connection id. Lives in Tauri managed state.
#[derive(Default)]
pub struct DbState {
    pools: Mutex<HashMap<String, sqlx::AnyPool>>,
}

/// Register sqlx's postgres/mysql/sqlite `Any` drivers exactly once per process.
pub fn install_drivers() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(sqlx::any::install_default_drivers);
}

fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn build_url(p: &ConnectionProfile) -> Result<String, String> {
    if let Some(url) = &p.url {
        return Ok(url.clone());
    }
    match p.engine {
        DbEngine::Sqlite => {
            let path = p
                .database
                .clone()
                .or_else(|| p.host.clone())
                .ok_or("SQLite needs a database file path (set `database`)")?;
            Ok(format!("sqlite://{path}?mode=rwc"))
        }
        DbEngine::Postgres => Ok(build_tcp_url("postgres", p, 5432)),
        DbEngine::Mysql => Ok(build_tcp_url("mysql", p, 3306)),
        DbEngine::Oracle => Err(oracle_pending_message()),
    }
}

fn build_tcp_url(scheme: &str, p: &ConnectionProfile, default_port: u16) -> String {
    let host = p.host.clone().unwrap_or_else(|| "localhost".into());
    let port = p.port.unwrap_or(default_port);
    let db = p.database.clone().unwrap_or_default();
    let auth = match (&p.user, &p.password) {
        (Some(u), Some(pw)) if !pw.is_empty() => {
            format!("{}:{}@", percent_encode(u), percent_encode(pw))
        }
        (Some(u), _) if !u.is_empty() => format!("{}@", percent_encode(u)),
        _ => String::new(),
    };
    format!("{scheme}://{auth}{host}:{port}/{db}")
}

fn oracle_pending_message() -> String {
    "Oracle will connect through a pure-Rust thin TNS driver (no Instant Client, \
     like A5:SQL Mk-2's direct mode), built by inheriting the permissive `oracle-rs` \
     crate. Integration is pending the SRC-004 spike."
        .to_string()
}

async fn fetch_version(pool: &sqlx::AnyPool, engine: DbEngine) -> String {
    let sql = match engine {
        DbEngine::Sqlite => "select sqlite_version()",
        _ => "select version()",
    };
    match sqlx::query(sql).fetch_one(pool).await {
        Ok(row) => any_cell_to_json(&row, 0)
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| "unknown".into()),
        Err(_) => "unknown".into(),
    }
}

pub async fn connect_impl(
    state: &DbState,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    install_drivers();
    if profile.engine == DbEngine::Oracle {
        return Err(oracle_pending_message());
    }
    let url = build_url(&profile)?;
    // SQLite is single-writer; one connection avoids file-lock surprises.
    let max = if profile.engine == DbEngine::Sqlite { 1 } else { 5 };
    let pool = AnyPoolOptions::new()
        .max_connections(max)
        .connect(&url)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let server_version = fetch_version(&pool, profile.engine).await;
    state.pools.lock().await.insert(profile.id.clone(), pool);
    Ok(ConnectionInfo {
        id: profile.id,
        engine: profile.engine,
        server_version,
    })
}

/// Default page size when the caller does not pass `max_rows`. Keeps memory
/// bounded so a `select *` over a 10M-row table cannot exhaust RAM (the
/// TablePlus problem). Full extraction goes through run-to-file (IO-001), and a
/// later ticket adds optional disk offload for very large windows (EXEC-010).
const DEFAULT_MAX_ROWS: usize = 10_000;

pub async fn run_query_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    // Clone the pool out of the lock so the query does not hold the mutex.
    let pool = {
        let guard = state.pools.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };

    let cap = max_rows.unwrap_or(DEFAULT_MAX_ROWS);
    let start = Instant::now();

    // Stream rows instead of buffering the whole result set, and stop at `cap`.
    let mut stream = sqlx::query(&sql).fetch(&pool);
    let mut columns: Vec<String> = Vec::new();
    let mut out_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;

    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|e| format!("query failed: {e}"))?
    {
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect();
        }
        if out_rows.len() >= cap {
            truncated = true;
            break;
        }
        let mut cells = Vec::with_capacity(row.columns().len());
        for idx in 0..row.columns().len() {
            cells.push(any_cell_to_json(&row, idx));
        }
        out_rows.push(cells);
    }
    drop(stream);

    let elapsed_ms = start.elapsed().as_millis() as u64;
    let row_count = out_rows.len() as u64;
    Ok(QueryResult {
        columns,
        rows: out_rows,
        row_count,
        elapsed_ms,
        truncated,
        message: None,
    })
}

pub async fn disconnect_impl(state: &DbState, connection_id: String) -> Result<(), String> {
    if let Some(pool) = state.pools.lock().await.remove(&connection_id) {
        pool.close().await;
    }
    Ok(())
}

/// Decode one cell to JSON. sqlx's `Any` value kinds are limited, so we try the
/// supported widths in order and fall back to text. Rich type mapping (dates,
/// decimals, arrays, JSON) is a later ticket.
fn any_cell_to_json(row: &AnyRow, idx: usize) -> serde_json::Value {
    use serde_json::Value;
    if let Ok(raw) = row.try_get_raw(idx) {
        if raw.is_null() {
            return Value::Null;
        }
    }
    if let Ok(v) = row.try_get::<i64, _>(idx) {
        return Value::from(v);
    }
    if let Ok(v) = row.try_get::<i32, _>(idx) {
        return Value::from(v);
    }
    if let Ok(v) = row.try_get::<f64, _>(idx) {
        return Value::from(v);
    }
    if let Ok(v) = row.try_get::<bool, _>(idx) {
        return Value::Bool(v);
    }
    if let Ok(v) = row.try_get::<String, _>(idx) {
        return Value::String(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, _>(idx) {
        return Value::String(format!("\\x{}", hex_encode(&v)));
    }
    Value::String("<unsupported type>".into())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

// ---- Tauri commands -------------------------------------------------------

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
        install_drivers();
        let state = DbState::default();
        let profile = temp_sqlite_profile("rt");
        let info = connect_impl(&state, profile).await.expect("connect");
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
