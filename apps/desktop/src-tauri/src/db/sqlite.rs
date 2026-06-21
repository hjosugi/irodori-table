//! SQLite via a native sqlx pool. SQLite is dynamically typed, so values are
//! decoded by trying the storage classes in order.

use futures_util::TryStreamExt;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, ValueRef};

use super::{hex_encode, RowSet};

pub async fn connect(url: &str) -> Result<SqlitePool, String> {
    // Single writer; one connection avoids file-lock surprises.
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect(url)
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn version(pool: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>("select sqlite_version()")
        .fetch_one(pool)
        .await
        .ok()
}

pub async fn run_query(pool: &SqlitePool, sql: &str, cap: usize) -> Result<RowSet, String> {
    let mut stream = sqlx::query(sql).fetch(pool);
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|e| format!("query failed: {e}"))?
    {
        if columns.is_empty() {
            columns = row.columns().iter().map(|c| c.name().to_string()).collect();
        }
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let mut cells = Vec::with_capacity(row.columns().len());
        for i in 0..row.columns().len() {
            cells.push(cell_to_json(&row, i));
        }
        rows.push(cells);
    }
    Ok((columns, rows, truncated))
}

fn cell_to_json(row: &SqliteRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    row.try_get::<i64, _>(i)
        .map(Value::from)
        .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
        .or_else(|_| row.try_get::<String, _>(i).map(Value::String))
        .or_else(|_| {
            row.try_get::<Vec<u8>, _>(i)
                .map(|b| Value::String(format!("\\x{}", hex_encode(&b))))
        })
        .unwrap_or(Value::Null)
}
