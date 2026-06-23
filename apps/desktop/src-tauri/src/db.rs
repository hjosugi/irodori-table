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

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

#[cfg(feature = "duckdb")]
mod duck;
mod edit;
mod engine;
mod meta;
mod mongo;
mod mssql;
mod mysql;
mod oracle;
mod postgres;
mod sqlite;
mod stream;

pub use edit::{AppliedEdits, CellValue, RowDelete, RowInsert, RowUpdate, TableEdits};
pub use engine::DbEngine;
use engine::Wire;

/// One query's decoded result: `(column names, rows of JSON cells, truncated)`.
pub(crate) type RowSet = (Vec<String>, Vec<Vec<serde_json::Value>>, bool);

/// Default page size when the caller does not pass `max_rows`. Keeps memory
/// bounded so a `select *` over a 10M-row table cannot exhaust RAM (the
/// TablePlus problem). Full extraction goes through run-to-file (IO-001); a
/// later ticket adds optional disk offload for very large windows (EXEC-010).
pub(crate) const DEFAULT_MAX_ROWS: usize = 10_000;
pub(crate) const MAX_RESULT_ROWS: usize = 100_000;

const MAX_CONNECTION_ID_LEN: usize = 128;
const MAX_SQL_BYTES: usize = 4 * 1024 * 1024;

/// Rows per streamed batch. Small enough that the grid paints the first rows
/// almost immediately, large enough to keep the channel/event overhead low.
pub(crate) const STREAM_BATCH_ROWS: usize = 500;

/// One streamed-query event forwarded to the frontend over a Tauri channel. The
/// wire shape is a `type`-tagged union (`columns` | `rows` | `done` | `error`);
/// the matching TypeScript type is hand-written in `src/db-stream.ts` because a
/// Tauri `Channel` argument is outside the generated command surface.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum QueryStreamEvent {
    Columns {
        columns: Vec<String>,
    },
    Rows {
        rows: Vec<Vec<serde_json::Value>>,
    },
    Done {
        #[serde(rename = "rowCount")]
        row_count: u64,
        truncated: bool,
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
    },
    Error {
        message: String,
    },
}

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn normalize_optional_text(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
}

fn is_unimplemented_wire(wire: Wire) -> bool {
    matches!(
        wire,
        Wire::ClickHouse
            | Wire::Neo4j
            | Wire::Memgraph
            | Wire::InfluxDb
            | Wire::Qdrant
            | Wire::Milvus
            | Wire::Pinecone
    )
}

fn normalize_profile(mut profile: ConnectionProfile) -> Result<ConnectionProfile, String> {
    profile.id = profile.id.trim().to_string();
    if profile.id.is_empty() {
        return Err("connection id is required".into());
    }
    if profile.id.len() > MAX_CONNECTION_ID_LEN {
        return Err(format!(
            "connection id must be at most {MAX_CONNECTION_ID_LEN} bytes"
        ));
    }
    if profile.id.chars().any(char::is_control) {
        return Err("connection id cannot contain control characters".into());
    }

    normalize_optional_text(&mut profile.url);
    normalize_optional_text(&mut profile.host);
    normalize_optional_text(&mut profile.user);
    normalize_optional_text(&mut profile.database);

    let wire = profile.engine.wire();
    if is_unimplemented_wire(wire) {
        return Err(format!(
            "{:?} is recognized but does not have a production connector yet",
            profile.engine
        ));
    }

    if profile.url.is_some() {
        return Ok(profile);
    }

    match wire {
        Wire::Sqlite => {
            if profile.database.is_none() && profile.host.is_none() {
                return Err("SQLite needs a database file path or :memory:".into());
            }
        }
        Wire::DuckDb => {
            // Empty DuckDB profiles intentionally open an in-memory database.
        }
        Wire::Postgres | Wire::Mysql | Wire::SqlServer | Wire::Mongo | Wire::Oracle => {
            if profile.host.is_none() {
                return Err("host is required when URL/DSN is not provided".into());
            }
        }
        Wire::ClickHouse
        | Wire::Neo4j
        | Wire::Memgraph
        | Wire::InfluxDb
        | Wire::Qdrant
        | Wire::Milvus
        | Wire::Pinecone => unreachable!("unimplemented wires are rejected above"),
    }

    Ok(profile)
}

