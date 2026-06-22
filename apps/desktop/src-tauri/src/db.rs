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
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

#[cfg(feature = "duckdb")]
mod duck;
mod engine;
mod meta;
mod mongo;
mod mssql;
mod mysql;
mod oracle;
mod postgres;
mod sqlite;
mod stream;

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
    pub columns: Vec<ColumnMetadata>,
    pub indexes: Vec<IndexMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DbObjectMetadataKind {
    Table,
    View,
    Index,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct IndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

// ---- The per-engine connection abstraction ------------------------------------

/// A live connection to one database. Each engine implements this over its native
/// client; the rest of the app never matches on the engine.
#[async_trait]
trait Connection: Send + Sync {
    async fn version(&self) -> Option<String>;
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String>;
    async fn metadata(&self) -> Result<DatabaseMetadata, String>;
    async fn close(&self);
}

struct PgConn(sqlx::PgPool);
#[async_trait]
impl Connection for PgConn {
    async fn version(&self) -> Option<String> {
        postgres::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        postgres::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        postgres::metadata(&self.0).await
    }
    async fn close(&self) {
        self.0.close().await
    }
}

struct MysqlConn(sqlx::MySqlPool);
#[async_trait]
impl Connection for MysqlConn {
    async fn version(&self) -> Option<String> {
        mysql::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        mysql::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        mysql::metadata(&self.0).await
    }
    async fn close(&self) {
        self.0.close().await
    }
}

struct SqliteConn(sqlx::SqlitePool);
#[async_trait]
impl Connection for SqliteConn {
    async fn version(&self) -> Option<String> {
        sqlite::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        sqlite::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        sqlite::metadata(&self.0).await
    }
    async fn close(&self) {
        self.0.close().await
    }
}

struct MssqlConn(Arc<Mutex<mssql::MssqlClient>>);
#[async_trait]
impl Connection for MssqlConn {
    async fn version(&self) -> Option<String> {
        mssql::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        mssql::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        mssql::metadata(&self.0).await
    }
    async fn close(&self) {} // tiberius closes when its last handle drops
}

struct MongoConn(mongo::MongoHandle);
#[async_trait]
impl Connection for MongoConn {
    async fn version(&self) -> Option<String> {
        mongo::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        mongo::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        mongo::metadata(&self.0).await
    }
    async fn close(&self) {} // mongodb client closes when its last handle drops
}

struct OracleConn(oracle::OracleHandle);
#[async_trait]
impl Connection for OracleConn {
    async fn version(&self) -> Option<String> {
        oracle::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        oracle::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        oracle::metadata(&self.0).await
    }
    async fn close(&self) {} // oracle-rs closes when its last handle drops
}

#[cfg(feature = "duckdb")]
struct DuckConn(Arc<std::sync::Mutex<duckdb::Connection>>);
#[cfg(feature = "duckdb")]
#[async_trait]
impl Connection for DuckConn {
    async fn version(&self) -> Option<String> {
        duck::version(&self.0)
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        duck::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        duck::metadata(&self.0).await
    }
    async fn close(&self) {}
}

/// The single connector/registry: map an engine's wire protocol to a concrete
/// [`Connection`]. This is the only place that knows every engine.
async fn connect_engine(profile: &ConnectionProfile) -> Result<Arc<dyn Connection>, String> {
    let conn: Arc<dyn Connection> = match profile.engine.wire() {
        Wire::Postgres => Arc::new(PgConn(
            postgres::connect(&engine::build_url(profile)?).await?,
        )),
        Wire::Mysql => Arc::new(MysqlConn(
            mysql::connect(&engine::build_url(profile)?).await?,
        )),
        Wire::Sqlite => Arc::new(SqliteConn(
            sqlite::connect(&engine::build_url(profile)?).await?,
        )),
        Wire::SqlServer => Arc::new(MssqlConn(Arc::new(Mutex::new(
            mssql::connect(profile).await?,
        )))),
        Wire::Mongo => Arc::new(MongoConn(mongo::connect(profile).await?)),
        Wire::DuckDb => {
            #[cfg(feature = "duckdb")]
            {
                Arc::new(DuckConn(Arc::new(std::sync::Mutex::new(duck::connect(
                    profile,
                )?))))
            }
            #[cfg(not(feature = "duckdb"))]
            {
                return Err(
                    "DuckDB support is not built in. Rebuild with `--features duckdb`.".into(),
                );
            }
        }
        Wire::Oracle => Arc::new(OracleConn(oracle::connect(profile).await?)),
    };
    Ok(conn)
}

/// Open connections keyed by connection id. Lives in Tauri managed state.
#[derive(Default)]
pub struct DbState {
    conns: Mutex<HashMap<String, Arc<dyn Connection>>>,
}

pub async fn connect_impl(
    state: &DbState,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    let conn = connect_engine(&profile).await?;
    let server_version = conn.version().await.unwrap_or_else(|| "unknown".into());
    state.conns.lock().await.insert(profile.id.clone(), conn);
    Ok(ConnectionInfo {
        id: profile.id,
        engine: profile.engine,
        server_version,
    })
}

pub async fn run_query_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    // Clone the handle out of the lock so the query does not hold the mutex.
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };

    let cap = max_rows.unwrap_or(DEFAULT_MAX_ROWS);
    let start = Instant::now();
    let (columns, rows, truncated) = conn.run_query(&sql, cap).await?;
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

pub async fn list_objects_impl(
    state: &DbState,
    connection_id: String,
) -> Result<DatabaseMetadata, String> {
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };
    conn.metadata().await
}

pub async fn disconnect_impl(state: &DbState, connection_id: String) -> Result<(), String> {
    if let Some(conn) = state.conns.lock().await.remove(&connection_id) {
        conn.close().await;
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
pub async fn db_list_objects(
    state: tauri::State<'_, DbState>,
    connection_id: String,
) -> Result<DatabaseMetadata, String> {
    list_objects_impl(state.inner(), connection_id).await
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
            "create index t_b_idx on t(b)".into(),
            None,
        )
        .await
        .expect("create index");
        run_query_impl(
            &state,
            "rt".into(),
            "create view t_view as select a,b from t".into(),
            None,
        )
        .await
        .expect("create view");
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

        let metadata = list_objects_impl(&state, "rt".into())
            .await
            .expect("metadata");
        let main = metadata
            .schemas
            .iter()
            .find(|schema| schema.name == "main")
            .expect("main schema");
        let table = main
            .objects
            .iter()
            .find(|object| object.name == "t")
            .expect("table t");
        assert_eq!(table.columns.len(), 3);
        assert!(table.indexes.iter().any(|index| index.name == "t_b_idx"));
        assert!(main.objects.iter().any(|object| object.name == "t_view"));

        disconnect_impl(&state, "rt".into())
            .await
            .expect("disconnect");
    }

    #[tokio::test]
    async fn sqlite_memory_profile_uses_in_memory_database() {
        let state = DbState::default();
        let profile = ConnectionProfile {
            id: "mem".into(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some(":memory:".into()),
            url: None,
        };
        connect_impl(&state, profile).await.expect("connect memory");
        run_query_impl(
            &state,
            "mem".into(),
            "create table t(id integer primary key, name text not null)".into(),
            None,
        )
        .await
        .expect("create table");
        run_query_impl(
            &state,
            "mem".into(),
            "insert into t(name) values ('memory')".into(),
            None,
        )
        .await
        .expect("insert");
        let result = run_query_impl(&state, "mem".into(), "select name from t".into(), None)
            .await
            .expect("select");
        assert_eq!(result.rows[0][0], serde_json::json!("memory"));
    }
}
