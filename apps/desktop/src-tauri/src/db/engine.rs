//! Engine identity, wire-protocol routing, and connection-URL building.
//!
//! `wire()` separates the *protocol* an engine speaks (which driver handles it)
//! from the engine identity — so CockroachDB/Yugabyte/Redshift/Timescale ride the
//! Postgres driver and MariaDB/TiDB ride MySQL. `dialect()` and `metamodel()`
//! hang per-engine quoting/paging and generic information-schema query builders
//! off the same registry.

use irodori_sql::dialect::{
    MySqlDialect, OracleDialect, PostgresDialect, SnowflakeDialect, SqlDialect, SqlServerDialect,
    SqliteDialect,
};
use irodori_sql::metamodel::{
    InformationSchemaMetamodel, MySqlInformationSchema, PostgresInformationSchema,
    SqliteCatalogMetamodel, StandardInformationSchema,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ConnectionProfile, DbError, DbResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DbEngine {
    Postgres,
    Mysql,
    Sqlite,
    Oracle,
    #[serde(rename = "sqlserver")]
    #[ts(rename = "sqlserver")]
    SqlServer,
    #[serde(rename = "duckdb")]
    #[ts(rename = "duckdb")]
    DuckDb,
    #[serde(rename = "motherduck")]
    #[ts(rename = "motherduck")]
    MotherDuck,
    // Document store — not SQL; its own driver and query model.
    #[serde(rename = "mongodb")]
    #[ts(rename = "mongodb")]
    Mongo,
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
    // Serverless Postgres / Postgres-wire compatible engines.
    #[serde(rename = "neon")]
    #[ts(rename = "neon")]
    Neon,
    #[serde(rename = "supabase")]
    #[ts(rename = "supabase")]
    Supabase,
    #[serde(rename = "h2")]
    #[ts(rename = "h2")]
    H2,
    // Columnar/Analytics
    #[serde(rename = "clickhouse")]
    #[ts(rename = "clickhouse")]
    ClickHouse,
    // Graph DBs
    #[serde(rename = "neo4j")]
    #[ts(rename = "neo4j")]
    Neo4j,
    #[serde(rename = "memgraph")]
    #[ts(rename = "memgraph")]
    Memgraph,
    // Time-series / Timeline DBs
    #[serde(rename = "influxdb")]
    #[ts(rename = "influxdb")]
    InfluxDb,
    // Vector DBs
    #[serde(rename = "qdrant")]
    #[ts(rename = "qdrant")]
    Qdrant,
    #[serde(rename = "milvus")]
    #[ts(rename = "milvus")]
    Milvus,
    #[serde(rename = "pinecone")]
    #[ts(rename = "pinecone")]
    Pinecone,
    #[serde(rename = "snowflake")]
    #[ts(rename = "snowflake")]
    Snowflake,
    #[serde(rename = "bigquery")]
    #[ts(rename = "bigquery")]
    BigQuery,
    #[serde(rename = "athena")]
    #[ts(rename = "athena")]
    Athena,
    #[serde(rename = "redis")]
    #[ts(rename = "redis")]
    Redis,
    #[serde(rename = "cassandra")]
    #[ts(rename = "cassandra")]
    Cassandra,
    #[serde(rename = "bigtable")]
    #[ts(rename = "bigtable")]
    Bigtable,
    #[serde(rename = "cloudSpanner")]
    #[ts(rename = "cloudSpanner")]
    CloudSpanner,
    #[serde(rename = "trinoPresto")]
    #[ts(rename = "trinoPresto")]
    TrinoPresto,
    Firebird,
    Databricks,
    #[serde(rename = "elasticsearch")]
    #[ts(rename = "elasticsearch")]
    Elasticsearch,
    #[serde(rename = "openSearch")]
    #[ts(rename = "openSearch")]
    OpenSearch,
    Couchbase,
    #[serde(rename = "dynamodb")]
    #[ts(rename = "dynamodb")]
    DynamoDb,
    #[serde(rename = "scylladb")]
    #[ts(rename = "scylladb")]
    ScyllaDb,
    #[serde(rename = "arangodb")]
    #[ts(rename = "arangodb")]
    ArangoDb,
    #[serde(rename = "questdb")]
    #[ts(rename = "questdb")]
    QuestDb,
    #[serde(rename = "iotdb")]
    #[ts(rename = "iotdb")]
    IoTDb,
    Hive,
    Iceberg,
    #[serde(rename = "s3Tables")]
    #[ts(rename = "s3Tables")]
    S3Tables,
    #[serde(rename = "deltaLake")]
    #[ts(rename = "deltaLake")]
    DeltaLake,
    Hudi,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct EngineBuildSupport {
    pub engine: DbEngine,
    pub included_in_current_build: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub required_feature: Option<String>,
}

/// The wire protocol an engine speaks — i.e. which connector handles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wire {
    Postgres,
    Mysql,
    Sqlite,
    SqlServer,
    DuckDb,
    Mongo,
    Oracle,
    ClickHouse,
    Neo4j,
    Memgraph,
    InfluxDb,
    Qdrant,
    Milvus,
    Pinecone,
    Snowflake,
    BigQuery,
    Redis,
    Cassandra,
    Bigtable,
    CloudSpanner,
    Jdbc,
    Search,
    Document,
    KeyValue,
    Graph,
    TimeSeries,
    Lakehouse,
}

impl DbEngine {
    pub(crate) const ALL: &'static [DbEngine] = &[
        DbEngine::Postgres,
        DbEngine::Mysql,
        DbEngine::Sqlite,
        DbEngine::Oracle,
        DbEngine::SqlServer,
        DbEngine::DuckDb,
        DbEngine::MotherDuck,
        DbEngine::Mongo,
        DbEngine::CockroachDb,
        DbEngine::YugabyteDb,
        DbEngine::Redshift,
        DbEngine::Timescale,
        DbEngine::MariaDb,
        DbEngine::TiDb,
        DbEngine::Neon,
        DbEngine::Supabase,
        DbEngine::H2,
        DbEngine::ClickHouse,
        DbEngine::Neo4j,
        DbEngine::Memgraph,
        DbEngine::InfluxDb,
        DbEngine::Qdrant,
        DbEngine::Milvus,
        DbEngine::Pinecone,
        DbEngine::Snowflake,
        DbEngine::BigQuery,
        DbEngine::Athena,
        DbEngine::Redis,
        DbEngine::Cassandra,
        DbEngine::Bigtable,
        DbEngine::CloudSpanner,
        DbEngine::TrinoPresto,
        DbEngine::Firebird,
        DbEngine::Databricks,
        DbEngine::Elasticsearch,
        DbEngine::OpenSearch,
        DbEngine::Couchbase,
        DbEngine::DynamoDb,
        DbEngine::ScyllaDb,
        DbEngine::ArangoDb,
        DbEngine::QuestDb,
        DbEngine::IoTDb,
        DbEngine::Hive,
        DbEngine::Iceberg,
        DbEngine::S3Tables,
        DbEngine::DeltaLake,
        DbEngine::Hudi,
    ];

    pub(crate) fn all_build_support() -> Vec<EngineBuildSupport> {
        Self::ALL
            .iter()
            .copied()
            .map(DbEngine::build_support)
            .collect()
    }

    pub(crate) fn build_support(self) -> EngineBuildSupport {
        let required_feature = self.required_build_feature();
        EngineBuildSupport {
            engine: self,
            included_in_current_build: required_feature.is_none()
                || self.required_build_feature_enabled(),
            required_feature: required_feature.map(str::to_string),
        }
    }

    pub(crate) fn required_build_feature(self) -> Option<&'static str> {
        match self {
            DbEngine::SqlServer => Some("sqlserver"),
            DbEngine::Mongo => Some("mongo"),
            DbEngine::Oracle => Some("oracle"),
            DbEngine::Neo4j => Some("neo4j"),
            DbEngine::BigQuery => Some("bigquery"),
            DbEngine::Bigtable => Some("bigtable"),
            DbEngine::Redis => Some("redis-connector"),
            DbEngine::Cassandra | DbEngine::ScyllaDb => Some("cassandra"),
            _ => None,
        }
    }

    fn required_build_feature_enabled(self) -> bool {
        match self {
            DbEngine::SqlServer => cfg!(feature = "sqlserver"),
            DbEngine::Mongo => cfg!(feature = "mongo"),
            DbEngine::Oracle => cfg!(feature = "oracle"),
            DbEngine::Neo4j => cfg!(feature = "neo4j"),
            DbEngine::BigQuery => cfg!(feature = "bigquery"),
            DbEngine::Bigtable => cfg!(feature = "bigtable"),
            DbEngine::Redis => cfg!(feature = "redis-connector"),
            DbEngine::Cassandra | DbEngine::ScyllaDb => cfg!(feature = "cassandra"),
            _ => true,
        }
    }

    pub(crate) fn wire(self) -> Wire {
        match self {
            DbEngine::Postgres
            | DbEngine::CockroachDb
            | DbEngine::YugabyteDb
            | DbEngine::Redshift
            | DbEngine::Timescale
            | DbEngine::Neon
            | DbEngine::Supabase
            | DbEngine::H2 => Wire::Postgres,
            DbEngine::Mysql | DbEngine::MariaDb | DbEngine::TiDb => Wire::Mysql,
            DbEngine::Sqlite => Wire::Sqlite,
            DbEngine::SqlServer => Wire::SqlServer,
            DbEngine::DuckDb | DbEngine::MotherDuck => Wire::DuckDb,
            DbEngine::Mongo => Wire::Mongo,
            DbEngine::Oracle => Wire::Oracle,
            DbEngine::ClickHouse => Wire::ClickHouse,
            DbEngine::Neo4j => Wire::Neo4j,
            DbEngine::Memgraph => Wire::Memgraph,
            DbEngine::InfluxDb => Wire::InfluxDb,
            DbEngine::Qdrant => Wire::Qdrant,
            DbEngine::Milvus => Wire::Milvus,
            DbEngine::Pinecone => Wire::Pinecone,
            DbEngine::Snowflake => Wire::Snowflake,
            DbEngine::BigQuery => Wire::BigQuery,
            DbEngine::Redis => Wire::Redis,
            DbEngine::Cassandra => Wire::Cassandra,
            DbEngine::ScyllaDb => Wire::Cassandra,
            DbEngine::Bigtable => Wire::Bigtable,
            DbEngine::CloudSpanner => Wire::CloudSpanner,
            DbEngine::QuestDb => Wire::Postgres,
            DbEngine::TrinoPresto | DbEngine::Firebird | DbEngine::Databricks | DbEngine::Hive => {
                Wire::Jdbc
            }
            DbEngine::Elasticsearch | DbEngine::OpenSearch => Wire::Search,
            DbEngine::Couchbase => Wire::Document,
            DbEngine::DynamoDb => Wire::KeyValue,
            DbEngine::ArangoDb => Wire::Graph,
            DbEngine::IoTDb => Wire::TimeSeries,
            DbEngine::Athena
            | DbEngine::Iceberg
            | DbEngine::S3Tables
            | DbEngine::DeltaLake
            | DbEngine::Hudi => Wire::Lakehouse,
        }
    }

    /// The `sslMode` to apply when the profile does not set one.
    ///
    /// `None` leaves sqlx at its own default (`prefer` for Postgres,
    /// `preferred` for MySQL), which keeps every existing local profile — and
    /// the plaintext containers in `irodori-samples` — connecting exactly as
    /// before.
    ///
    /// Only engines that *cannot* be run locally are opted up to `Require`.
    /// CockroachDB, YugabyteDB, TiDB, and Timescale are all self-hostable and
    /// the sample harness runs them in insecure mode, so raising their floor
    /// here would break `task db-verify` for a guess about intent; a user who
    /// wants TLS on those sets it in the form.
    pub(crate) fn default_ssl_mode(self) -> Option<SslMode> {
        match self {
            DbEngine::Neon | DbEngine::Redshift | DbEngine::Supabase => Some(SslMode::Require),
            _ => None,
        }
    }

    pub(crate) fn default_port(self) -> u16 {
        match self {
            DbEngine::Postgres | DbEngine::Timescale | DbEngine::Neon | DbEngine::Supabase => 5432,
            DbEngine::H2 => 5435,
            DbEngine::CockroachDb => 26257,
            DbEngine::YugabyteDb => 5433,
            DbEngine::Redshift => 5439,
            DbEngine::Mysql | DbEngine::MariaDb => 3306,
            DbEngine::TiDb => 4000,
            DbEngine::SqlServer => 1433,
            DbEngine::Oracle => 1521,
            DbEngine::Mongo => 27017,
            DbEngine::ClickHouse => 8123,
            DbEngine::Neo4j | DbEngine::Memgraph => 7687,
            DbEngine::InfluxDb => 8086,
            DbEngine::Qdrant => 6333,
            DbEngine::Milvus => 19530,
            DbEngine::Snowflake | DbEngine::BigQuery => 443,
            DbEngine::Redis => 6379,
            DbEngine::Cassandra | DbEngine::ScyllaDb => 9042,
            DbEngine::Bigtable => 443,
            DbEngine::CloudSpanner => 443,
            DbEngine::TrinoPresto => 8080,
            DbEngine::Firebird => 3050,
            DbEngine::Databricks => 443,
            DbEngine::Elasticsearch | DbEngine::OpenSearch => 9200,
            DbEngine::Couchbase => 8091,
            DbEngine::DynamoDb => 443,
            DbEngine::ArangoDb => 8529,
            DbEngine::QuestDb => 8812,
            DbEngine::IoTDb => 6667,
            DbEngine::Hive => 10000,
            DbEngine::Athena
            | DbEngine::Iceberg
            | DbEngine::MotherDuck
            | DbEngine::S3Tables
            | DbEngine::DeltaLake
            | DbEngine::Hudi => 443,
            DbEngine::Sqlite | DbEngine::DuckDb | DbEngine::Pinecone => 0,
        }
    }

    pub(crate) fn connector_extension_id(self) -> Option<&'static str> {
        match self {
            DbEngine::DuckDb => Some("irodori.duckdb"),
            DbEngine::MotherDuck => Some("irodori.motherduck"),
            DbEngine::Mongo => Some("irodori.mongodb"),
            DbEngine::Oracle => Some("irodori.oracle"),
            DbEngine::SqlServer => Some("irodori.sqlserver"),
            DbEngine::ClickHouse => Some("irodori.clickhouse"),
            DbEngine::Neo4j => Some("irodori.neo4j"),
            DbEngine::Memgraph => Some("irodori.memgraph"),
            DbEngine::InfluxDb => Some("irodori.influxdb"),
            DbEngine::Qdrant => Some("irodori.qdrant"),
            DbEngine::Milvus => Some("irodori.milvus"),
            DbEngine::Pinecone => Some("irodori.pinecone"),
            DbEngine::Snowflake => Some("irodori.snowflake"),
            DbEngine::BigQuery => Some("irodori.bigquery"),
            DbEngine::Redis => Some("irodori.redis"),
            DbEngine::Cassandra => Some("irodori.cassandra"),
            DbEngine::ScyllaDb => Some("irodori.scylladb"),
            DbEngine::Bigtable => Some("irodori.bigtable"),
            DbEngine::TrinoPresto => Some("irodori.trino-presto"),
            DbEngine::Firebird => Some("irodori.firebird"),
            DbEngine::Databricks => Some("irodori.databricks"),
            DbEngine::Elasticsearch => Some("irodori.elasticsearch"),
            DbEngine::OpenSearch => Some("irodori.opensearch"),
            DbEngine::Couchbase => Some("irodori.couchbase"),
            DbEngine::DynamoDb => Some("irodori.dynamodb"),
            DbEngine::CloudSpanner => Some("irodori.cloud-spanner"),
            DbEngine::ArangoDb => Some("irodori.arangodb"),
            DbEngine::QuestDb => Some("irodori.questdb"),
            DbEngine::IoTDb => Some("irodori.iotdb"),
            DbEngine::Hive => Some("irodori.hive"),
            DbEngine::Athena => Some("irodori.athena"),
            DbEngine::Iceberg => Some("irodori.iceberg"),
            DbEngine::S3Tables => Some("irodori.s3-tables"),
            DbEngine::DeltaLake => Some("irodori.delta-lake"),
            DbEngine::Hudi => Some("irodori.hudi"),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub(crate) fn dialect(self) -> Box<dyn SqlDialect> {
        match self.wire() {
            Wire::Mysql => Box::new(MySqlDialect),
            Wire::Sqlite | Wire::DuckDb => Box::new(SqliteDialect),
            Wire::SqlServer => Box::new(SqlServerDialect),
            Wire::Oracle => Box::new(OracleDialect),
            Wire::Postgres
            | Wire::Mongo
            | Wire::ClickHouse
            | Wire::BigQuery
            | Wire::Redis
            | Wire::Cassandra
            | Wire::Neo4j
            | Wire::Memgraph
            | Wire::InfluxDb
            | Wire::Qdrant
            | Wire::Milvus
            | Wire::Bigtable
            | Wire::CloudSpanner
            | Wire::Pinecone
            | Wire::Jdbc
            | Wire::Search
            | Wire::Document
            | Wire::KeyValue
            | Wire::Graph
            | Wire::TimeSeries
            | Wire::Lakehouse => Box::new(PostgresDialect),
            Wire::Snowflake => Box::new(SnowflakeDialect),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn metamodel(self) -> Box<dyn InformationSchemaMetamodel> {
        match self.wire() {
            Wire::Postgres => Box::new(PostgresInformationSchema),
            Wire::Mysql => Box::new(MySqlInformationSchema),
            Wire::Sqlite | Wire::DuckDb => Box::new(SqliteCatalogMetamodel),
            Wire::SqlServer
            | Wire::Oracle
            | Wire::Mongo
            | Wire::ClickHouse
            | Wire::Snowflake
            | Wire::BigQuery
            | Wire::Redis
            | Wire::Cassandra
            | Wire::Neo4j
            | Wire::Memgraph
            | Wire::InfluxDb
            | Wire::Qdrant
            | Wire::Milvus
            | Wire::Bigtable
            | Wire::CloudSpanner
            | Wire::Pinecone
            | Wire::Jdbc
            | Wire::Search
            | Wire::Document
            | Wire::KeyValue
            | Wire::Graph
            | Wire::TimeSeries
            | Wire::Lakehouse => Box::new(StandardInformationSchema),
        }
    }
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

fn append_query_param(url: &mut String, key: &str, value: &str) {
    url.push(if url.contains('?') { '&' } else { '?' });
    url.push_str(key);
    url.push('=');
    url.push_str(&percent_encode(value));
}

/// Build a sqlx connection URL for the Postgres/MySQL/SQLite drivers. SQL Server,
/// DuckDB, MongoDB, Oracle, and extension-backed engines use dedicated connectors
/// instead.
pub(crate) fn build_url(p: &ConnectionProfile) -> DbResult<String> {
    if let Some(url) = &p.url {
        return Ok(url.clone());
    }
    match p.engine.wire() {
        Wire::Sqlite => {
            let path = p
                .database
                .clone()
                .or_else(|| p.host.clone())
                .ok_or_else(|| {
                    DbError::validation("SQLite needs a database file path (set `database`)")
                })?;
            if path == ":memory:" {
                Ok("sqlite::memory:".into())
            } else {
                Ok(format!("sqlite://{path}?mode=rwc"))
            }
        }
        Wire::Postgres => Ok(build_tcp_url("postgres", p)),
        Wire::Mysql => Ok(build_tcp_url("mysql", p)),
        Wire::SqlServer
        | Wire::DuckDb
        | Wire::Mongo
        | Wire::Oracle
        | Wire::ClickHouse
        | Wire::Snowflake
        | Wire::BigQuery
        | Wire::Redis
        | Wire::Cassandra
        | Wire::Neo4j
        | Wire::Memgraph
        | Wire::InfluxDb
        | Wire::Qdrant
        | Wire::Milvus
        | Wire::Bigtable
        | Wire::CloudSpanner
        | Wire::Pinecone
        | Wire::Jdbc
        | Wire::Search
        | Wire::Document
        | Wire::KeyValue
        | Wire::Graph
        | Wire::TimeSeries
        | Wire::Lakehouse => Err(DbError::unsupported(
            "this engine uses a dedicated connector, not a sqlx URL",
        )),
    }
}

/// How a profile wants the transport secured.
///
/// The app speaks one vocabulary — the PostgreSQL one, whose names users
/// recognise — and each wire translates it to what its driver parses.
/// `Prefer` is sqlx's own default: it attempts TLS and silently continues in
/// plaintext when the server declines, and it verifies nothing. That is fine
/// for a container on localhost and wrong for anything reachable off the box,
/// which is why the hosted engines default to `Require` (see
/// [`DbEngine::default_ssl_mode`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SslMode {
    Disable,
    Allow,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

impl SslMode {
    fn parse(value: &str) -> Option<Self> {
        // Accept both vocabularies so a profile carried over from a MySQL DSN
        // (`REQUIRED`, `VERIFY_IDENTITY`) resolves to the same intent.
        match value.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "disable" | "disabled" => Some(Self::Disable),
            "allow" => Some(Self::Allow),
            "prefer" | "preferred" => Some(Self::Prefer),
            "require" | "required" => Some(Self::Require),
            "verify-ca" => Some(Self::VerifyCa),
            "verify-full" | "verify-identity" => Some(Self::VerifyFull),
            _ => None,
        }
    }

    /// `sslmode` as `sqlx-postgres` parses it.
    fn as_postgres(self) -> &'static str {
        match self {
            Self::Disable => "disable",
            Self::Allow => "allow",
            Self::Prefer => "prefer",
            Self::Require => "require",
            Self::VerifyCa => "verify-ca",
            Self::VerifyFull => "verify-full",
        }
    }

    /// `ssl-mode` as `sqlx-mysql` parses it. MySQL has no `allow`, and its
    /// strongest mode is spelled `verify_identity`.
    fn as_mysql(self) -> &'static str {
        match self {
            Self::Disable => "disabled",
            Self::Allow | Self::Prefer => "preferred",
            Self::Require => "required",
            Self::VerifyCa => "verify_ca",
            Self::VerifyFull => "verify_identity",
        }
    }
}