fn bounded_query_cap(max_rows: Option<usize>) -> Result<usize, String> {
    let cap = max_rows.unwrap_or(DEFAULT_MAX_ROWS);
    if cap == 0 {
        return Err("maxRows must be at least 1".into());
    }
    if cap > MAX_RESULT_ROWS {
        return Err(format!("maxRows must be at most {MAX_RESULT_ROWS}"));
    }
    Ok(cap)
}

fn redact_url_password(input: &str) -> String {
    let Some(scheme_at) = input.find("://") else {
        return input.to_string();
    };
    let authority_start = scheme_at + 3;
    let authority_end = input[authority_start..]
        .find(['/', '?', '#'])
        .map(|offset| authority_start + offset)
        .unwrap_or(input.len());
    let Some(at_offset) = input[authority_start..authority_end].rfind('@') else {
        return input.to_string();
    };
    let userinfo_end = authority_start + at_offset;
    let Some(colon_offset) = input[authority_start..userinfo_end].find(':') else {
        return input.to_string();
    };
    let password_start = authority_start + colon_offset + 1;
    format!("{}****{}", &input[..password_start], &input[userinfo_end..])
}

fn redact_password_assignments(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;

    while cursor < input.len() {
        let password_at = lower[cursor..].find("password=");
        let pwd_at = lower[cursor..].find("pwd=");
        let Some(relative) = [password_at, pwd_at].into_iter().flatten().min() else {
            out.push_str(&input[cursor..]);
            break;
        };
        let key_start = cursor + relative;
        let value_start = input[key_start..]
            .find('=')
            .map(|offset| key_start + offset + 1)
            .unwrap_or(input.len());
        let value_end = input[value_start..]
            .find(';')
            .map(|offset| value_start + offset)
            .unwrap_or(input.len());

        out.push_str(&input[cursor..value_start]);
        out.push_str("****");
        cursor = value_end;
    }

    out
}

fn redact_secret_text(text: &str, profile: &ConnectionProfile) -> String {
    let mut redacted = redact_password_assignments(text);
    if let Some(url) = &profile.url {
        let redacted_url = redact_url_password(url);
        redacted = redacted.replace(url, &redacted_url);
    }
    if let Some(password) = &profile.password {
        if !password.is_empty() {
            redacted = redacted.replace(password, "****");
        }
    }
    redacted
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

    /// Commit a batch of result-grid edits in one transaction. The default refuses;
    /// the sqlx engines (Postgres-wire, MySQL-wire, SQLite) override it.
    async fn apply_edits(&self, _edits: &TableEdits) -> Result<AppliedEdits, String> {
        Err("editing is not supported for this engine yet".to_string())
    }

    /// Stream a query's rows to `ctx.sink` in batches, checking `ctx.token` so a
    /// cancel stops the fetch promptly. The default buffers via [`run_query`] and
    /// emits the header plus a single batch — correct for engines whose driver
    /// materializes rows before our loop (Oracle/Mongo) or keeps its own loop
    /// (DuckDB); those rely on the managed run's timeout/cancel-drop rather than a
    /// cooperative mid-fetch stop. Engines with a real row-by-row loop (the sqlx
    /// trio, SQL Server) override this for incremental delivery and in-loop cancel.
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        let (columns, rows, truncated) = self.run_query(sql, ctx.cap).await?;
        let row_count = rows.len() as u64;
        ctx.columns(columns).await?;
        ctx.rows(rows).await?;
        Ok(stream::StreamSummary {
            truncated,
            row_count,
        })
    }
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
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        postgres::stream_query(&self.0, sql, ctx).await
    }
    async fn apply_edits(&self, edits: &TableEdits) -> Result<AppliedEdits, String> {
        postgres::apply_edits(&self.0, edits).await
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
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        mysql::stream_query(&self.0, sql, ctx).await
    }
    async fn apply_edits(&self, edits: &TableEdits) -> Result<AppliedEdits, String> {
        mysql::apply_edits(&self.0, edits).await
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
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        sqlite::stream_query(&self.0, sql, ctx).await
    }
    async fn apply_edits(&self, edits: &TableEdits) -> Result<AppliedEdits, String> {
        sqlite::apply_edits(&self.0, edits).await
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
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        mssql::stream_query(&self.0, sql, ctx).await
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
        Wire::ClickHouse
        | Wire::Neo4j
        | Wire::Memgraph
        | Wire::InfluxDb
        | Wire::Qdrant
        | Wire::Milvus
        | Wire::Pinecone => {
            return Err(format!(
                "{:?} driver is not yet fully implemented",
                profile.engine
            ));
        }
    };
    Ok(conn)
}

