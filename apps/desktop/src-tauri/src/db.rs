//! Real database connectivity.
//!
//! PostgreSQL, MySQL/MariaDB, and SQLite each use their **native** sqlx pool
//! (`PgPool`/`MySqlPool`/`SqlitePool`) with explicit per-type decoding, so
//! decimals, dates/timestamps, uuids, json, and binary come through correctly.
//! (The earlier `Any`-driver path could only see int/bigint/text.) This follows
//! the Beekeeper-studied lesson: route value decoding through native drivers by
//! column type, and force exact numerics/temporals to strings to avoid precision
//! and timezone loss.
//!
//! Postgres-wire engines (CockroachDB, YugabyteDB, Redshift, TimescaleDB) and
//! MySQL-wire engines (MariaDB, TiDB) reuse the same drivers. Oracle is pending a
//! pure-Rust thin TNS driver (no Instant Client); see the data-source strategy.

use std::collections::HashMap;
use std::time::Instant;

use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlPool, MySqlPoolOptions, MySqlRow};
use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, Row, TypeInfo, ValueRef};
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
    // Postgres-wire compatible — handled by the same sqlx postgres driver.
    #[serde(rename = "cockroachdb")]
    #[ts(rename = "cockroachdb")]
    CockroachDb,
    #[serde(rename = "yugabytedb")]
    #[ts(rename = "yugabytedb")]
    YugabyteDb,
    Redshift,
    #[serde(rename = "timescaledb")]
    #[ts(rename = "timescaledb")]
    Timescale,
    // MySQL-wire compatible — handled by the same sqlx mysql driver.
    #[serde(rename = "mariadb")]
    #[ts(rename = "mariadb")]
    MariaDb,
    #[serde(rename = "tidb")]
    #[ts(rename = "tidb")]
    TiDb,
}

/// The wire protocol an engine speaks — i.e. which sqlx driver handles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wire {
    Postgres,
    Mysql,
    Sqlite,
    Oracle,
}

impl DbEngine {
    fn wire(self) -> Wire {
        match self {
            DbEngine::Postgres
            | DbEngine::CockroachDb
            | DbEngine::YugabyteDb
            | DbEngine::Redshift
            | DbEngine::Timescale => Wire::Postgres,
            DbEngine::Mysql | DbEngine::MariaDb | DbEngine::TiDb => Wire::Mysql,
            DbEngine::Sqlite => Wire::Sqlite,
            DbEngine::Oracle => Wire::Oracle,
        }
    }

