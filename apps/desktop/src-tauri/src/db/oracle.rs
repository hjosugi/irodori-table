//! Oracle via the pure-Rust thin `oracle-rs` driver — **no Oracle Instant Client**,
//! the way A5:SQL Mk-2's "direct connection" mode works.
//!
//! Everything Oracle-specific is confined to this one module, so swapping the
//! driver (or forking the permissive `oracle-rs` to harden it) later touches only
//! this file. The connection is wrapped in a mutex because one TNS connection is a
//! single session.

use oracle_rs::{Config, Connection as OraConn, Value};
use tokio::sync::Mutex;

use super::{hex_encode, ConnectionProfile, RowSet};

pub struct OracleHandle {
    conn: Mutex<OraConn>,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<OracleHandle, String> {
    let host = profile.host.clone().unwrap_or_else(|| "localhost".into());
    let port = profile.port.unwrap_or(1521);
    // Oracle's "database" field is the service name (e.g. FREEPDB1).
    let service = profile.database.clone().unwrap_or_else(|| "FREEPDB1".into());
    let user = profile.user.clone().unwrap_or_default();
    let password = profile.password.clone().unwrap_or_default();

    let config = Config::new(&host, port, &service, &user, &password);
    let conn = OraConn::connect_with_config(config)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    Ok(OracleHandle {
        conn: Mutex::new(conn),
    })
}

pub async fn version(h: &OracleHandle) -> Option<String> {
    let guard = h.conn.lock().await;
    let res = guard
        .query("select banner from v$version where rownum = 1", &[])
        .await
        .ok()?;
    res.rows
        .first()
        .and_then(|r| r.get(0))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
}

pub async fn run_query(h: &OracleHandle, sql: &str, cap: usize) -> Result<RowSet, String> {
    let guard = h.conn.lock().await;
    let res = guard
        .query(sql, &[])
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let columns: Vec<String> = res.columns.iter().map(|c| c.name.clone()).collect();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = res.has_more_rows;
    for row in &res.rows {
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let cells = (0..columns.len()).map(|i| value_to_json(row.get(i))).collect();
        rows.push(cells);
    }
    Ok((columns, rows, truncated))
}

/// Decode an Oracle [`Value`] to JSON. Scalars and JSON map directly; high-scale
/// `NUMBER` and dates/timestamps render best-effort for now (precision-safe
/// decimals + ISO temporals are a refinement).
fn value_to_json(v: Option<&Value>) -> serde_json::Value {
    use serde_json::Value as J;
    let Some(v) = v else { return J::Null };
    match v {
        Value::Null => J::Null,
        Value::Boolean(b) => J::Bool(*b),
        Value::Integer(i) => J::from(*i),
        Value::Float(f) => J::from(*f),
        Value::String(s) => J::String(s.clone()),
        Value::Bytes(b) => J::String(format!("\\x{}", hex_encode(b))),
        Value::Json(j) => j.clone(),
        Value::Number(_) => v
            .as_i64()
            .map(J::from)
            .or_else(|| v.as_f64().map(J::from))
            .unwrap_or_else(|| J::String(format!("{v:?}"))),
        other => J::String(format!("{other:?}")),
    }
}
