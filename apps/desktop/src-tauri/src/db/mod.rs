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

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use irodori_core::{AuditEventKind, IrodoriError, Result as IrodoriResult};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::security::SecurityState;
use irodori_completion::metadata::MetadataCache;

mod bigquery;
mod bigtable;
mod cassandra;
mod clickhouse;
#[cfg(feature = "duckdb")]
mod duck;
mod edit;
mod engine;
mod influx;
mod meta;
mod mongo;
mod mssql;
mod mysql;
mod neo4j;
mod oracle;
mod postgres;
mod profile;
mod query;
mod redis;
mod snowflake;
mod spill;
mod sqlite;
mod stream;

pub use edit::{AppliedEdits, CellValue, RowDelete, RowInsert, RowUpdate, TableEdits};
pub use engine::DbEngine;
use engine::Wire;
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

// ---- The per-engine connection abstraction ------------------------------------

/// A live connection to one database. Each engine implements this over its native
/// client; the rest of the app never matches on the engine.
#[async_trait]
trait Connection: Send + Sync {
    fn wire(&self) -> Wire;
    async fn version(&self) -> Option<String>;
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String>;
    async fn run_prepared_query(
        &self,
        query: &PreparedQuery,
        cap: usize,
    ) -> Result<RowSet, String> {
        if query.params.is_empty() {
            self.run_query(&query.sql, cap).await
        } else {
            Err("query parameters are not supported for this engine yet".to_string())
        }
    }
    async fn run_query_sets(&self, sql: &str, cap: usize) -> Result<Vec<RawResultSet>, String> {
        let start = Instant::now();
        let (columns, rows, truncated) = self.run_query(sql, cap).await?;
        Ok(vec![RawResultSet {
            statement_index: 0,
            statement: sql.to_string(),
            columns,
            rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
        }])
    }
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
            result_sets: vec![stream::StreamResultSetSummary {
                result_set_index: ctx.result_set_index,
                row_count,
                truncated,
                elapsed_ms: 0,
            }],
            truncated,
            row_count,
        })
    }

    async fn stream_prepared_query(
        &self,
        query: &PreparedQuery,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        if query.params.is_empty() {
            self.stream_query(&query.sql, ctx).await
        } else {
            Err("query parameters are not supported for this engine yet".to_string())
        }
    }

    async fn stream_query_sets(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        let start = Instant::now();
        let mut summary = self.stream_query(sql, ctx).await?;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        for result_set in &mut summary.result_sets {
            result_set.elapsed_ms = elapsed_ms;
        }
        Ok(summary)
    }
}

struct PgConn {
    pool: sqlx::PgPool,
    engine: DbEngine,
}
#[async_trait]
impl Connection for PgConn {
    fn wire(&self) -> Wire {
        self.engine.wire()
    }

    async fn version(&self) -> Option<String> {
        postgres::version(&self.pool).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        postgres::run_query(&self.pool, sql, cap).await
    }
    async fn run_prepared_query(
        &self,
        query: &PreparedQuery,
        cap: usize,
    ) -> Result<RowSet, String> {
        postgres::run_prepared_query(&self.pool, query, cap).await
    }
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        postgres::stream_query(&self.pool, sql, ctx).await
    }
    async fn stream_prepared_query(
        &self,
        query: &PreparedQuery,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        postgres::stream_prepared_query(&self.pool, query, ctx).await
    }
    async fn apply_edits(&self, edits: &TableEdits) -> Result<AppliedEdits, String> {
        postgres::apply_edits(&self.pool, edits).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        postgres::metadata(&self.pool, self.engine).await
    }
    async fn close(&self) {
        self.pool.close().await
    }
}

struct Neo4jConnection(neo4j::Neo4jConn);
#[async_trait]
impl Connection for Neo4jConnection {
    fn wire(&self) -> Wire {
        Wire::Neo4j
    }

