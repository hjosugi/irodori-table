//! PostgreSQL (and Postgres-wire engines) via a native sqlx pool.

use futures_util::TryStreamExt;
use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::{hex_encode, RowSet};

pub async fn connect(url: &str) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn version(pool: &PgPool) -> Option<String> {
    sqlx::query_scalar::<_, String>("select version()")
        .fetch_one(pool)
        .await
        .ok()
}

pub async fn run_query(pool: &PgPool, sql: &str, cap: usize) -> Result<RowSet, String> {
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

/// Decode a PostgreSQL cell by column type. Exact numerics/temporals become
/// strings to preserve precision and timezone (DBeaver's `setBigDecimal` rule).
fn cell_to_json(row: &PgRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    let ty = row.column(i).type_info().name();
    match ty {
        "BOOL" => row.try_get::<bool, _>(i).map(Value::Bool).unwrap_or(Value::Null),
        "INT2" => row.try_get::<i16, _>(i).map(|v| Value::from(v as i64)).unwrap_or(Value::Null),
        "INT4" => row.try_get::<i32, _>(i).map(|v| Value::from(v as i64)).unwrap_or(Value::Null),
        "INT8" => row.try_get::<i64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "FLOAT4" => row.try_get::<f32, _>(i).map(|v| Value::from(v as f64)).unwrap_or(Value::Null),
        "FLOAT8" => row.try_get::<f64, _>(i).map(Value::from).unwrap_or(Value::Null),
        "NUMERIC" => row
            .try_get::<BigDecimal, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "UUID" => row
            .try_get::<Uuid, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "JSON" | "JSONB" => row.try_get::<Value, _>(i).unwrap_or(Value::Null),
        "TIMESTAMPTZ" => row
            .try_get::<DateTime<Utc>, _>(i)
            .map(|v| Value::String(v.to_rfc3339()))
            .unwrap_or(Value::Null),
        "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "DATE" => row
            .try_get::<NaiveDate, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "TIME" => row
            .try_get::<NaiveTime, _>(i)
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "BYTEA" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|b| Value::String(format!("\\x{}", hex_encode(&b))))
            .unwrap_or(Value::Null),
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CHAR" | "CITEXT" => {
            row.try_get::<String, _>(i).map(Value::String).unwrap_or(Value::Null)
        }
        // Arrays and less-common types: best-effort text, else a tagged placeholder.
        _ => row
            .try_get::<String, _>(i)
            .map(Value::String)
            .or_else(|_| row.try_get::<i64, _>(i).map(Value::from))
            .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
            .unwrap_or_else(|_| Value::String(format!("<{ty}>"))),
    }
}
