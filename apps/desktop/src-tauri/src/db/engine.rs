//! Engine identity, wire-protocol routing, and connection-URL building.
//!
//! `wire()` separates the *protocol* an engine speaks (which driver handles it)
//! from the engine identity — so CockroachDB/Yugabyte/Redshift/Timescale ride the
//! Postgres driver and MariaDB/TiDB ride MySQL. A future `SqlDialect`/metamodel
//! layer (DBeaver-style) will sit on top for per-engine quoting and introspection.

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

/// The wire protocol an engine speaks — i.e. which connector handles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wire {
    Postgres,
    Mysql,
    Sqlite,
    SqlServer,
    DuckDb,
    Oracle,
}

impl DbEngine {
    pub(crate) fn wire(self) -> Wire {
        match self {
            DbEngine::Postgres
            | DbEngine::CockroachDb
            | DbEngine::YugabyteDb
            | DbEngine::Redshift
            | DbEngine::Timescale => Wire::Postgres,
            DbEngine::Mysql | DbEngine::MariaDb | DbEngine::TiDb => Wire::Mysql,
            DbEngine::Sqlite => Wire::Sqlite,
            DbEngine::SqlServer => Wire::SqlServer,
            DbEngine::DuckDb => Wire::DuckDb,
            DbEngine::Oracle => Wire::Oracle,
        }
    }

    pub(crate) fn default_port(self) -> u16 {
        match self {
            DbEngine::Postgres | DbEngine::Timescale => 5432,
            DbEngine::CockroachDb => 26257,
            DbEngine::YugabyteDb => 5433,
            DbEngine::Redshift => 5439,
            DbEngine::Mysql | DbEngine::MariaDb => 3306,
            DbEngine::TiDb => 4000,
            DbEngine::SqlServer => 1433,
            DbEngine::Oracle => 1521,
            DbEngine::Sqlite | DbEngine::DuckDb => 0,
        }
    }
}

pub(crate) fn oracle_pending_message() -> String {
    "Oracle will connect through a pure-Rust thin TNS driver (no Instant Client, \
     like A5:SQL Mk-2's direct mode), built by inheriting the permissive `oracle-rs` \
     crate. Integration is pending the SRC-004 spike."
        .to_string()
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
/// DuckDB, and Oracle use dedicated connectors instead.
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
            Ok(format!("sqlite://{path}?mode=rwc"))
        }
        Wire::Postgres => Ok(build_tcp_url("postgres", p)),
        Wire::Mysql => Ok(build_tcp_url("mysql", p)),
        Wire::SqlServer | Wire::DuckDb | Wire::Oracle => {
            Err("this engine uses a dedicated connector, not a sqlx URL".into())
        }
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
        assert_eq!(DbEngine::SqlServer.wire(), Wire::SqlServer);
        assert_eq!(DbEngine::DuckDb.wire(), Wire::DuckDb);
        assert_eq!(DbEngine::CockroachDb.default_port(), 26257);
        assert_eq!(DbEngine::SqlServer.default_port(), 1433);
        assert_eq!(DbEngine::TiDb.default_port(), 4000);
    }
}