    fn default_port(self) -> u16 {
        match self {
            DbEngine::Postgres | DbEngine::Timescale => 5432,
            DbEngine::CockroachDb => 26257,
            DbEngine::YugabyteDb => 5433,
            DbEngine::Redshift => 5439,
            DbEngine::Mysql | DbEngine::MariaDb => 3306,
            DbEngine::TiDb => 4000,
            DbEngine::Oracle => 1521,
            DbEngine::Sqlite => 0,
        }
    }
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

/// One query's results as a column header plus JSON cells.
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

/// A live connection: one native pool, tagged by wire family. Cloneable because
/// every sqlx pool is an `Arc` handle.
#[derive(Clone)]
enum EnginePool {
    Postgres(PgPool),
    Mysql(MySqlPool),
    Sqlite(SqlitePool),
}

/// Open pools keyed by connection id. Lives in Tauri managed state.
#[derive(Default)]
pub struct DbState {
    pools: Mutex<HashMap<String, EnginePool>>,
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
    match p.engine.wire() {
        Wire::Sqlite => {
            let path = p
                .database
                .clone()
                .or_else(|| p.host.clone())
                .ok_or("SQLite needs a database file path (set `database`)")?;
            Ok(format!("sqlite://{path}?mode=rwc"))
        }
        Wire::Postgres => Ok(build_tcp_url("postgres", p)),
        Wire::Mysql => Ok(build_tcp_url("mysql", p)),
        Wire::Oracle => Err(oracle_pending_message()),
    }
}

fn build_tcp_url(scheme: &str, p: &ConnectionProfile) -> String {
    let host = p.host.clone().unwrap_or_else(|| "localhost".into());
    let port = p.port.unwrap_or_else(|| p.engine.default_port());
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

async fn fetch_version(pool: &EnginePool) -> String {
    let sql = match pool {
        EnginePool::Sqlite(_) => "select sqlite_version()",
        _ => "select version()",
    };
    let scalar = match pool {
        EnginePool::Postgres(p) => sqlx::query_scalar::<_, String>(sql).fetch_one(p).await.ok(),
        EnginePool::Mysql(p) => sqlx::query_scalar::<_, String>(sql).fetch_one(p).await.ok(),
        EnginePool::Sqlite(p) => sqlx::query_scalar::<_, String>(sql).fetch_one(p).await.ok(),
    };
    scalar.unwrap_or_else(|| "unknown".into())
}

pub async fn connect_impl(
    state: &DbState,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    let url = build_url(&profile)?;
    let pool = match profile.engine.wire() {
        Wire::Postgres => EnginePool::Postgres(
            PgPoolOptions::new()
                .max_connections(5)
                .connect(&url)
                .await
                .map_err(|e| format!("connect failed: {e}"))?,
        ),
        Wire::Mysql => EnginePool::Mysql(
            MySqlPoolOptions::new()
                .max_connections(5)
                .connect(&url)
                .await
                .map_err(|e| format!("connect failed: {e}"))?,
        ),
        // SQLite is single-writer; one connection avoids file-lock surprises.
        Wire::Sqlite => EnginePool::Sqlite(
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect(&url)
                .await
                .map_err(|e| format!("connect failed: {e}"))?,
        ),
        Wire::Oracle => return Err(oracle_pending_message()),
    };

    let server_version = fetch_version(&pool).await;
    state.pools.lock().await.insert(profile.id.clone(), pool);
    Ok(ConnectionInfo {
        id: profile.id,
        engine: profile.engine,
        server_version,
    })
}

/// Default page size when the caller does not pass `max_rows`. Keeps memory
/// bounded so a `select *` over a 10M-row table cannot exhaust RAM (the
/// TablePlus problem). Full extraction goes through run-to-file (IO-001); a
/// later ticket adds optional disk offload for very large windows (EXEC-010).
const DEFAULT_MAX_ROWS: usize = 10_000;

/// Stream rows from one native pool, decoding each cell with `$decode`, and stop
/// at `$cap` rows. Yields `(columns, rows, truncated)`.
macro_rules! run_stream {
    ($pool:expr, $sql:expr, $cap:expr, $decode:path) => {{
        let mut stream = sqlx::query($sql).fetch($pool);
        let mut columns: Vec<String> = Vec::new();
        let mut out_rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        while let Some(row) = stream
            .try_next()
            .await
            .map_err(|e| format!("query failed: {e}"))?
        {
            if columns.is_empty() {
                columns = row.columns().iter().map(|c| c.name().to_string()).collect();
            }
            if out_rows.len() >= $cap {
                truncated = true;
                break;
            }
            let mut cells = Vec::with_capacity(row.columns().len());
            for i in 0..row.columns().len() {
                cells.push($decode(&row, i));
            }
            out_rows.push(cells);
        }
        (columns, out_rows, truncated)
    }};
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
        EnginePool::Postgres(p) => run_stream!(p, &sql, cap, pg_cell_to_json),
        EnginePool::Mysql(p) => run_stream!(p, &sql, cap, my_cell_to_json),
        EnginePool::Sqlite(p) => run_stream!(p, &sql, cap, sqlite_cell_to_json),
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
        }
    }
    Ok(())
}

