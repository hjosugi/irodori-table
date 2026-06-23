//! PostgreSQL (and Postgres-wire engines) via a native sqlx pool.

use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::meta::MetaBuilder;
use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbObjectMetadataKind, IndexMetadata, RowSet,
};

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
    super::stream::collect_capped(sqlx::query(sql).fetch(pool), cap, cell_to_json).await
}

pub async fn stream_query(
    pool: &PgPool,
    sql: &str,
    ctx: &super::stream::StreamCtx,
) -> Result<super::stream::StreamSummary, String> {
    super::stream::stream_capped(sqlx::query(sql).fetch(pool), ctx, cell_to_json).await
}

pub async fn metadata(pool: &PgPool) -> Result<DatabaseMetadata, String> {
    let object_rows = sqlx::query(
        r#"
        select table_schema, table_name, table_type
        from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
          and table_type in ('BASE TABLE', 'VIEW')
        order by table_schema, table_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata failed: {e}"))?;

    let mut builder = MetaBuilder::default();
    for row in object_rows {
        let schema: String = row.try_get("table_schema").unwrap_or_default();
        let name: String = row.try_get("table_name").unwrap_or_default();
        let table_type: String = row.try_get("table_type").unwrap_or_default();
        let kind = if table_type == "VIEW" {
            DbObjectMetadataKind::View
        } else {
            DbObjectMetadataKind::Table
        };
        builder.add_object(schema, name, kind);
    }

    let column_rows = sqlx::query(
        r#"
        select table_schema, table_name, column_name, data_type, is_nullable,
               ordinal_position, column_default
        from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
        order by table_schema, table_name, ordinal_position
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata columns failed: {e}"))?;

    for row in column_rows {
        let schema: String = row.try_get("table_schema").unwrap_or_default();
        let table: String = row.try_get("table_name").unwrap_or_default();
        if let Some(object) = builder.object_mut(&schema, &table) {
            let nullable: String = row.try_get("is_nullable").unwrap_or_default();
            object.columns.push(ColumnMetadata {
                name: row.try_get("column_name").unwrap_or_default(),
                data_type: row.try_get("data_type").unwrap_or_default(),
                nullable: nullable == "YES",
                ordinal: row
                    .try_get::<i32, _>("ordinal_position")
                    .unwrap_or_default(),
                default_value: row.try_get("column_default").ok(),
            });
        }
    }

    let index_rows = sqlx::query(
        r#"
        select ns.nspname as schema_name,
               tbl.relname as table_name,
               idx.relname as index_name,
               ix.indisunique as is_unique,
               coalesce(
                 array_agg(att.attname order by key_ord.ordinality)
                   filter (where att.attname is not null),
                 array[]::text[]
               ) as columns
        from pg_index ix
        join pg_class tbl on tbl.oid = ix.indrelid
        join pg_namespace ns on ns.oid = tbl.relnamespace
        join pg_class idx on idx.oid = ix.indexrelid
        left join lateral unnest(ix.indkey) with ordinality as key_ord(attnum, ordinality) on true
        left join pg_attribute att on att.attrelid = tbl.oid and att.attnum = key_ord.attnum
        where ns.nspname not in ('pg_catalog', 'information_schema')
        group by ns.nspname, tbl.relname, idx.relname, ix.indisunique
        order by ns.nspname, tbl.relname, idx.relname
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata indexes failed: {e}"))?;

    for row in index_rows {
        let schema: String = row.try_get("schema_name").unwrap_or_default();
        let table: String = row.try_get("table_name").unwrap_or_default();
        if let Some(object) = builder.object_mut(&schema, &table) {
            object.indexes.push(IndexMetadata {
                name: row.try_get("index_name").unwrap_or_default(),
                columns: row.try_get("columns").unwrap_or_default(),
                unique: row.try_get("is_unique").unwrap_or(false),
            });
        }
    }

    Ok(builder.finish())
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
        "BOOL" => row
            .try_get::<bool, _>(i)
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        "INT2" => row
            .try_get::<i16, _>(i)
            .map(|v| Value::from(v as i64))
            .unwrap_or(Value::Null),
        "INT4" => row
            .try_get::<i32, _>(i)
            .map(|v| Value::from(v as i64))
            .unwrap_or(Value::Null),
        "INT8" => row
            .try_get::<i64, _>(i)
            .map(Value::from)
            .unwrap_or(Value::Null),
        "FLOAT4" => row
            .try_get::<f32, _>(i)
            .map(|v| Value::from(v as f64))
            .unwrap_or(Value::Null),
        "FLOAT8" => row
            .try_get::<f64, _>(i)
            .map(Value::from)
            .unwrap_or(Value::Null),
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
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CHAR" | "CITEXT" => row
            .try_get::<String, _>(i)
            .map(Value::String)
            .unwrap_or(Value::Null),
        // Arrays and less-common types: best-effort text, else a tagged placeholder.
        _ => row
            .try_get::<String, _>(i)
            .map(Value::String)
            .or_else(|_| row.try_get::<i64, _>(i).map(Value::from))
            .or_else(|_| row.try_get::<f64, _>(i).map(Value::from))
            .unwrap_or_else(|_| Value::String(format!("<{ty}>"))),
    }
}
