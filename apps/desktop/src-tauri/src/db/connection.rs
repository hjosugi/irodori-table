use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use tokio::sync::Mutex;

#[cfg(feature = "duckdb")]
use super::duck;
use super::edit::{AppliedEdits, TableEdits};
use super::engine::{self, Wire};
use super::profile::ConnectionProfile;
use super::query::{PreparedQuery, RawResultSet, RowSet};
use super::stream;
use super::{
    bigquery, bigtable, cassandra, clickhouse, influx, mongo, mssql, mysql, neo4j, oracle,
    postgres, redis, snowflake, sqlite, DatabaseMetadata, DbEngine,
};

// ---- The per-engine connection abstraction ------------------------------------

/// A live connection to one database. Each engine implements this over its native
/// client; the rest of the app never matches on the engine.
#[async_trait]
pub(crate) trait Connection: Send + Sync {
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
pub(crate) async fn connect_engine(
    profile: &ConnectionProfile,
) -> Result<Arc<dyn Connection>, String> {
    let conn: Arc<dyn Connection> = match profile.engine.wire() {
        Wire::Postgres => Arc::new(PgConn {
            pool: postgres::connect(&engine::build_url(profile)?).await?,
            engine: profile.engine,
        }),
        Wire::Mysql => Arc::new(MysqlConn(
            mysql::connect(&engine::build_url(profile)?).await?,
        )),
        Wire::Sqlite => {
            let pool = sqlite::connect(&engine::build_url(profile)?).await?;
            if should_seed_builtin_sample(profile) {
                sqlite::seed_sample(&pool).await?;
            }
            Arc::new(SqliteConn(pool))
        }
        Wire::SqlServer => Arc::new(MssqlConn(Arc::new(Mutex::new(
            mssql::connect(profile).await?,
        )))),
        Wire::Mongo => Arc::new(MongoConn(mongo::connect(profile).await?)),
        Wire::DuckDb => {
            #[cfg(feature = "duckdb")]
            {
                let conn = duck::connect(profile)?;
                if should_seed_builtin_sample(profile) {
                    duck::seed_sample(&conn)?;
                }
                Arc::new(DuckConn(Arc::new(std::sync::Mutex::new(conn))))
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
        Wire::Memgraph
        | Wire::Qdrant
        | Wire::Milvus
        | Wire::Pinecone
        | Wire::Jdbc
        | Wire::Search
        | Wire::Document
        | Wire::KeyValue
        | Wire::Graph
        | Wire::TimeSeries
        | Wire::Lakehouse
        | Wire::ObjectStore => {
            return Err(format!(
                "{:?} driver is not yet fully implemented",
                profile.engine
            ));
        }
    };
    Ok(conn)
}

fn should_seed_builtin_sample(profile: &ConnectionProfile) -> bool {
    if !matches!(profile.id.as_str(), "sqlite-memory" | "duckdb-memory") {
        return false;
    }
    match profile.database.as_deref().map(str::trim) {
        None | Some("") | Some(":memory:") => true,
        Some(_) => false,
    }
}