/// The TLS settings a profile carries, as the connection form collects them.
///
/// These live in `options` rather than as profile columns because that is the
/// map the form already round-trips and the connectors already receive. Once
/// `irodori-kit` grows a typed `TlsConfig` they should move onto the profile
/// itself — tracked in irodori-table/irodori-kit#11.
struct SslSettings<'a> {
    mode: Option<SslMode>,
    root_cert: Option<&'a str>,
    client_cert: Option<&'a str>,
    client_key: Option<&'a str>,
}

impl<'a> SslSettings<'a> {
    fn from_profile(p: &'a ConnectionProfile) -> Self {
        let option = |keys: &[&str]| -> Option<&'a str> {
            keys.iter().find_map(|key| {
                p.options
                    .get(*key)
                    .map(String::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            })
        };
        Self {
            mode: option(&["sslMode", "sslmode", "ssl-mode"])
                .and_then(SslMode::parse)
                .or_else(|| p.engine.default_ssl_mode()),
            root_cert: option(&["sslRootCert", "sslrootcert", "ssl-ca", "sslCa"]),
            client_cert: option(&["sslCert", "sslcert", "ssl-cert"]),
            client_key: option(&["sslKey", "sslkey", "ssl-key"]),
        }
    }

    fn append_to(&self, url: &mut String, wire: Wire) {
        let (mode_key, mode_value, root_key, cert_key, key_key) = match wire {
            Wire::Mysql => (
                "ssl-mode",
                self.mode.map(SslMode::as_mysql),
                "ssl-ca",
                "ssl-cert",
                "ssl-key",
            ),
            _ => (
                "sslmode",
                self.mode.map(SslMode::as_postgres),
                "sslrootcert",
                "sslcert",
                "sslkey",
            ),
        };
        if let Some(mode) = mode_value {
            append_query_param(url, mode_key, mode);
        }
        for (key, value) in [
            (root_key, self.root_cert),
            (cert_key, self.client_cert),
            (key_key, self.client_key),
        ] {
            if let Some(value) = value {
                append_query_param(url, key, value);
            }
        }
    }
}

