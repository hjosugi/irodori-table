//! MySQL / MariaDB / TiDB via a native sqlx pool.

use futures_util::TryStreamExt;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions, MySqlRow};
use sqlx::types::chrono::{NaiveDate, NaiveDateTime};
use sqlx::types::BigDecimal;
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::{hex_encode, RowSet};

pub async fn connect(url: &str) -> Result<MySqlPool, String> {
    MySqlPoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn version(pool: &MySqlPool) -> Option<String> {
    sqlx::query_scalar::<_, String>("select version()")
        .fetch_one(pool)
        .await
        .ok()
}

pub async fn run_query(pool: &MySqlPool, sql: &str, cap: usize) -> Result<RowSet, String> {
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

/// Decode a MySQL/MariaDB cell by column type.
fn cell_to_json(row: &MySqlRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    let ty = row.column(i).type_info().name();
    match ty {
        "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" | "YEAR" => {
            row.try_get::<i64, _>(i).map(Value::from).unwrap_or(Value::Null)
        }
        "FLOAT" => row.try_get::<f32, _>(i).map(|v| Value::from(v as f64)).unwrap_or(Value::Null),
        "DOUBLE" => row.try_get::<f64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "DECIMAL" | "NEWDECIMAL" => row
            .try_get::<BigDecimal, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "JSON" => row.try_get::<Value, _>(i).unwrap_or(Value::Null),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "DATE" => row
            .try_get::<NaiveDate, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|b| Value::String(format!("\\x{}", hex_encode(&b))))
            .unwrap_or(Value::Null),
        "VARCHAR" | "CHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => {
            row.try_get::<String, _>(i).map(Value::String).unwrap_or(Value::Null)
        }
        // Unsigned ints, TIME, and surprises: ladder through supported decodes.
        _ => row
            .try_get::<i64, _>(i)
            .map(Value::from)
            .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
            .or_else(|_| row.try_get::<String, _>(i).map(Value::String))
            .unwrap_or_else(|_| Value::String(format!("<{ty}>"))),
    }
}