/// Open connections keyed by connection id. Lives in Tauri managed state.
#[derive(Default)]
pub struct DbState {
    conns: Mutex<HashMap<String, Arc<dyn Connection>>>,
    /// In-flight cancellable queries keyed by a caller-supplied `query_id`, so
    /// `db_cancel` can stop a specific run. Entries are removed when the run ends.
    cancels: Mutex<HashMap<String, CancellationToken>>,
}

pub async fn connect_impl(
    state: &DbState,
    profile: ConnectionProfile,
) -> Result<ConnectionInfo, String> {
    let profile = normalize_profile(profile)?;
    let conn = connect_engine(&profile)
        .await
        .map_err(|error| redact_secret_text(&error, &profile))?;
    let server_version = conn.version().await.unwrap_or_else(|| "unknown".into());
    let old = state.conns.lock().await.insert(profile.id.clone(), conn);
    if let Some(old) = old {
        old.close().await;
    }
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
        message: truncated.then(|| format!("result capped at {cap} rows")),
    })
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
            result = run_query_impl(state, connection_id, sql, max_rows) => result,
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
pub(crate) async fn run_query_stream_impl(
    state: &DbState,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    sink: mpsc::Sender<stream::FetchEvent>,
) -> Result<stream::StreamSummary, String> {
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };

    let token = CancellationToken::new();
    if let Some(qid) = &query_id {
        state
            .cancels
            .lock()
            .await
            .insert(qid.clone(), token.clone());
    }
    let ctx = stream::StreamCtx {
        cap: max_rows.unwrap_or(DEFAULT_MAX_ROWS),
        batch_rows: STREAM_BATCH_ROWS,
        token: token.clone(),
        sink,
    };

    let run = async {
        tokio::select! {
            biased;
            _ = token.cancelled() => Err("query cancelled".to_string()),
            result = conn.stream_query(&sql, &ctx) => result,
        }
    };
    let result = with_timeout(timeout_ms, run).await;

    if let Some(qid) = &query_id {
        state.cancels.lock().await.remove(qid);
    }
    result
}

pub async fn list_objects_impl(
    state: &DbState,
    connection_id: String,
) -> Result<DatabaseMetadata, String> {
    let connection_id = connection_id.trim().to_string();
    if connection_id.is_empty() {
        return Err("connection id is required".into());
    }
    let conn = {
        let guard = state.conns.lock().await;
        guard
            .get(&connection_id)
            .cloned()
            .ok_or_else(|| format!("no open connection: {connection_id}"))?
    };
    conn.metadata().await
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
    timeout_ms: Option<u64>,
    query_id: Option<String>,
) -> Result<QueryResult, String> {
    // The managed run applies the optional timeout deadline and registers the
    // optional `query_id` so `db_cancel` can stop this specific statement.
    run_query_managed_impl(
        state.inner(),
        connection_id,
        sql,
        max_rows,
        timeout_ms,
        query_id,
    )
    .await
}

/// Cancel the in-flight query the UI started under `query_id`. Returns `true` when
/// a matching run was found and signalled, `false` if it already finished.
#[tauri::command]
pub async fn db_cancel(state: tauri::State<'_, DbState>, query_id: String) -> Result<bool, String> {
    Ok(cancel_query_impl(state.inner(), query_id).await)
}