// ---- Per-engine cell decoding -------------------------------------------------

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Decode a PostgreSQL cell by column type. Exact numerics/temporals become
/// strings to preserve precision and timezone.
fn pg_cell_to_json(row: &PgRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    let ty = row.column(i).type_info().name();
    match ty {
        "BOOL" => row.try_get::<bool, _>(i).map(Value::Bool).unwrap_or(Value::Null),
        "INT2" => row.try_get::<i16, _>(i).map(|v| Value::from(v as i64)).unwrap_or(Value::Null),
        "INT4" => row.try_get::<i32, _>(i).map(|v| Value::from(v as i64)).unwrap_or(Value::Null),
        "INT8" => row.try_get::<i64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "FLOAT4" => row.try_get::<f32, _>(i).map(|v| Value::from(v as f64)).unwrap_or(Value::Null),
        "FLOAT8" => row.try_get::<f64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "NUMERIC" => row
            .try_get::<BigDecimal, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "UUID" => row
            .try_get::<Uuid, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "JSON" | "JSONB" => row.try_get::<Value, _>(i).unwrap_or(Value::Null),
        "TIMESTAMPTZ" => row
            .try_get::<DateTime<Utc>, _>(i)
            .map(|v| Value::String(v.to_rfc3339()))
            .unwrap_or(Value::Null),
        "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "DATE" => row
            .try_get::<NaiveDate, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "TIME" => row
            .try_get::<NaiveTime, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "BYTEA" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|b| Value::String(format!("\\x{}", hex_encode(&b))))
            .unwrap_or(Value::Null),
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CHAR" | "CITEXT" => {
            row.try_get::<String, _>(i).map(Value::String).unwrap_or(Value::Null)
        }
        // Arrays and less-common types: best-effort text, else a tagged placeholder.
        _ => row
            .try_get::<String, _>(i)
            .map(Value::String)
            .or_else(|_| row.try_get::<i64, _>(i).map(Value::from))
            .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
            .unwrap_or_else(|_| Value::String(format!("<{ty}>"))),
    }
}

/// Decode a MySQL/MariaDB cell by column type.
fn my_cell_to_json(row: &MySqlRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    let ty = row.column(i).type_info().name();
    match ty {
        "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" | "YEAR" => {
            row.try_get::<i64, _>(i).map(Value::from).unwrap_or(Value::Null)
        }
        "FLOAT" => row.try_get::<f32, _>(i).map(|v| Value::from(v as f64)).unwrap_or(Value::Null),
        "DOUBLE" => row.try_get::<f64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "DECIMAL" | "NEWDECIMAL" => row
            .try_get::<BigDecimal, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "JSON" => row.try_get::<Value, _>(i).unwrap_or(Value::Null),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "DATE" => row
            .try_get::<NaiveDate, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|b| Value::String(format!("\\x{}", hex_encode(&b))))
            .unwrap_or(Value::Null),
        "VARCHAR" | "CHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => {
            row.try_get::<String, _>(i).map(Value::String).unwrap_or(Value::Null)
        }
        // Unsigned ints, TIME, and surprises: ladder through supported decodes.
        _ => row
            .try_get::<i64, _>(i)
            .map(Value::from)
            .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
            .or_else(|_| row.try_get::<String, _>(i).map(Value::String))
            .unwrap_or_else(|_| Value::String(format!("<{ty}>"))),
    }
}

/// Decode a SQLite cell. SQLite is dynamically typed, so decode by value.
fn sqlite_cell_to_json(row: &SqliteRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    row.try_get::<i64, _>(i)
        .map(Value::from)
        .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
        .or_else(|_| row.try_get::<String, _>(i).map(Value::String))
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(i)
                .map(|b| Value::String(format!("\\x{}", hex_encode(&b))))
        })
        .unwrap_or(Value::Null)
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

    #[test]
    fn engine_wire_routing() {
        for e in [
            DbEngine::Postgres,
            DbEngine::CockroachDb,
            DbEngine::YugabyteDb,
            DbEngine::Redshift,
            DbEngine::Timescale,
        ] {
            assert_eq!(e.wire(), Wire::Postgres, "{e:?} should use postgres wire");
        }
        for e in [DbEngine::Mysql, DbEngine::MariaDb, DbEngine::TiDb] {
            assert_eq!(e.wire(), Wire::Mysql, "{e:?} should use mysql wire");
        }
        assert_eq!(DbEngine::CockroachDb.default_port(), 26257);
        assert_eq!(DbEngine::YugabyteDb.default_port(), 5433);
        assert_eq!(DbEngine::TiDb.default_port(), 4000);
    }
}
