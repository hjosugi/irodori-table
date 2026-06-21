//! Embedded DuckDB (feature `duckdb`). The crate bundles libduckdb (C++), which
//! is a heavy build, so this engine is off by default. DuckDB is synchronous, so
//! queries run on a blocking thread.

use std::sync::{Arc, Mutex};

use super::{hex_encode, ConnectionProfile, RowSet};

pub fn connect(profile: &ConnectionProfile) -> Result<duckdb::Connection, String> {
    let path = profile.database.clone().or_else(|| profile.url.clone());
    let conn = match path.as_deref() {
        None | Some("") | Some(":memory:") => duckdb::Connection::open_in_memory(),
        Some(p) => duckdb::Connection::open(p),
    }
    .map_err(|e| format!("connect failed: {e}"))?;
    Ok(conn)
}

pub fn version(conn: &Arc<Mutex<duckdb::Connection>>) -> Option<String> {
    let guard = conn.lock().ok()?;
    guard
        .query_row("select version()", [], |r| r.get::<_, String>(0))
        .ok()
}

pub async fn run_query(
    conn: &Arc<Mutex<duckdb::Connection>>,
    sql: &str,
    cap: usize,
) -> Result<RowSet, String> {
    let conn = conn.clone();
    let sql = sql.to_string();
    tokio::task::spawn_blocking(move || -> Result<RowSet, String> {
        let guard = conn.lock().map_err(|_| "duckdb mutex poisoned".to_string())?;
        let mut stmt = guard.prepare(&sql).map_err(|e| format!("query failed: {e}"))?;
        // Collect owned column names before borrowing the statement for the query.
        let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let column_count = stmt.column_count();
        let mut duck_rows = stmt.query([]).map_err(|e| format!("query failed: {e}"))?;

        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        while let Some(row) = duck_rows
            .next()
            .map_err(|e| format!("query failed: {e}"))?
        {
            if rows.len() >= cap {
                truncated = true;
                break;
            }
            let mut cells = Vec::with_capacity(column_count);
            for i in 0..column_count {
                cells.push(cell_to_json(row, i));
            }
            rows.push(cells);
        }
        Ok((columns, rows, truncated))
    })
    .await
    .map_err(|e| format!("duckdb task failed: {e}"))?
}

fn cell_to_json(row: &duckdb::Row, i: usize) -> serde_json::Value {
    use duckdb::types::Value as V;
    use serde_json::Value as J;
    match row.get::<usize, V>(i) {
        Ok(V::Null) => J::Null,
        Ok(V::Boolean(b)) => J::Bool(b),
        Ok(V::TinyInt(n)) => J::from(n as i64),
        Ok(V::SmallInt(n)) => J::from(n as i64),
        Ok(V::Int(n)) => J::from(n as i64),
        Ok(V::BigInt(n)) => J::from(n),
        Ok(V::UTinyInt(n)) => J::from(n as u64),
        Ok(V::USmallInt(n)) => J::from(n as u64),
        Ok(V::UInt(n)) => J::from(n as u64),
        Ok(V::UBigInt(n)) => J::from(n),
        Ok(V::Float(f)) => J::from(f as f64),
        Ok(V::Double(f)) => J::from(f),
        Ok(V::Text(s)) => J::String(s),
        Ok(V::Blob(b)) => J::String(format!("\\x{}", hex_encode(&b))),
        // Decimals, timestamps, lists, structs, etc.: keep as their text form.
        Ok(other) => J::String(format!("{other:?}")),
        Err(_) => J::Null,
    }
}
