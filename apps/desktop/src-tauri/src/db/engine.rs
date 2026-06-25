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

use super::ConnectionProfile;

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
    #[serde(rename = "redis")]
    #[ts(rename = "redis")]
    Redis,
    #[serde(rename = "cassandra")]
    #[ts(rename = "cassandra")]
    Cassandra,
    #[serde(rename = "bigtable")]
    #[ts(rename = "bigtable")]
    Bigtable,
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
}

impl DbEngine {
    pub(crate) fn wire(self) -> Wire {
        match self {
            DbEngine::Postgres
            | DbEngine::CockroachDb
            | DbEngine::YugabyteDb
            | DbEngine::Redshift
            | DbEngine::Timescale
            | DbEngine::Neon
            | DbEngine::H2 => Wire::Postgres,
            DbEngine::Mysql | DbEngine::MariaDb | DbEngine::TiDb => Wire::Mysql,
            DbEngine::Sqlite => Wire::Sqlite,
            DbEngine::SqlServer => Wire::SqlServer,
            DbEngine::DuckDb => Wire::DuckDb,
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
            DbEngine::Bigtable => Wire::Bigtable,
        }
    }

    pub(crate) fn default_port(self) -> u16 {
        match self {
            DbEngine::Postgres | DbEngine::Timescale | DbEngine::Neon => 5432,
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
            DbEngine::Cassandra => 9042,
            DbEngine::Bigtable => 443,
            DbEngine::Sqlite | DbEngine::DuckDb | DbEngine::Pinecone => 0,
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
            | Wire::Pinecone => Box::new(PostgresDialect),
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
            | Wire::Pinecone => Box::new(StandardInformationSchema),
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

/// Build a sqlx connection URL for the Postgres/MySQL/SQLite drivers. SQL Server,
/// DuckDB, MongoDB, and Oracle use dedicated connectors instead.
pub(crate) fn build_url(p: &ConnectionProfile) -> Result<String, String> {
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
        | Wire::Pinecone => Err("this engine uses a dedicated connector, not a sqlx URL".into()),
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
        (DbEngine::Mongo, Wire::Mongo, 27017),
        (DbEngine::CockroachDb, Wire::Postgres, 26257),
        (DbEngine::YugabyteDb, Wire::Postgres, 5433),
        (DbEngine::Redshift, Wire::Postgres, 5439),
        (DbEngine::Timescale, Wire::Postgres, 5432),
        (DbEngine::MariaDb, Wire::Mysql, 3306),
        (DbEngine::TiDb, Wire::Mysql, 4000),
        (DbEngine::Neon, Wire::Postgres, 5432),
        (DbEngine::H2, Wire::Postgres, 5435),
        (DbEngine::ClickHouse, Wire::ClickHouse, 8123),
        (DbEngine::Neo4j, Wire::Neo4j, 7687),
        (DbEngine::Memgraph, Wire::Memgraph, 7687),
        (DbEngine::InfluxDb, Wire::InfluxDb, 8086),
        (DbEngine::Qdrant, Wire::Qdrant, 6333),
        (DbEngine::Milvus, Wire::Milvus, 19530),
        (DbEngine::Pinecone, Wire::Pinecone, 0),
    ];

    fn profile(engine: DbEngine) -> ConnectionProfile {
        ConnectionProfile {
            id: format!("{engine:?}").to_lowercase(),
            engine,
            host: Some("db.example.test".into()),
            port: None,
            user: None,
            password: None,
            database: Some("sample".into()),
            url: None,
            transport: None,
            options: Default::default(),
        }
    }

    #[test]
    fn all_engines_have_expected_wire_and_default_port() {
        for (engine, wire, port) in ENGINE_CASES {
            assert_eq!(engine.wire(), *wire, "{engine:?} wire");
            assert_eq!(engine.default_port(), *port, "{engine:?} default port");
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
            assert_eq!(
                build_url(&profile(engine)).unwrap(),
                format!("postgres://db.example.test:{port}/sample"),
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
            assert_eq!(
                build_url(&profile(engine)).unwrap(),
                format!("mysql://db.example.test:{port}/sample"),
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
                build_url(&profile(engine)).unwrap_err(),
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
}