/// Run a query and stream its rows to the frontend over `on_event` (columns →
/// batched rows → done/error) so the grid fills incrementally. Honors the same
/// optional `timeout_ms`/`query_id` as `db_run_query`; `db_cancel(query_id)` stops
/// it mid-stream. The fetch and the channel-forwarding run concurrently so batches
/// reach the UI as they are produced.
#[tauri::command]
pub async fn db_run_query_stream(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    sql: String,
    max_rows: Option<usize>,
    timeout_ms: Option<u64>,
    query_id: Option<String>,
    on_event: tauri::ipc::Channel<QueryStreamEvent>,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let started = Instant::now();

    let fetch = run_query_stream_impl(
        state.inner(),
        connection_id,
        sql,
        max_rows,
        timeout_ms,
        query_id,
        tx,
    );
    let forward = async {
        while let Some(event) = rx.recv().await {
            let out = match event {
                stream::FetchEvent::Columns(columns) => QueryStreamEvent::Columns { columns },
                stream::FetchEvent::Rows(rows) => QueryStreamEvent::Rows { rows },
            };
            on_event.send(out).map_err(|e| e.to_string())?;
        }
        Ok::<(), String>(())
    };

    let (summary, forwarded) = tokio::join!(fetch, forward);
    forwarded?;
    let final_event = match summary {
        Ok(s) => QueryStreamEvent::Done {
            row_count: s.row_count,
            truncated: s.truncated,
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
        Err(message) => QueryStreamEvent::Error { message },
    };
    on_event.send(final_event).map_err(|e| e.to_string())?;
    Ok(())
}

/// Commit staged result-grid edits (updates/inserts/deletes) for one table in a
/// single transaction; returns how many rows each kind affected.
#[tauri::command]
pub async fn db_apply_edits(
    state: tauri::State<'_, DbState>,
    connection_id: String,
    edits: TableEdits,
) -> Result<AppliedEdits, String> {
    apply_edits_impl(state.inner(), connection_id, edits).await
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

    #[tokio::test]
    async fn with_timeout_passes_through_and_trips() {
        // No limit (None / 0) runs to completion.
        let ok = with_timeout(None, async { Ok::<_, String>(42) }).await;
        assert_eq!(ok, Ok(42));
        let zero = with_timeout(Some(0), async { Ok::<_, String>(7) }).await;
        assert_eq!(zero, Ok(7));

        // A slow future past the deadline returns a clean timeout error.
        let slow = with_timeout(Some(5), async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok::<_, String>(())
        })
        .await;
        assert_eq!(slow, Err("query timed out after 5ms".to_string()));
    }

    #[tokio::test]
    async fn cancel_signals_a_registered_query_then_is_a_noop() {
        let state = DbState::default();
        let token = CancellationToken::new();
        state
            .cancels
            .lock()
            .await
            .insert("q1".to_string(), token.clone());

        // A run that resolves to the cancel arm once the token fires (mirrors the
        // `select!` in run_query_managed_impl, without needing a live database).
        let run = tokio::spawn(async move {
            tokio::select! {
                biased;
                _ = token.cancelled() => Err::<(), String>("query cancelled".to_string()),
                _ = tokio::time::sleep(Duration::from_secs(30)) => Ok(()),
            }
        });

        assert!(cancel_query_impl(&state, "q1".to_string()).await);
        assert_eq!(run.await.unwrap(), Err("query cancelled".to_string()));
        // The entry is gone, so a second cancel (or an unknown id) is a no-op.
        assert!(!cancel_query_impl(&state, "q1".to_string()).await);
        assert!(!cancel_query_impl(&state, "missing".to_string()).await);
    }

    #[tokio::test]
    async fn stream_delivers_header_then_rows() {
        let state = DbState::default();
        connect_impl(&state, temp_sqlite_profile("st"))
            .await
            .expect("connect");
        run_query_impl(
            &state,
            "st".into(),
            "create table t(a integer, b text)".into(),
            None,
        )
        .await
        .expect("create");
        run_query_impl(
            &state,
            "st".into(),
            "insert into t(a,b) values (1,'x'),(2,'y'),(3,'z')".into(),
            None,
        )
        .await
        .expect("insert");

        let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
        let summary = run_query_stream_impl(
            &state,
            "st".into(),
            "select a,b from t order by a".into(),
            None,
            None,
            None,
            tx,
        )
        .await
        .expect("stream");
        assert_eq!(summary.row_count, 3);
        assert!(!summary.truncated);

        let mut columns: Vec<String> = Vec::new();
        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                stream::FetchEvent::Columns(c) => columns = c,
                stream::FetchEvent::Rows(mut r) => rows.append(&mut r),
            }
        }
        assert_eq!(columns, vec!["a", "b"]);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0][0], serde_json::json!(1));
        assert_eq!(rows[2][1], serde_json::json!("z"));
    }

    #[tokio::test]
    async fn stream_caps_rows_and_flags_truncation() {
        let state = DbState::default();
        connect_impl(&state, temp_sqlite_profile("stcap"))
            .await
            .expect("connect");
        run_query_impl(
            &state,
            "stcap".into(),
            "create table t(a integer)".into(),
            None,
        )
        .await
        .expect("create");
        run_query_impl(
            &state,
            "stcap".into(),
            "insert into t(a) values (1),(2),(3),(4)".into(),
            None,
        )
        .await
        .expect("insert");

        let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
        let summary = run_query_stream_impl(
            &state,
            "stcap".into(),
            "select a from t order by a".into(),
            Some(2),
            None,
            None,
            tx,
        )
        .await
        .expect("stream");
        assert_eq!(summary.row_count, 2);
        assert!(summary.truncated);

        let mut delivered = 0;
        while let Some(event) = rx.recv().await {
            if let stream::FetchEvent::Rows(r) = event {
                delivered += r.len();
            }
        }
        assert_eq!(delivered, 2);
    }

    #[tokio::test]
    async fn stream_query_stops_on_a_cancelled_token() {
        let state = DbState::default();
        connect_impl(&state, temp_sqlite_profile("stcancel"))
            .await
            .expect("connect");
        run_query_impl(
            &state,
            "stcancel".into(),
            "create table t(a integer)".into(),
            None,
        )
        .await
        .expect("create");
        run_query_impl(
            &state,
            "stcancel".into(),
            "insert into t(a) values (1),(2),(3)".into(),
            None,
        )
        .await
        .expect("insert");

        let conn = state
            .conns
            .lock()
            .await
            .get("stcancel")
            .cloned()
            .expect("conn");
        let (tx, _rx) = mpsc::channel::<stream::FetchEvent>(16);
        let token = CancellationToken::new();
        token.cancel();
        let ctx = stream::StreamCtx {
            cap: 10,
            batch_rows: STREAM_BATCH_ROWS,
            token,
            sink: tx,
        };
        let res = conn.stream_query("select a from t", &ctx).await;
        assert!(
            matches!(&res, Err(m) if m.as_str() == "query cancelled"),
            "got {res:?}"
        );
    }

    #[tokio::test]
    async fn apply_edits_commits_update_insert_delete() {
        let state = DbState::default();
        connect_impl(&state, temp_sqlite_profile("edit"))
            .await
            .expect("connect");
        run_query_impl(
            &state,
            "edit".into(),
            "create table t(id integer primary key, name text)".into(),
            None,
        )
        .await
        .expect("create");
        run_query_impl(
            &state,
            "edit".into(),
            "insert into t(id,name) values (1,'a'),(2,'b'),(3,'c')".into(),
            None,
        )
        .await
        .expect("insert");

        fn cell(column: &str, value: serde_json::Value) -> CellValue {
            CellValue {
                column: column.to_string(),
                value,
            }
        }
        let edits = TableEdits {
            schema: None,
            table: "t".into(),
            updates: vec![RowUpdate {
                keys: vec![cell("id", serde_json::json!(1))],
                set: vec![cell("name", serde_json::json!("A"))],
            }],
            inserts: vec![RowInsert {
                values: vec![
                    cell("id", serde_json::json!(4)),
                    cell("name", serde_json::json!("d")),
                ],
            }],
            deletes: vec![RowDelete {
                keys: vec![cell("id", serde_json::json!(2))],
            }],
        };
        let applied = apply_edits_impl(&state, "edit".into(), edits)
            .await
            .expect("apply");
        assert_eq!(applied.updated, 1);
        assert_eq!(applied.inserted, 1);
        assert_eq!(applied.deleted, 1);

        let result = run_query_impl(
            &state,
            "edit".into(),
            "select id,name from t order by id".into(),
            None,
        )
        .await
        .expect("select");
        assert_eq!(result.row_count, 3);
        assert_eq!(
            result.rows[0],
            vec![serde_json::json!(1), serde_json::json!("A")]
        );
        assert_eq!(
            result.rows[1],
            vec![serde_json::json!(3), serde_json::json!("c")]
        );
        assert_eq!(
            result.rows[2],
            vec![serde_json::json!(4), serde_json::json!("d")]
        );
    }

    #[tokio::test]
    async fn metadata_reports_primary_and_foreign_keys() {
        let state = DbState::default();
        connect_impl(&state, temp_sqlite_profile("keys"))
            .await
            .expect("connect");
        run_query_impl(
            &state,
            "keys".into(),
            "create table author(id integer primary key, name text)".into(),
            None,
        )
        .await
        .expect("author");
        run_query_impl(
            &state,
            "keys".into(),
            "create table book(id integer primary key, \
             author_id integer references author(id), title text)"
                .into(),
            None,
        )
        .await
        .expect("book");

        let meta = list_objects_impl(&state, "keys".into())
            .await
            .expect("metadata");
        let book = meta
            .schemas
            .iter()
            .flat_map(|schema| &schema.objects)
            .find(|object| object.name == "book")
            .expect("book object");
        assert_eq!(book.primary_key, vec!["id"]);
        assert_eq!(book.foreign_keys.len(), 1);
        assert_eq!(book.foreign_keys[0].columns, vec!["author_id"]);
        assert_eq!(book.foreign_keys[0].references_table, "author");
        assert_eq!(book.foreign_keys[0].references_columns, vec!["id"]);
    }

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

    #[tokio::test]
    async fn command_boundary_rejects_invalid_inputs() {
        let state = DbState::default();
        let mut invalid = temp_sqlite_profile("invalid");
        invalid.id = "  ".into();
        let err = connect_impl(&state, invalid).await.unwrap_err();
        assert!(err.contains("connection id is required"));

        let missing_host = ConnectionProfile {
            id: "missing-host".into(),
            engine: DbEngine::Postgres,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some("samples".into()),
            url: None,
        };
        let err = connect_impl(&state, missing_host).await.unwrap_err();
        assert!(err.contains("host is required"));

        let unsupported = ConnectionProfile {
            id: "clickhouse".into(),
            engine: DbEngine::ClickHouse,
            host: Some("localhost".into()),
            port: None,
            user: None,
            password: None,
            database: None,
            url: None,
        };
        let err = connect_impl(&state, unsupported).await.unwrap_err();
        assert!(err.contains("production connector"));

        let err = run_query_impl(&state, " ".into(), "select 1".into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("connection id is required"));
    }

    #[tokio::test]
    async fn query_bounds_are_enforced() {
        let state = DbState::default();
        connect_impl(
            &state,
            ConnectionProfile {
                id: "bounds".into(),
                engine: DbEngine::Sqlite,
                host: None,
                port: None,
                user: None,
                password: None,
                database: Some(":memory:".into()),
                url: None,
            },
        )
        .await
        .expect("connect memory");

        let err = run_query_impl(&state, "bounds".into(), "   ".into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("query is empty"));

        let err = run_query_impl(&state, "bounds".into(), "select 1".into(), Some(0))
            .await
            .unwrap_err();
        assert!(err.contains("maxRows must be at least 1"));

        let err = run_query_impl(
            &state,
            "bounds".into(),
            "select 1".into(),
            Some(MAX_RESULT_ROWS + 1),
        )
        .await
        .unwrap_err();
        assert!(err.contains("maxRows must be at most"));

        run_query_impl(
            &state,
            "bounds".into(),
            "create table t(id integer)".into(),
            None,
        )
        .await
        .expect("create");
        run_query_impl(
            &state,
            "bounds".into(),
            "insert into t values (1),(2)".into(),
            None,
        )
        .await
        .expect("insert");
        let result = run_query_impl(
            &state,
            "bounds".into(),
            "select id from t order by id".into(),
            Some(1),
        )
        .await
        .expect("bounded select");
        assert_eq!(result.row_count, 1);
        assert!(result.truncated);
        assert_eq!(result.message.as_deref(), Some("result capped at 1 rows"));
    }

    #[tokio::test]
    async fn reconnect_replaces_existing_connection() {
        let state = DbState::default();
        let profile = ConnectionProfile {
            id: "replace".into(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some(":memory:".into()),
            url: None,
        };
        connect_impl(&state, profile.clone())
            .await
            .expect("connect memory");
        run_query_impl(
            &state,
            "replace".into(),
            "create table t(id integer)".into(),
            None,
        )
        .await
        .expect("create");

        connect_impl(&state, profile)
            .await
            .expect("reconnect memory");
        let err = run_query_impl(&state, "replace".into(), "select * from t".into(), None)
            .await
            .unwrap_err();
        assert!(
            err.to_ascii_lowercase().contains("no such table"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn secret_redaction_handles_urls_and_connection_strings() {
        let profile = ConnectionProfile {
            id: "redact".into(),
            engine: DbEngine::Postgres,
            host: None,
            port: None,
            user: Some("user".into()),
            password: Some("secret".into()),
            database: None,
            url: Some("postgres://user:secret@localhost/samples".into()),
        };
        let message = "connect failed for postgres://user:secret@localhost/samples; Password=secret; PWD=other;";
        let redacted = redact_secret_text(message, &profile);
        assert!(!redacted.contains("secret"), "{redacted}");
        assert!(!redacted.contains("other"), "{redacted}");
        assert!(redacted.contains("postgres://user:****@localhost/samples"));
        assert!(redacted.contains("Password=****;"));
        assert!(redacted.contains("PWD=****;"));
    }
}
