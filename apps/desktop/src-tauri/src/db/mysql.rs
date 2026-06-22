//! MySQL / MariaDB / TiDB via a native sqlx pool.

use std::collections::BTreeMap;

use futures_util::TryStreamExt;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions, MySqlRow};
use sqlx::types::chrono::{NaiveDate, NaiveDateTime};
use sqlx::types::BigDecimal;
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind,
    IndexMetadata, RowSet, SchemaMetadata,
};

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

pub async fn metadata(pool: &MySqlPool) -> Result<DatabaseMetadata, String> {
    let schema_name = sqlx::query_scalar::<_, Option<String>>("select database()")
        .fetch_one(pool)
        .await
        .map_err(|e| format!("metadata failed: {e}"))?
        .ok_or_else(|| "no active database selected".to_string())?;

    let object_rows = sqlx::query(
        r#"
        select cast(table_schema as char),
               cast(table_name as char),
               cast(table_type as char)
        from information_schema.tables
        where table_schema = database()
          and table_type in ('BASE TABLE', 'VIEW')
        order by table_schema, table_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata objects failed: {e}"))?;

    let mut schemas: BTreeMap<String, BTreeMap<String, DbObjectMetadata>> = BTreeMap::new();
    for row in object_rows {
        let schema: String = row.try_get(0).unwrap_or_else(|_| schema_name.clone());
        let name: String = row.try_get(1).unwrap_or_default();
        let table_type: String = row.try_get(2).unwrap_or_default();
        let kind = if table_type == "VIEW" {
            DbObjectMetadataKind::View
        } else {
            DbObjectMetadataKind::Table
        };
        schemas.entry(schema.clone()).or_default().insert(
            name.clone(),
            DbObjectMetadata {
                schema,
                name,
                kind,
                columns: Vec::new(),
                indexes: Vec::new(),
            },
        );
    }

    let column_rows = sqlx::query(
        r#"
        select cast(table_schema as char),
               cast(table_name as char),
               cast(column_name as char),
               cast(column_type as char),
               cast(is_nullable as char),
               cast(ordinal_position as signed),
               cast(column_default as char)
        from information_schema.columns
        where table_schema = database()
        order by table_schema, table_name, ordinal_position
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata columns failed: {e}"))?;

    for row in column_rows {
        let schema: String = row.try_get(0).unwrap_or_else(|_| schema_name.clone());
        let table: String = row.try_get(1).unwrap_or_default();
        if let Some(object) = schemas.get_mut(&schema).and_then(|s| s.get_mut(&table)) {
            let nullable: String = row.try_get(4).unwrap_or_default();
            object.columns.push(ColumnMetadata {
                name: row.try_get(2).unwrap_or_default(),
                data_type: row.try_get(3).unwrap_or_default(),
                nullable: nullable == "YES",
                ordinal: row.try_get::<i32, _>(5).unwrap_or_default(),
                default_value: row.try_get::<Option<String>, _>(6).unwrap_or(None),
            });
        }
    }

    let index_rows = sqlx::query(
        r#"
        select cast(table_schema as char),
               cast(table_name as char),
               cast(index_name as char),
               cast(min(non_unique) as signed) as non_unique,
               cast(group_concat(column_name order by seq_in_index separator ',') as char) as columns
        from information_schema.statistics
        where table_schema = database()
          and column_name is not null
        group by table_schema, table_name, index_name
        order by table_schema, table_name, index_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata indexes failed: {e}"))?;

    for row in index_rows {
        let schema: String = row.try_get(0).unwrap_or_else(|_| schema_name.clone());
        let table: String = row.try_get(1).unwrap_or_default();
        if let Some(object) = schemas.get_mut(&schema).and_then(|s| s.get_mut(&table)) {
            let raw_columns: String = row.try_get(4).unwrap_or_default();
            let columns = raw_columns
                .split(',')
                .filter(|part| !part.is_empty())
                .map(str::to_string)
                .collect();
            let non_unique = row.try_get::<i64, _>(3).unwrap_or(1);
            object.indexes.push(IndexMetadata {
                name: row.try_get(2).unwrap_or_default(),
                columns,
                unique: non_unique == 0,
            });
        }
    }

    Ok(DatabaseMetadata {
        schemas: schemas
            .into_iter()
            .map(|(name, objects)| SchemaMetadata {
                name,
                objects: objects.into_values().collect(),
            })
            .collect(),
    })
}

/// Decode a MySQL/MariaDB cell by column type.
fn cell_to_json(row: &MySqlRow, i: usize) -> serde_json::Value {
    use serde_json::Value;
    if row.try_get_raw(i).map(|v| v.is_null()).unwrap_or(true) {
        return Value::Null;
    }
    let ty = row.column(i).type_info().name();
    match ty {
        "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" | "YEAR" => row
            .try_get::<i64, _>(i)
            .map(Value::from)
            .unwrap_or(Value::Null),
        "FLOAT" => row
            .try_get::<f32, _>(i)
            .map(|v| Value::from(v as f64))
            .unwrap_or(Value::Null),
        "DOUBLE" => row
            .try_get::<f64, _>(i)
            .map(Value::from)
            .unwrap_or(Value::Null),
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
            row.try_get::<String, _>(i)
                .map(Value::String)
                .unwrap_or(Value::Null)
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
