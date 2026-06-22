//! SQLite via a native sqlx pool. SQLite is dynamically typed, so values are
//! decoded by trying the storage classes in order.

use std::collections::BTreeMap;

use futures_util::TryStreamExt;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Row, ValueRef};

use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind,
    IndexMetadata, RowSet, SchemaMetadata,
};

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

pub async fn metadata(pool: &SqlitePool) -> Result<DatabaseMetadata, String> {
    let object_rows = sqlx::query(
        r#"
        select 'main' as schema_name, name, type
        from sqlite_master
        where type in ('table', 'view')
          and name not like 'sqlite_%'
        order by type, name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata objects failed: {e}"))?;

    let mut schemas: BTreeMap<String, BTreeMap<String, DbObjectMetadata>> = BTreeMap::new();
    for row in object_rows {
        let schema: String = row.try_get("schema_name").unwrap_or_else(|_| "main".into());
        let name: String = row.try_get("name").unwrap_or_default();
        let object_type: String = row.try_get("type").unwrap_or_default();
        let kind = if object_type == "view" {
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

    let object_names: Vec<(String, String)> = schemas
        .iter()
        .flat_map(|(schema, objects)| {
            objects
                .keys()
                .map(|name| (schema.clone(), name.clone()))
                .collect::<Vec<_>>()
        })
        .collect();

    for (schema, table) in object_names {
        let column_sql = format!("pragma table_xinfo({})", quote_string(&table));
        let column_rows = sqlx::query(&column_sql)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("metadata columns failed for {table}: {e}"))?;

        if let Some(object) = schemas.get_mut(&schema).and_then(|s| s.get_mut(&table)) {
            for row in column_rows {
                let hidden = row.try_get::<i64, _>("hidden").unwrap_or(0);
                if hidden != 0 {
                    continue;
                }
                let not_null = row.try_get::<i64, _>("notnull").unwrap_or(0);
                let ordinal = row.try_get::<i64, _>("cid").unwrap_or(0) as i32 + 1;
                object.columns.push(ColumnMetadata {
                    name: row.try_get("name").unwrap_or_default(),
                    data_type: row
                        .try_get::<String, _>("type")
                        .unwrap_or_else(|_| "ANY".into()),
                    nullable: not_null == 0,
                    ordinal,
                    default_value: row
                        .try_get::<Option<String>, _>("dflt_value")
                        .unwrap_or(None),
                });
            }

            let index_sql = format!("pragma index_list({})", quote_string(&table));
            let index_rows = sqlx::query(&index_sql)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("metadata indexes failed for {table}: {e}"))?;

            for row in index_rows {
                let name: String = row.try_get("name").unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let unique = row.try_get::<i64, _>("unique").unwrap_or(0) == 1;
                let info_sql = format!("pragma index_info({})", quote_string(&name));
                let info_rows = sqlx::query(&info_sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| format!("metadata index columns failed for {name}: {e}"))?;
                let mut columns = Vec::new();
                for info in info_rows {
                    if let Ok(column) = info.try_get::<String, _>("name") {
                        columns.push(column);
                    }
                }
                object.indexes.push(IndexMetadata {
                    name,
                    columns,
                    unique,
                });
            }
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

fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
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
