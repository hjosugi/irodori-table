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
        let guard = conn
            .lock()
            .map_err(|_| "duckdb mutex poisoned".to_string())?;

        // Classify the statement (Beekeeper-style): only row-returning statements
        // go through `query`; DDL/DML go through `execute`, which avoids the duckdb
        // crate panicking when it inspects columns on a non-result statement.
        let lead = sql.trim_start().to_ascii_lowercase();
        let is_query = [
            "select", "with", "show", "pragma", "explain", "describe", "values", "table", "call",
        ]
        .iter()
        .any(|kw| lead.starts_with(kw));
        if !is_query {
            guard
                .execute(&sql, [])
                .map_err(|e| format!("query failed: {e}"))?;
            return Ok((Vec::new(), Vec::new(), false));
        }

        let mut stmt = guard
            .prepare(&sql)
            .map_err(|e| format!("query failed: {e}"))?;
        let mut duck_rows = stmt.query([]).map_err(|e| format!("query failed: {e}"))?;
        // DuckDB only materializes the result schema after execution, so read the
        // column names from the executed statement (not the prepared one).
        let columns: Vec<String> = match duck_rows.as_ref() {
            Some(s) => s.column_names().iter().map(|c| c.to_string()).collect(),
            None => Vec::new(),
        };
        let column_count = columns.len();

        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        while let Some(row) = duck_rows.next().map_err(|e| format!("query failed: {e}"))? {
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
