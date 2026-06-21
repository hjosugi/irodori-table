//! Microsoft SQL Server via the pure-Rust `tiberius` TDS driver — no SQL Server
//! client library required.
//!
//! tiberius is single-connection (not a sqlx pool), so we hold one `Client`
//! behind a mutex per connection. Decimals currently decode best-effort; keeping
//! them precision-safe end-to-end is a follow-up (DBeaver's `setBigDecimal` rule).

use std::sync::Arc;

use futures_util::TryStreamExt;
use tiberius::{AuthMethod, Client, Config, QueryItem};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::{ConnectionProfile, RowSet};

pub type MssqlClient = Client<Compat<TcpStream>>;

pub async fn connect(profile: &ConnectionProfile) -> Result<MssqlClient, String> {
    let config = if let Some(url) = &profile.url {
        Config::from_ado_string(url).map_err(|e| format!("bad connection string: {e}"))?
    } else {
        let mut config = Config::new();
        let host = profile.host.clone().unwrap_or_else(|| "localhost".into());
        config.host(&host);
        config.port(profile.port.unwrap_or(1433));
        config.authentication(AuthMethod::sql_server(
            profile.user.clone().unwrap_or_default(),
            profile.password.clone().unwrap_or_default(),
        ));
        if let Some(db) = &profile.database {
            config.database(db);
        }
        // Dev default: accept the server's self-signed certificate.
        config.trust_cert();
        config
    };

    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    tcp.set_nodelay(true).ok();
    Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn version(client: &Arc<Mutex<MssqlClient>>) -> Option<String> {
    let mut guard = client.lock().await;
    let stream = guard.query("select @@version", &[]).await.ok()?;
    let row = stream.into_row().await.ok()??;
    let banner: Option<&str> = row.try_get(0).ok()?;
    banner.map(|s| s.lines().next().unwrap_or(s).trim().to_string())
}

pub async fn run_query(
    client: &Arc<Mutex<MssqlClient>>,
    sql: &str,
    cap: usize,
) -> Result<RowSet, String> {
    let mut guard = client.lock().await;
    let mut stream = guard
        .query(sql, &[])
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;

    // Drain the full stream (so the connection stays usable) but only keep up to
    // `cap` rows in memory.
    while let Some(item) = stream
        .try_next()
        .await
        .map_err(|e| format!("query failed: {e}"))?
    {
        if let QueryItem::Row(row) = item {
            if columns.is_empty() {
                columns = row.columns().iter().map(|c| c.name().to_string()).collect();
            }
            if rows.len() < cap {
                let mut cells = Vec::with_capacity(row.columns().len());
                for i in 0..row.columns().len() {
                    cells.push(cell_to_json(&row, i));
                }
                rows.push(cells);
            } else {
                truncated = true;
            }
        }
    }
    Ok((columns, rows, truncated))
}

fn cell_to_json(row: &tiberius::Row, i: usize) -> serde_json::Value {
    use serde_json::Value;
    // tiberius `try_get` returns Ok(None) for NULL and Err for a type mismatch,
    // so try the supported types in order. MVP coverage: bool/ints/float/string.
    // Decimals come through as float (lossy) and datetimes/binary as null for now
    // — precision-safe decimals + temporals are a follow-up (EXEC-009b).
    if let Ok(Some(v)) = row.try_get::<bool, _>(i) {
        return Value::Bool(v);
    }
    if let Ok(Some(v)) = row.try_get::<i32, _>(i) {
        return Value::from(v as i64);
    }
    if let Ok(Some(v)) = row.try_get::<i64, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<f64, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<&str, _>(i) {
        return Value::String(v.to_string());
    }
    Value::Null
}