    async fn version(&self) -> Option<String> {
        neo4j::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        neo4j::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        neo4j::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct InfluxConnection(influx::InfluxConn);
#[async_trait]
impl Connection for InfluxConnection {
    fn wire(&self) -> Wire {
        Wire::InfluxDb
    }

    async fn version(&self) -> Option<String> {
        influx::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        influx::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        influx::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct MysqlConn(sqlx::MySqlPool);
#[async_trait]
impl Connection for MysqlConn {
    fn wire(&self) -> Wire {
        Wire::Mysql
    }

    async fn version(&self) -> Option<String> {
        mysql::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        mysql::run_query(&self.0, sql, cap).await
    }
    async fn run_prepared_query(
        &self,
        query: &PreparedQuery,
        cap: usize,
    ) -> Result<RowSet, String> {
        mysql::run_prepared_query(&self.0, query, cap).await
    }
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        mysql::stream_query(&self.0, sql, ctx).await
    }
    async fn stream_prepared_query(
        &self,
        query: &PreparedQuery,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        mysql::stream_prepared_query(&self.0, query, ctx).await
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
    fn wire(&self) -> Wire {
        Wire::Sqlite
    }

    async fn version(&self) -> Option<String> {
        sqlite::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        sqlite::run_query(&self.0, sql, cap).await
    }
    async fn run_prepared_query(
        &self,
        query: &PreparedQuery,
        cap: usize,
    ) -> Result<RowSet, String> {
        sqlite::run_prepared_query(&self.0, query, cap).await
    }
    async fn run_query_sets(&self, sql: &str, cap: usize) -> Result<Vec<RawResultSet>, String> {
        sqlite::run_query_sets(&self.0, sql, cap).await
    }
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        sqlite::stream_query(&self.0, sql, ctx).await
    }
    async fn stream_prepared_query(
        &self,
        query: &PreparedQuery,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        sqlite::stream_prepared_query(&self.0, query, ctx).await
    }
    async fn stream_query_sets(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        sqlite::stream_query_sets(&self.0, sql, ctx).await
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
    fn wire(&self) -> Wire {
        Wire::SqlServer
    }

    async fn version(&self) -> Option<String> {
        mssql::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        mssql::run_query(&self.0, sql, cap).await
    }
    async fn run_prepared_query(
        &self,
        query: &PreparedQuery,
        cap: usize,
    ) -> Result<RowSet, String> {
        mssql::run_prepared_query(&self.0, query, cap).await
    }
    async fn stream_query(
        &self,
        sql: &str,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        mssql::stream_query(&self.0, sql, ctx).await
    }
    async fn stream_prepared_query(
        &self,
        query: &PreparedQuery,
        ctx: &stream::StreamCtx,
    ) -> Result<stream::StreamSummary, String> {
        mssql::stream_prepared_query(&self.0, query, ctx).await
    }
    async fn apply_edits(&self, edits: &TableEdits) -> Result<AppliedEdits, String> {
        mssql::apply_edits(&self.0, edits).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        mssql::metadata(&self.0).await
    }
    async fn close(&self) {} // tiberius closes when its last handle drops
}

struct MongoConn(mongo::MongoHandle);
#[async_trait]
impl Connection for MongoConn {
    fn wire(&self) -> Wire {
        Wire::Mongo
    }

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
    fn wire(&self) -> Wire {
        Wire::Oracle
    }

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
    fn wire(&self) -> Wire {
        Wire::DuckDb
    }

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

struct ClickHouseConnection(clickhouse::ClickHouseConn);
#[async_trait]
impl Connection for ClickHouseConnection {
    fn wire(&self) -> Wire {
        Wire::ClickHouse
    }
    async fn version(&self) -> Option<String> {
        clickhouse::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        clickhouse::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        clickhouse::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct SnowflakeConnection(snowflake::SnowflakeConn);
#[async_trait]
impl Connection for SnowflakeConnection {
    fn wire(&self) -> Wire {
        Wire::Snowflake
    }
    async fn version(&self) -> Option<String> {
        snowflake::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        snowflake::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        snowflake::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct BigQueryConnection(bigquery::BigQueryConn);
#[async_trait]
impl Connection for BigQueryConnection {
    fn wire(&self) -> Wire {
        Wire::BigQuery
    }
    async fn version(&self) -> Option<String> {
        bigquery::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        bigquery::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        bigquery::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct BigtableConnection(bigtable::BigtableConn);
#[async_trait]
impl Connection for BigtableConnection {
    fn wire(&self) -> Wire {
        Wire::Bigtable
    }
    async fn version(&self) -> Option<String> {
        bigtable::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        bigtable::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        bigtable::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct RedisConnection(redis::RedisConn);
#[async_trait]
impl Connection for RedisConnection {
    fn wire(&self) -> Wire {
        Wire::Redis
    }
    async fn version(&self) -> Option<String> {
        redis::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        redis::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        redis::metadata(&self.0).await
    }
    async fn close(&self) {}
}

struct CassandraConnection(cassandra::CassandraConn);
#[async_trait]
impl Connection for CassandraConnection {
    fn wire(&self) -> Wire {
        Wire::Cassandra
    }
    async fn version(&self) -> Option<String> {
        cassandra::version(&self.0).await
    }
    async fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        cassandra::run_query(&self.0, sql, cap).await
    }
    async fn metadata(&self) -> Result<DatabaseMetadata, String> {
        cassandra::metadata(&self.0).await
    }
    async fn close(&self) {}
}

/// The single connector/registry: map an engine's wire protocol to a concrete
/// [`Connection`]. This is the only place that knows every engine.
async fn connect_engine(profile: &ConnectionProfile) -> Result<Arc<dyn Connection>, String> {
    let conn: Arc<dyn Connection> = match profile.engine.wire() {
        Wire::Postgres => Arc::new(PgConn {
            pool: postgres::connect(&engine::build_url(profile)?).await?,
            engine: profile.engine,
        }),
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
        Wire::Neo4j => Arc::new(Neo4jConnection(neo4j::connect(profile).await?)),
        Wire::InfluxDb => Arc::new(InfluxConnection(influx::connect(profile).await?)),
        Wire::ClickHouse => Arc::new(ClickHouseConnection(clickhouse::connect(profile).await?)),
        Wire::Snowflake => Arc::new(SnowflakeConnection(snowflake::connect(profile).await?)),
        Wire::BigQuery => Arc::new(BigQueryConnection(bigquery::connect(profile).await?)),
        Wire::Bigtable => Arc::new(BigtableConnection(bigtable::connect(profile).await?)),
        Wire::Redis => Arc::new(RedisConnection(redis::connect(profile).await?)),
        Wire::Cassandra => Arc::new(CassandraConnection(cassandra::connect(profile).await?)),
        Wire::Memgraph | Wire::Qdrant | Wire::Milvus | Wire::Pinecone => {
            return Err(format!(
                "{:?} driver is not yet fully implemented",
                profile.engine
            ));
        }
    };
    Ok(conn)
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

use irodori_proxy::{
    start_forwarder, ResolvedProxy, ResolvedProxyAuth, ResolvedProxyChain, ResolvedProxyChainHop,
    ResolvedProxyHopConfig, ResolvedSshAuth, ResolvedSshTunnel, ResolvedTransport,
};

async fn resolve_secret_ref(
    store: &irodori_secure_store::OsKeychainStore,
    secret_ref: &irodori_core::SecretRef,
) -> Result<String, String> {
    use irodori_secure_store::SecureStore;
    store
        .get(secret_ref)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("secret not found for handle: {}", secret_ref.handle))
}

async fn resolve_transport(
    store: &irodori_secure_store::OsKeychainStore,
    transport: &irodori_core::TransportConfig,
) -> Result<ResolvedTransport, String> {
    match transport {
        irodori_core::TransportConfig::Direct(_) | irodori_core::TransportConfig::LocalFile(_) => {
            Err("direct and local file transports do not require resolution".to_string())
        }
        irodori_core::TransportConfig::SshTunnel(tunnel) => {
            let auth = match &tunnel.auth {
                irodori_core::SshAuthConfig::Agent => ResolvedSshAuth::Agent,
                irodori_core::SshAuthConfig::Password { password } => {
                    let pass = resolve_secret_ref(store, password).await?;
                    ResolvedSshAuth::Password(pass)
                }
                irodori_core::SshAuthConfig::PrivateKey {
                    private_key,
                    passphrase,
                } => {
                    let key = resolve_secret_ref(store, private_key).await?;
                    let pass = match passphrase {
                        Some(ref handle) => Some(resolve_secret_ref(store, handle).await?),
                        None => None,
                    };
                    ResolvedSshAuth::PrivateKey {
                        private_key: key,
                        passphrase: pass,
                    }
                }
            };
            Ok(ResolvedTransport::SshTunnel(ResolvedSshTunnel {
                ssh_host: tunnel.ssh_host.clone(),
                ssh_port: tunnel.ssh_port,
                username: tunnel.username.clone(),
                auth,
                target_host: tunnel.target_host.clone(),
                target_port: tunnel.target_port,
                strict_host_key: tunnel.strict_host_key,
                host_key: tunnel.host_key.clone(),
            }))
        }
        irodori_core::TransportConfig::Socks5Proxy(proxy) => {
            let auth = match &proxy.auth {
                Some(auth) => Some(ResolvedProxyAuth {
                    username: auth.username.clone(),
                    password: resolve_secret_ref(store, &auth.password).await?,
                }),
                None => None,
            };
            let target_host = proxy
                .target_host
                .clone()
                .ok_or("proxy target host is missing")?;
            let target_port = proxy.target_port.ok_or("proxy target port is missing")?;
            Ok(ResolvedTransport::Socks5Proxy(ResolvedProxy {
                host: proxy.host.clone(),
                port: proxy.port,
                auth,
                target_host,
                target_port,
                tls: proxy.tls,
            }))
        }
        irodori_core::TransportConfig::HttpConnectProxy(proxy) => {
            let auth = match &proxy.auth {
                Some(auth) => Some(ResolvedProxyAuth {
                    username: auth.username.clone(),
                    password: resolve_secret_ref(store, &auth.password).await?,
                }),
                None => None,
            };
            let target_host = proxy
                .target_host
                .clone()
                .ok_or("proxy target host is missing")?;
            let target_port = proxy.target_port.ok_or("proxy target port is missing")?;
            Ok(ResolvedTransport::HttpConnectProxy(ResolvedProxy {
                host: proxy.host.clone(),
                port: proxy.port,
                auth,
                target_host,
                target_port,
                tls: proxy.tls,
            }))
        }
        irodori_core::TransportConfig::Chain(chain) => {
            let mut resolved_hops = Vec::new();
            for hop in &chain.hops {
                let resolved_hop_config = match &hop.config {
                    irodori_core::ProxyHopConfig::Ssh(ssh_hop) => {
                        let auth = match &ssh_hop.auth {
                            irodori_core::SshAuthConfig::Agent => ResolvedSshAuth::Agent,
                            irodori_core::SshAuthConfig::Password { password } => {
                                let pass = resolve_secret_ref(store, password).await?;
                                ResolvedSshAuth::Password(pass)
                            }
                            irodori_core::SshAuthConfig::PrivateKey {
                                private_key,
                                passphrase,
                            } => {
                                let key = resolve_secret_ref(store, private_key).await?;
                                let pass = match passphrase {
                                    Some(ref handle) => {
                                        Some(resolve_secret_ref(store, handle).await?)
                                    }
                                    None => None,
                                };
                                ResolvedSshAuth::PrivateKey {
                                    private_key: key,
                                    passphrase: pass,
                                }
                            }
                        };
                        ResolvedProxyHopConfig::Ssh {
                            ssh_host: ssh_hop.ssh_host.clone(),
                            ssh_port: ssh_hop.ssh_port,
                            username: ssh_hop.username.clone(),
                            auth,
                            strict_host_key: ssh_hop.strict_host_key,
                            host_key: ssh_hop.host_key.clone(),
                        }
                    }
                    irodori_core::ProxyHopConfig::Socks5(proxy) => {
                        let auth = match &proxy.auth {
                            Some(auth) => Some(ResolvedProxyAuth {
                                username: auth.username.clone(),
                                password: resolve_secret_ref(store, &auth.password).await?,
                            }),
                            None => None,
                        };
                        ResolvedProxyHopConfig::Socks5 {
                            host: proxy.host.clone(),
                            port: proxy.port,
                            auth,
                        }
                    }
                    irodori_core::ProxyHopConfig::HttpConnect(proxy) => {
                        let auth = match &proxy.auth {
                            Some(auth) => Some(ResolvedProxyAuth {
                                username: auth.username.clone(),
                                password: resolve_secret_ref(store, &auth.password).await?,
                            }),
                            None => None,
                        };
                        ResolvedProxyHopConfig::HttpConnect {
                            host: proxy.host.clone(),
                            port: proxy.port,
                            auth,
                        }
                    }
                };
                resolved_hops.push(ResolvedProxyChainHop {
                    name: hop.name.clone(),
                    config: resolved_hop_config,
                });
            }
            Ok(ResolvedTransport::Chain(ResolvedProxyChain {
                target_host: chain.target_host.clone(),
                target_port: chain.target_port,
                tls: chain.tls,
                hops: resolved_hops,
            }))
        }
    }
}

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
            if let Ok(db_meta) = conn.metadata().await {
                let mut cache = state_inner.metadata_cache.lock().await;
                let snapshot = convert_metadata_to_snapshot(&connection_id, &db_meta);
                cache.upsert_snapshot(snapshot);
                let _ = cache.drain_refresh_requests();
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
    async fn metadata_cache_integration_test() {
        let state = DbState::default();
        let conn_id = "cache_test".to_string();

        // 1. Establish connection to temporary sqlite db
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile(&conn_id),
        )
        .await
        .expect("connect");

        // Give a tiny yield to let the background refresh finish populating the cache
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Verify snapshot is present in the cache
        {
            let cache = state.metadata_cache.lock().await;
            assert!(cache.snapshot(&conn_id).is_some());
            assert_eq!(cache.list_schemas(&conn_id)[0].name, "main");
        }

        // 2. Clear cache manually and test list_objects_impl fetches blockingly and populates cache
        {
            let mut cache = state.metadata_cache.lock().await;
            cache.invalidate_connection(&conn_id);
            assert!(cache.snapshot(&conn_id).is_none());
        }

        // Call list_objects_impl (which will fetch blockingly and populate)
        let db_meta = list_objects_impl(&state, conn_id.clone())
            .await
            .expect("list objects");
        assert!(!db_meta.schemas.is_empty());

        // Verify cache is populated again
        {
            let cache = state.metadata_cache.lock().await;
            assert!(cache.snapshot(&conn_id).is_some());
        }

        // 3. Test autocomplete on the cached metadata directly via irodori_completion
        {
            // First create a table
            run_query_impl(
                &state,
                conn_id.clone(),
                "create table test_table (id integer primary key, name text)".into(),
                None,
            )
            .await
            .expect("create table");

            // Invalidate to trigger a fresh metadata fetch in background / next load
            let mut cache = state.metadata_cache.lock().await;
            cache.invalidate_connection(&conn_id);
        }

        // Fetch objects blockingly to warm cache with new table
        list_objects_impl(&state, conn_id.clone())
            .await
            .expect("list objects");

        // Query autocomplete directly on cache
        let cache = state.metadata_cache.lock().await;
        let engine = irodori_completion::CompletionEngine::new();
        let req = irodori_completion::CompletionRequest::new(&conn_id).with_prefix("test");
        let items = engine.complete(&cache, &req);
        assert!(!items.is_empty());
        assert!(items.iter().any(|item| item.label == "test_table"));

        // 4. Test hover inspection card directly on cache
        let card =
            irodori_completion::inspection::inspect_object(&cache, &conn_id, "main", "test_table")
                .expect("card present");
        match card {
            irodori_completion::inspection::InspectionCard::Object(obj) => {
                assert_eq!(obj.name, "test_table");
                assert_eq!(obj.schema, "main");
                assert_eq!(obj.columns.len(), 2);
            }
            _ => panic!("expected object card"),
        }
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
        connect_impl(&state, &SecurityState::default(), temp_sqlite_profile("st"))
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
                stream::FetchEvent::Columns {
                    result_set_index,
                    columns: c,
                } => {
                    assert_eq!(result_set_index, 0);
                    columns = c;
                }
                stream::FetchEvent::Rows {
                    result_set_index,
                    rows: mut r,
                } => {
                    assert_eq!(result_set_index, 0);
                    rows.append(&mut r);
                }
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
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("stcap"),
        )
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
            if let stream::FetchEvent::Rows { rows: r, .. } = event {
                delivered += r.len();
            }
        }
        assert_eq!(delivered, 2);
    }

    #[test]
    fn splits_sql_statements_without_cutting_literals_or_comments() {
        assert_eq!(
            split_sql_statements("select 1; select 2;"),
            vec!["select 1", "select 2"]
        );
        assert_eq!(
            split_sql_statements("select ';'; -- ignored ;\n select 2"),
            vec!["select ';'", "-- ignored ;\n select 2"]
        );
        assert_eq!(
            split_sql_statements(r#"select "semi;colon"; select 2"#),
            vec![r#"select "semi;colon""#, "select 2"]
        );
        assert_eq!(
            split_sql_statements("select /* ; */ 1; select $$;$$"),
            vec!["select /* ; */ 1", "select $$;$$"]
        );
    }

    #[tokio::test]
    async fn sqlite_multi_statement_run_returns_result_sets() {
        let state = DbState::default();
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("multi"),
        )
        .await
        .expect("connect");

        let result = run_query_impl(
            &state,
            "multi".into(),
            "select 1 as one; select 'two' as two".into(),
            None,
        )
        .await
        .expect("multi run");

        assert_eq!(result.columns, vec!["one"]);
        assert_eq!(result.rows[0][0], serde_json::json!(1));
        assert_eq!(result.result_sets.len(), 2);
        assert_eq!(result.result_sets[0].statement_index, 0);
        assert_eq!(result.result_sets[0].columns, vec!["one"]);
        assert_eq!(result.result_sets[1].statement_index, 1);
        assert_eq!(result.result_sets[1].columns, vec!["two"]);
        assert_eq!(result.result_sets[1].rows[0][0], serde_json::json!("two"));
    }

    #[tokio::test]
    async fn sqlite_multi_statement_stream_tags_result_set_events() {
        let state = DbState::default();
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("multistream"),
        )
        .await
        .expect("connect");

        let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
        let summary = run_query_stream_impl(
            &state,
            "multistream".into(),
            "select 1 as one; select 2 as two".into(),
            None,
            None,
            None,
            tx,
        )
        .await
        .expect("stream");

        assert_eq!(summary.result_sets.len(), 2);
        assert_eq!(summary.row_count, 2);
        let mut seen = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                stream::FetchEvent::Columns {
                    result_set_index,
                    columns,
                } => seen.push((result_set_index, columns.join(","))),
                stream::FetchEvent::Rows {
                    result_set_index,
                    rows,
                } => seen.push((result_set_index, rows.len().to_string())),
            }
        }
        assert!(seen.contains(&(0, "one".to_string())));
        assert!(seen.contains(&(0, "1".to_string())));
        assert!(seen.contains(&(1, "two".to_string())));
        assert!(seen.contains(&(1, "1".to_string())));
    }

    #[tokio::test]
    async fn query_parameters_are_detected_bound_and_streamed() {
        let state = DbState::default();
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("params"),
        )
        .await
        .expect("connect");
        run_query_impl(
            &state,
            "params".into(),
            "create table t(id integer, name text, active integer)".into(),
            None,
        )
        .await
        .expect("create");
        run_query_impl(
            &state,
            "params".into(),
            "insert into t values (1,'ann',1),(2,'bob',0),(3,'ann',1)".into(),
            None,
        )
        .await
        .expect("insert");

        let sql = "select id from t where name = :name and active = ? order by id";
        let prompts = query_parameter_prompt_set(sql).expect("prompts");
        assert_eq!(prompts.prompts.len(), 2);
        assert_eq!(prompts.prompts[0].id, "name:name");
        assert_eq!(prompts.prompts[1].id, "position:1");

        let params = vec![
            QueryParameterInput {
                key: QueryParameterKey::Name {
                    name: "name".into(),
                },
                value: serde_json::json!("ann"),
            },
            QueryParameterInput {
                key: QueryParameterKey::Position { position: 1 },
                value: serde_json::json!(1),
            },
        ];
        let result = run_query_with_params_impl(
            &state,
            "params".into(),
            sql.into(),
            None,
            Some(params.clone()),
        )
        .await
        .expect("parameterized query");
        assert_eq!(result.columns, vec!["id"]);
        assert_eq!(
            result.rows,
            vec![vec![serde_json::json!(1)], vec![serde_json::json!(3)]]
        );

        let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
        let summary = run_query_stream_with_params_impl(
            &state,
            "params".into(),
            "select name from t where id = :id".into(),
            None,
            None,
            None,
            Some(vec![QueryParameterInput {
                key: QueryParameterKey::Name { name: "id".into() },
                value: serde_json::json!(2),
            }]),
            tx,
        )
        .await
        .expect("parameterized stream");
        assert_eq!(summary.row_count, 1);

        let mut rows = Vec::new();
        while let Some(event) = rx.recv().await {
            if let stream::FetchEvent::Rows { rows: mut r, .. } = event {
                rows.append(&mut r);
            }
        }
        assert_eq!(rows, vec![vec![serde_json::json!("bob")]]);
    }

    #[tokio::test]
    async fn stream_query_stops_on_a_cancelled_token() {
        let state = DbState::default();
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("stcancel"),
        )
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
            result_set_index: 0,
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
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("edit"),
        )
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
        connect_impl(
            &state,
            &SecurityState::default(),
            temp_sqlite_profile("keys"),
        )
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
            transport: None,
            options: Default::default(),
        }
    }

    #[tokio::test]
    async fn sqlite_connect_and_query_round_trip() {
        let state = DbState::default();
        let info = connect_impl(&state, &SecurityState::default(), temp_sqlite_profile("rt"))
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
            transport: None,
            options: Default::default(),
        };
        connect_impl(&state, &SecurityState::default(), profile)
            .await
            .expect("connect memory");
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
    async fn spill_run_keeps_memory_flat_and_pages_deep_rows_from_disk() {
        // EXEC-010 end-to-end: stream a result far larger than the in-memory budget
        // through the disk-offload path against a real SQLite connection, then prove
        // (a) only the resident page streams to the UI, (b) the store retains every
        // row with RAM bounded by the budget, and (c) deep windows page back from
        // disk correctly, including across the RAM/disk seam and at the tail.
        let state = DbState::default();
        let profile = ConnectionProfile {
            id: "spill".into(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some(":memory:".into()),
            url: None,
            transport: None,
            options: Default::default(),
        };
        connect_impl(&state, &SecurityState::default(), profile)
            .await
            .expect("connect memory");

        const TOTAL: u64 = 50_000;
        const BUDGET: usize = 500;
        let config = SpillConfig {
            memory_budget: BUDGET,
            offload_enabled: true,
            max_total_rows: MAX_SPILL_ROWS,
        };
        // A recursive CTE generates TOTAL rows server-side so the stream is real.
        let sql = format!(
            "WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n + 1 < {TOTAL}) \
             SELECT n, 'row_' || n AS label FROM seq"
        );

        // Drain the UI prefix channel concurrently so the producer never blocks.
        let (ui_tx, mut ui_rx) = mpsc::channel::<stream::FetchEvent>(16);
        let drain = tokio::spawn(async move {
            let mut prefix_rows = 0u64;
            let mut columns: Vec<String> = Vec::new();
            while let Some(event) = ui_rx.recv().await {
                match event {
                    stream::FetchEvent::Columns { columns: cols, .. } => columns = cols,
                    stream::FetchEvent::Rows { rows, .. } => prefix_rows += rows.len() as u64,
                }
            }
            (columns, prefix_rows)
        });

        let result =
            run_query_spill_impl(&state, "spill".into(), sql, config, None, None, None, ui_tx)
                .await
                .expect("spill run");
        let (columns, prefix_rows) = drain.await.expect("drain ui channel");

        assert_eq!(
            result.total_rows, TOTAL,
            "the store retains every streamed row"
        );
        assert_eq!(
            result.in_memory_rows, BUDGET as u64,
            "the resident page is exactly the budget"
        );
        assert!(result.spilled, "overflow spilled to disk");
        assert!(!result.truncated);
        assert_eq!(
            prefix_rows, BUDGET as u64,
            "only the resident page is forwarded to the UI"
        );
        assert_eq!(columns, vec!["n".to_string(), "label".to_string()]);

        for &offset in &[0u64, 499, 500, 25_000, 49_995] {
            let page = result_window_impl(&state, result.handle.clone(), offset, 3)
                .await
                .expect("window");
            assert_eq!(page.offset, offset);
            let want = (3u64).min(TOTAL - offset) as usize;
            assert_eq!(page.rows.len(), want, "row count at offset {offset}");
            for (i, row) in page.rows.iter().enumerate() {
                let n = offset + i as u64;
                assert_eq!(row[0], serde_json::json!(n as i64), "n at offset {offset}");
                assert_eq!(
                    row[1],
                    serde_json::json!(format!("row_{n}")),
                    "label at offset {offset}"
                );
            }
        }

        assert!(
            release_result_impl(&state, result.handle.clone()).await,
            "release frees the retained store"
        );
        assert!(
            !release_result_impl(&state, result.handle).await,
            "double release is a no-op"
        );
    }

    #[tokio::test]
    async fn spill_run_offload_disabled_caps_at_budget() {
        // With offload off the disk path is never taken: the result caps at the
        // budget and reports truncation, matching the legacy bounded-memory page.
        let state = DbState::default();
        let profile = ConnectionProfile {
            id: "cap".into(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some(":memory:".into()),
            url: None,
            transport: None,
            options: Default::default(),
        };
        connect_impl(&state, &SecurityState::default(), profile)
            .await
            .expect("connect memory");

        let config = SpillConfig {
            memory_budget: 100,
            offload_enabled: false,
            max_total_rows: MAX_SPILL_ROWS,
        };
        let sql = "WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n + 1 < 5000) \
                   SELECT n FROM seq"
            .to_string();
        let (ui_tx, mut ui_rx) = mpsc::channel::<stream::FetchEvent>(16);
        let drain = tokio::spawn(async move { while ui_rx.recv().await.is_some() {} });
        let result =
            run_query_spill_impl(&state, "cap".into(), sql, config, None, None, None, ui_tx)
                .await
                .expect("spill run");
        drain.await.expect("drain");
        assert_eq!(result.total_rows, 100, "capped at the budget");
        assert!(!result.spilled, "offload off never creates a temp file");
        assert!(result.truncated);
    }

    #[tokio::test]
    async fn command_boundary_rejects_invalid_inputs() {
        let state = DbState::default();
        let mut invalid = temp_sqlite_profile("invalid");
        invalid.id = "  ".into();
        let err = connect_impl(&state, &SecurityState::default(), invalid)
            .await
            .unwrap_err();
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
            transport: None,
            options: Default::default(),
        };
        let err = connect_impl(&state, &SecurityState::default(), missing_host)
            .await
            .unwrap_err();
        assert!(err.contains("host is required"));

        let unsupported = ConnectionProfile {
            id: "pinecone".into(),
            engine: DbEngine::Pinecone,
            host: Some("localhost".into()),
            port: None,
            user: None,
            password: None,
            database: None,
            url: None,
            transport: None,
            options: Default::default(),
        };
        let err = connect_impl(&state, &SecurityState::default(), unsupported)
            .await
            .unwrap_err();
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
            &SecurityState::default(),
            ConnectionProfile {
                id: "bounds".into(),
                engine: DbEngine::Sqlite,
                host: None,
                port: None,
                user: None,
                password: None,
                database: Some(":memory:".into()),
                url: None,
                transport: None,
                options: Default::default(),
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
            transport: None,
            options: Default::default(),
        };
        connect_impl(&state, &SecurityState::default(), profile.clone())
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

        connect_impl(&state, &SecurityState::default(), profile)
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
            transport: None,
            options: Default::default(),
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