/// Supabase's default port for the Supavisor pooler in transaction mode.
const SUPAVISOR_TRANSACTION_PORT: u16 = 6543;

/// Whether this profile talks to a connection pooler that cannot carry named
/// prepared statements across round trips.
///
/// Supabase exposes three endpoints and the port is what distinguishes them —
/// `5432` is either the direct connection or Supavisor in *session* mode, both
/// of which keep a server connection per client and prepare fine; `6543` is
/// transaction mode, which does not. An explicit `poolMode` option wins, for
/// the self-hosted Supavisor deployments that pick their own ports.
fn uses_transaction_pooler(p: &ConnectionProfile) -> bool {
    match p
        .options
        .get("poolMode")
        .map(|mode| mode.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("transaction") => return true,
        Some("direct") | Some("session") => return false,
        _ => {}
    }
    p.engine == DbEngine::Supabase && p.port == Some(SUPAVISOR_TRANSACTION_PORT)
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
    let mut url = format!("{scheme}://{auth}{host}:{port}/{db}");
    let wire = p.engine.wire();
    if let Some(socket_path) = &p.socket_path {
        match wire {
            Wire::Postgres => append_query_param(&mut url, "host", socket_path),
            Wire::Mysql => append_query_param(&mut url, "socket", socket_path),
            _ => {}
        }
        // A unix socket is not a network hop; asking sqlx to negotiate TLS over
        // it fails on servers that only offer TLS on the TCP listener.
        return url;
    }
    SslSettings::from_profile(p).append_to(&mut url, wire);
    // MySQL settles its connection charset during the handshake, and sqlx reads
    // the wanted one from `charset` on the URL. Postgres has no counterpart to
    // append here: its client encoding is a session setting rather than a
    // connect parameter, so the option is offered for the MySQL wire only.
    if matches!(wire, Wire::Mysql) {
        if let Some(charset) = p
            .options
            .get("charset")
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            append_query_param(&mut url, "charset", charset);
        }
    }
    if uses_transaction_pooler(p) {
        // Supavisor's transaction mode multiplexes one server connection across
        // clients, so a prepared statement named on one round trip is not there
        // on the next. sqlx prepares by default and caches by name, which turns
        // the *second* query on a connection into `prepared statement "sqlx_s_1"
        // already exists`. A zero cache makes every statement unnamed.
        append_query_param(&mut url, "statement-cache-capacity", "0");
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENGINE_CASES: &[(DbEngine, Wire, u16)] = &[
        (DbEngine::Postgres, Wire::Postgres, 5432),
        (DbEngine::Mysql, Wire::Mysql, 3306),
        (DbEngine::Sqlite, Wire::Sqlite, 0),
        (DbEngine::Oracle, Wire::Oracle, 1521),
        (DbEngine::SqlServer, Wire::SqlServer, 1433),
        (DbEngine::DuckDb, Wire::DuckDb, 0),
        (DbEngine::MotherDuck, Wire::DuckDb, 443),
        (DbEngine::Mongo, Wire::Mongo, 27017),
        (DbEngine::CockroachDb, Wire::Postgres, 26257),
        (DbEngine::YugabyteDb, Wire::Postgres, 5433),
        (DbEngine::Redshift, Wire::Postgres, 5439),
        (DbEngine::Timescale, Wire::Postgres, 5432),
        (DbEngine::MariaDb, Wire::Mysql, 3306),
        (DbEngine::TiDb, Wire::Mysql, 4000),
        (DbEngine::Neon, Wire::Postgres, 5432),
        (DbEngine::Supabase, Wire::Postgres, 5432),
        (DbEngine::H2, Wire::Postgres, 5435),
        (DbEngine::ClickHouse, Wire::ClickHouse, 8123),
        (DbEngine::Neo4j, Wire::Neo4j, 7687),
        (DbEngine::Memgraph, Wire::Memgraph, 7687),
        (DbEngine::InfluxDb, Wire::InfluxDb, 8086),
        (DbEngine::Qdrant, Wire::Qdrant, 6333),
        (DbEngine::Milvus, Wire::Milvus, 19530),
        (DbEngine::Pinecone, Wire::Pinecone, 0),
        (DbEngine::Snowflake, Wire::Snowflake, 443),
        (DbEngine::BigQuery, Wire::BigQuery, 443),
        (DbEngine::Redis, Wire::Redis, 6379),
        (DbEngine::Cassandra, Wire::Cassandra, 9042),
        (DbEngine::Bigtable, Wire::Bigtable, 443),
        (DbEngine::TrinoPresto, Wire::Jdbc, 8080),
        (DbEngine::Firebird, Wire::Jdbc, 3050),
        (DbEngine::Databricks, Wire::Jdbc, 443),
        (DbEngine::Elasticsearch, Wire::Search, 9200),
        (DbEngine::OpenSearch, Wire::Search, 9200),
        (DbEngine::Couchbase, Wire::Document, 8091),
        (DbEngine::DynamoDb, Wire::KeyValue, 443),
        (DbEngine::CloudSpanner, Wire::CloudSpanner, 443),
        (DbEngine::ScyllaDb, Wire::Cassandra, 9042),
        (DbEngine::ArangoDb, Wire::Graph, 8529),
        (DbEngine::QuestDb, Wire::Postgres, 8812),
        (DbEngine::IoTDb, Wire::TimeSeries, 6667),
        (DbEngine::Hive, Wire::Jdbc, 10000),
        (DbEngine::Athena, Wire::Lakehouse, 443),
        (DbEngine::Iceberg, Wire::Lakehouse, 443),
        (DbEngine::S3Tables, Wire::Lakehouse, 443),
        (DbEngine::DeltaLake, Wire::Lakehouse, 443),
        (DbEngine::Hudi, Wire::Lakehouse, 443),
    ];

    fn profile(engine: DbEngine) -> ConnectionProfile {
        ConnectionProfile {
            id: format!("{engine:?}").to_lowercase(),
            engine,
            host: Some("db.example.test".into()),
            port: None,
            user: None,
            password: None,
            auth: Default::default(),
            tls: Default::default(),
            database: Some("sample".into()),
            socket_path: None,
            url: None,
            transport: None,
            read_only: false,
            options: Default::default(),
        }
    }

    #[test]
    fn all_engines_have_expected_wire_and_default_port() {
        assert_eq!(ENGINE_CASES.len(), DbEngine::ALL.len());
        for (engine, wire, port) in ENGINE_CASES {
            assert_eq!(engine.wire(), *wire, "{engine:?} wire");
            assert_eq!(engine.default_port(), *port, "{engine:?} default port");
        }
    }

    #[test]
    fn build_support_lists_every_engine() {
        let support = DbEngine::all_build_support();
        assert_eq!(support.len(), DbEngine::ALL.len());
        for engine in DbEngine::ALL {
            assert!(
                support.iter().any(|item| item.engine == *engine),
                "{engine:?} missing from build support"
            );
        }
    }

    #[test]
    fn connector_dispatch_matches_bundled_catalog() {
        let catalog: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/features/extensions/bundled-catalog.json"
        ))
        .expect("bundled extension catalog should be valid JSON");
        let extensions = catalog["extensions"]
            .as_array()
            .expect("bundled catalog extensions should be an array");
        let mut catalog_connector_count = 0;

        for extension in extensions {
            let is_native_connector = extension["runtime"].as_str() == Some("native")
                && extension["categories"]
                    .as_array()
                    .is_some_and(|categories| {
                        categories
                            .iter()
                            .any(|category| category.as_str() == Some("connector"))
                    });
            if !is_native_connector {
                continue;
            }

            let extension_id = extension["id"]
                .as_str()
                .expect("catalog connector should declare an id");
            let engines = extension["engines"]
                .as_array()
                .expect("catalog connector should declare engines");
            for engine_name in engines {
                let engine_name = engine_name
                    .as_str()
                    .expect("catalog connector engine should be a string");
                let engine: DbEngine =
                    serde_json::from_value(serde_json::Value::String(engine_name.to_owned()))
                        .expect("catalog connector engine should be a DbEngine");
                assert_eq!(
                    engine.connector_extension_id(),
                    Some(extension_id),
                    "{engine_name} connector dispatch"
                );
                catalog_connector_count += 1;
            }
        }

        let dispatch_count = DbEngine::ALL
            .iter()
            .filter(|engine| engine.connector_extension_id().is_some())
            .count();
        assert_eq!(catalog_connector_count, 29);
        // The catalog is a subset of the dispatch table, not a mirror of it:
        // the six lakehouse connectors ship from the irodori-lakehouse
        // registry, so this build still knows which extension backs Iceberg
        // without offering to install it.
        let lakehouse_connectors = [
            DbEngine::Iceberg,
            DbEngine::S3Tables,
            DbEngine::DeltaLake,
            DbEngine::Hudi,
            DbEngine::Hive,
            DbEngine::Athena,
        ];
        for engine in lakehouse_connectors {
            assert!(
                engine.connector_extension_id().is_some(),
                "{engine:?} must still dispatch to its connector extension"
            );
        }
        assert_eq!(
            dispatch_count,
            catalog_connector_count + lakehouse_connectors.len()
        );
    }

    #[test]
    fn build_support_tracks_compile_time_features() {
        let cases = [
            (
                DbEngine::SqlServer,
                "sqlserver",
                cfg!(feature = "sqlserver"),
            ),
            (DbEngine::Mongo, "mongo", cfg!(feature = "mongo")),
            (DbEngine::Oracle, "oracle", cfg!(feature = "oracle")),
            (DbEngine::Neo4j, "neo4j", cfg!(feature = "neo4j")),
            (DbEngine::BigQuery, "bigquery", cfg!(feature = "bigquery")),
            (DbEngine::Bigtable, "bigtable", cfg!(feature = "bigtable")),
            (
                DbEngine::Redis,
                "redis-connector",
                cfg!(feature = "redis-connector"),
            ),
            (
                DbEngine::Cassandra,
                "cassandra",
                cfg!(feature = "cassandra"),
            ),
            (DbEngine::ScyllaDb, "cassandra", cfg!(feature = "cassandra")),
        ];

        for (engine, feature, enabled) in cases {
            let support = engine.build_support();
            assert_eq!(
                support.required_feature.as_deref(),
                Some(feature),
                "{engine:?} required feature"
            );
            assert_eq!(
                support.included_in_current_build, enabled,
                "{engine:?} build support"
            );
        }

        let built_in = DbEngine::Postgres.build_support();
        assert!(built_in.included_in_current_build);
        assert_eq!(built_in.required_feature, None);

        for engine in [DbEngine::DuckDb, DbEngine::MotherDuck] {
            let support = engine.build_support();
            assert!(support.included_in_current_build);
            assert_eq!(support.required_feature, None);
            assert!(engine.connector_extension_id().is_some());
        }
    }

    #[test]
    fn engine_registry_exposes_dialect_and_metamodel() {
        assert_eq!(
            DbEngine::Mysql.dialect().quote_identifier("order"),
            "`order`"
        );
        assert_eq!(
            DbEngine::SqlServer
                .dialect()
                .page_query("select * from users", irodori_sql::dialect::Page::first(10)),
            "select * from users ORDER BY (SELECT 0) OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY"
        );

        assert!(DbEngine::Postgres
            .metamodel()
            .list_objects(None)
            .sql
            .contains("pg_catalog"));
        assert!(DbEngine::Sqlite
            .metamodel()
            .list_objects(None)
            .sql
            .contains("sqlite_schema"));
    }

    #[test]
    fn postgres_wire_engines_build_postgres_urls() {
        for (engine, _, port) in ENGINE_CASES
            .iter()
            .copied()
            .filter(|(_, wire, _)| *wire == Wire::Postgres)
        {
            // Hosted-only engines carry a `sslmode` floor; the rest of the URL
            // is what this test is about. `hosted_only_engines_require_tls_by_default`
            // covers the floor itself.
            let expected_ssl = match engine.default_ssl_mode() {
                Some(mode) => format!("?sslmode={}", mode.as_postgres()),
                None => String::new(),
            };
            assert_eq!(
                build_url(&profile(engine)).unwrap(),
                format!("postgres://db.example.test:{port}/sample{expected_ssl}"),
                "{engine:?} should route through the postgres sqlx URL"
            );
        }
    }

    #[test]
    fn mysql_wire_engines_build_mysql_urls() {
        for (engine, _, port) in ENGINE_CASES
            .iter()
            .copied()
            .filter(|(_, wire, _)| *wire == Wire::Mysql)
        {
            let expected_ssl = match engine.default_ssl_mode() {
                Some(mode) => format!("?ssl-mode={}", mode.as_mysql()),
                None => String::new(),
            };
            assert_eq!(
                build_url(&profile(engine)).unwrap(),
                format!("mysql://db.example.test:{port}/sample{expected_ssl}"),
                "{engine:?} should route through the mysql sqlx URL"
            );
        }
    }

    #[test]
    fn dedicated_connector_engines_do_not_build_sqlx_urls() {
        for (engine, wire, _) in ENGINE_CASES
            .iter()
            .copied()
            .filter(|(_, wire, _)| !matches!(wire, Wire::Postgres | Wire::Mysql | Wire::Sqlite))
        {
            assert_eq!(
                build_url(&profile(engine)).unwrap_err().message(),
                "this engine uses a dedicated connector, not a sqlx URL",
                "{engine:?}/{wire:?} should not go through sqlx URL generation"
            );
        }
    }

    #[test]
    fn explicit_url_wins_for_every_engine() {
        for (engine, _, _) in ENGINE_CASES {
            let mut profile = profile(*engine);
            profile.url = Some(format!("custom://{}", profile.id));
            assert_eq!(
                build_url(&profile).unwrap(),
                format!("custom://{}", profile.id)
            );
        }
    }

    #[test]
    fn sqlite_memory_url_is_not_treated_as_a_file_path() {
        let mut profile = profile(DbEngine::Sqlite);
        profile.database = Some(":memory:".into());
        assert_eq!(build_url(&profile).unwrap(), "sqlite::memory:");
    }

    #[test]
    fn sqlite_file_path_builds_rwc_url() {
        let mut profile = profile(DbEngine::Sqlite);
        profile.database = Some("/tmp/irodori-test.sqlite".into());
        assert_eq!(
            build_url(&profile).unwrap(),
            "sqlite:///tmp/irodori-test.sqlite?mode=rwc"
        );
    }

    #[test]
    fn tcp_urls_percent_encode_auth() {
        let mut profile = profile(DbEngine::Postgres);
        profile.user = Some("user name".into());
        profile.password = Some("p@ss/word".into());

        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://user%20name:p%40ss%2Fword@db.example.test:5432/sample"
        );
    }

    #[test]
    fn postgres_socket_path_uses_host_query_parameter() {
        let mut profile = profile(DbEngine::Postgres);
        profile.socket_path = Some("/var/run/postgresql".into());
        profile.host = None;

        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://localhost:5432/sample?host=%2Fvar%2Frun%2Fpostgresql"
        );
    }

    #[test]
    fn mysql_socket_path_uses_socket_query_parameter() {
        let mut profile = profile(DbEngine::Mysql);
        profile.socket_path = Some("/var/run/mysqld/mysqld.sock".into());
        profile.host = None;

        assert_eq!(
            build_url(&profile).unwrap(),
            "mysql://localhost:3306/sample?socket=%2Fvar%2Frun%2Fmysqld%2Fmysqld.sock"
        );
    }

    fn with_options<const N: usize>(
        engine: DbEngine,
        options: [(&str, &str); N],
    ) -> ConnectionProfile {
        let mut profile = profile(engine);
        profile.options = options
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        profile
    }

    #[test]
    fn a_profile_without_ssl_options_is_unchanged() {
        // sqlx keeps its own default (`prefer`/`preferred`), so every existing
        // local profile connects exactly as it did before TLS controls existed.
        assert_eq!(
            build_url(&profile(DbEngine::Postgres)).unwrap(),
            "postgres://db.example.test:5432/sample"
        );
        assert_eq!(
            build_url(&profile(DbEngine::Mysql)).unwrap(),
            "mysql://db.example.test:3306/sample"
        );
    }

    #[test]
    fn postgres_ssl_options_become_sqlx_query_parameters() {
        let profile = with_options(
            DbEngine::Postgres,
            [
                ("sslMode", "verify-full"),
                ("sslRootCert", "/etc/ssl/root.crt"),
                ("sslCert", "/etc/ssl/client.crt"),
                ("sslKey", "/etc/ssl/client.key"),
            ],
        );

        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://db.example.test:5432/sample\
             ?sslmode=verify-full\
             &sslrootcert=%2Fetc%2Fssl%2Froot.crt\
             &sslcert=%2Fetc%2Fssl%2Fclient.crt\
             &sslkey=%2Fetc%2Fssl%2Fclient.key"
        );
    }

    #[test]
    fn mysql_ssl_options_are_translated_to_the_mysql_vocabulary() {
        // Same `sslMode` value as the Postgres case; MySQL spells the strongest
        // mode `verify_identity` and its CA parameter `ssl-ca`.
        let profile = with_options(
            DbEngine::Mysql,
            [
                ("sslMode", "verify-full"),
                ("sslRootCert", "/etc/ssl/ca.pem"),
            ],
        );

        assert_eq!(
            build_url(&profile).unwrap(),
            "mysql://db.example.test:3306/sample\
             ?ssl-mode=verify_identity\
             &ssl-ca=%2Fetc%2Fssl%2Fca.pem"
        );
    }

    #[test]
    fn mysql_charset_becomes_a_sqlx_query_parameter() {
        let profile = with_options(DbEngine::Mysql, [("charset", "utf8mb4")]);

        assert_eq!(
            build_url(&profile).unwrap(),
            "mysql://db.example.test:3306/sample?charset=utf8mb4"
        );
    }

    #[test]
    fn a_charset_on_a_postgres_profile_is_ignored() {
        // Postgres takes its client encoding as a session setting, so appending
        // an unknown parameter here would only make sqlx reject the URL.
        let profile = with_options(DbEngine::Postgres, [("charset", "utf8mb4")]);

        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://db.example.test:5432/sample"
        );
    }

    #[test]
    fn ssl_mode_accepts_either_vocabulary() {
        for (input, postgres, mysql) in [
            ("require", "require", "required"),
            ("REQUIRED", "require", "required"),
            ("verify_identity", "verify-full", "verify_identity"),
            ("disabled", "disable", "disabled"),
            ("prefer", "prefer", "preferred"),
        ] {
            let mode = SslMode::parse(input).unwrap_or_else(|| panic!("{input} should parse"));
            assert_eq!(mode.as_postgres(), postgres, "postgres spelling of {input}");
            assert_eq!(mode.as_mysql(), mysql, "mysql spelling of {input}");
        }
        assert_eq!(SslMode::parse("sometimes"), None);
        assert_eq!(SslMode::parse("  "), None);
    }

    #[test]
    fn mysql_has_no_allow_so_it_falls_back_to_preferred() {
        let profile = with_options(DbEngine::Mysql, [("sslMode", "allow")]);
        assert_eq!(
            build_url(&profile).unwrap(),
            "mysql://db.example.test:3306/sample?ssl-mode=preferred"
        );
    }

    #[test]
    fn hosted_only_engines_require_tls_by_default() {
        for engine in [DbEngine::Neon, DbEngine::Redshift] {
            let url = build_url(&profile(engine)).unwrap();
            assert!(
                url.contains("sslmode=require"),
                "{engine:?} should default to require, got {url}"
            );
        }
    }

    #[test]
    fn a_profile_can_lower_the_default_for_a_hosted_engine() {
        // The default is a floor for the common case, not a policy the user
        // cannot override — a Neon branch proxied through a local tunnel is a
        // legitimate plaintext target.
        let profile = with_options(DbEngine::Neon, [("sslMode", "disable")]);
        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://db.example.test:5432/sample?sslmode=disable"
        );
    }

    #[test]
    fn self_hostable_engines_keep_the_driver_default() {
        // These run insecure in irodori-samples; raising their floor would
        // break `task db-verify` for a guess about intent.
        for engine in [
            DbEngine::Postgres,
            DbEngine::Timescale,
            DbEngine::CockroachDb,
            DbEngine::YugabyteDb,
            DbEngine::Mysql,
            DbEngine::MariaDb,
            DbEngine::TiDb,
        ] {
            let url = build_url(&profile(engine)).unwrap();
            assert!(
                !url.contains("sslmode") && !url.contains("ssl-mode"),
                "{engine:?} should not force a mode, got {url}"
            );
        }
    }

    #[test]
    fn a_unix_socket_profile_does_not_negotiate_tls() {
        // A socket is not a network hop, and servers that only offer TLS on the
        // TCP listener reject the negotiation outright.
        let mut profile = with_options(DbEngine::Postgres, [("sslMode", "require")]);
        profile.socket_path = Some("/var/run/postgresql".into());
        profile.host = None;

        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://localhost:5432/sample?host=%2Fvar%2Frun%2Fpostgresql"
        );
    }

    #[test]
    fn an_explicit_url_is_never_rewritten() {
        let mut profile = with_options(DbEngine::Neon, [("sslMode", "verify-full")]);
        profile.url = Some("postgres://user@host/db?sslmode=disable".into());
        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://user@host/db?sslmode=disable"
        );
    }

    #[test]
    fn supabase_requires_tls_and_rides_the_postgres_wire() {
        let profile = profile(DbEngine::Supabase);
        assert_eq!(DbEngine::Supabase.wire(), Wire::Postgres);
        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://db.example.test:5432/sample?sslmode=require"
        );
    }

    #[test]
    fn the_supavisor_transaction_port_disables_the_statement_cache() {
        // Transaction mode multiplexes one server connection across clients, so
        // a named prepared statement is gone by the next round trip. Without
        // this the *second* query on a connection fails with
        // `prepared statement "sqlx_s_1" already exists`.
        let mut profile = profile(DbEngine::Supabase);
        profile.host = Some("aws-0-ap-northeast-1.pooler.supabase.com".into());
        profile.port = Some(6543);
        profile.user = Some("postgres.abcdefghijklmnop".into());

        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://postgres.abcdefghijklmnop@aws-0-ap-northeast-1.pooler.supabase.com:6543/sample\
             ?sslmode=require\
             &statement-cache-capacity=0"
        );
    }

    #[test]
    fn direct_and_session_endpoints_keep_the_statement_cache() {
        for port in [5432, 5432] {
            let mut profile = profile(DbEngine::Supabase);
            profile.port = Some(port);
            let url = build_url(&profile).unwrap();
            assert!(
                !url.contains("statement-cache-capacity"),
                "port {port} should keep prepared statements, got {url}"
            );
        }
    }

    #[test]
    fn an_explicit_pool_mode_overrides_the_port_inference() {
        // Self-hosted Supavisor picks its own ports, and a proxy can put
        // transaction mode on 5432.
        let mut profile = with_options(DbEngine::Supabase, [("poolMode", "transaction")]);
        profile.port = Some(5432);
        assert!(build_url(&profile)
            .unwrap()
            .contains("statement-cache-capacity=0"));

        let mut profile = with_options(DbEngine::Supabase, [("poolMode", "session")]);
        profile.port = Some(6543);
        assert!(!build_url(&profile)
            .unwrap()
            .contains("statement-cache-capacity"));
    }

    #[test]
    fn only_supabase_infers_a_pooler_from_the_port() {
        // 6543 means nothing on a plain Postgres profile.
        let mut profile = profile(DbEngine::Postgres);
        profile.port = Some(6543);
        assert!(!build_url(&profile)
            .unwrap()
            .contains("statement-cache-capacity"));
    }

    #[test]
    fn ssl_option_keys_accept_the_driver_spellings_too() {
        // A profile imported from a DSN or an older build may carry the
        // lowercase driver names rather than the form's camelCase keys.
        let profile = with_options(
            DbEngine::Postgres,
            [("sslmode", "require"), ("sslrootcert", "/ca.pem")],
        );
        assert_eq!(
            build_url(&profile).unwrap(),
            "postgres://db.example.test:5432/sample?sslmode=require&sslrootcert=%2Fca.pem"
        );
    }
}
