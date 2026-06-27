//! MySQL / MariaDB / TiDB via a native sqlx pool.

use sqlx::mysql::{MySqlPool, MySqlPoolOptions, MySqlRow};
use sqlx::types::chrono::{NaiveDate, NaiveDateTime};
use sqlx::types::BigDecimal;
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::meta::MetaBuilder;
use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbObjectMetadataKind, DbQuickSample,
    IndexMetadata, PreparedQuery, RowSet,
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
    super::stream::collect_capped(
        sqlx::query(super::audited_sql(sql)).fetch(pool),
        cap,
        cell_to_json,
    )
    .await
}

pub async fn run_prepared_query(
    pool: &MySqlPool,
    query: &PreparedQuery,
    cap: usize,
) -> Result<RowSet, String> {
    super::stream::collect_capped(bind_query(query).fetch(pool), cap, cell_to_json).await
}

pub async fn stream_query(
    pool: &MySqlPool,
    sql: &str,
    ctx: &super::stream::StreamCtx,
) -> Result<super::stream::StreamSummary, String> {
    super::stream::stream_capped(
        sqlx::query(super::audited_sql(sql)).fetch(pool),
        ctx,
        cell_to_json,
    )
    .await
}

pub async fn stream_prepared_query(
    pool: &MySqlPool,
    query: &PreparedQuery,
    ctx: &super::stream::StreamCtx,
) -> Result<super::stream::StreamSummary, String> {
    super::stream::stream_capped(bind_query(query).fetch(pool), ctx, cell_to_json).await
}

/// Apply result-grid edits in one transaction (rolls back on the first failure).
pub async fn apply_edits(
    pool: &MySqlPool,
    edits: &super::edit::TableEdits,
) -> Result<super::edit::AppliedEdits, String> {
    let plan = super::edit::plan(super::engine::Wire::Mysql, edits)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin failed: {e}"))?;
    let mut applied = super::edit::AppliedEdits::default();
    for stmt in &plan.deletes {
        applied.deleted += bind(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("delete failed: {e}"))?
            .rows_affected();
    }
    for stmt in &plan.updates {
        applied.updated += bind(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("update failed: {e}"))?
            .rows_affected();
    }
    for stmt in &plan.inserts {
        applied.inserted += bind(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert failed: {e}"))?
            .rows_affected();
    }
    tx.commit()
        .await
        .map_err(|e| format!("commit failed: {e}"))?;
    Ok(applied)
}

fn bind(
    stmt: &super::edit::Statement,
) -> sqlx::query::Query<'_, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    use serde_json::Value;
    let mut q = sqlx::query(super::audited_sql(&stmt.sql));
    for value in &stmt.params {
        q = match value {
            Value::Null => q.bind(Option::<String>::None),
            Value::Bool(b) => q.bind(*b),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    q.bind(i)
                } else if let Some(f) = n.as_f64() {
                    q.bind(f)
                } else {
                    q.bind(n.to_string())
                }
            }
            Value::String(s) => q.bind(s.clone()),
            other => q.bind(other.to_string()),
        };
    }
    q
}

fn bind_query(
    query: &PreparedQuery,
) -> sqlx::query::Query<'_, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    bind_json(sqlx::query(super::audited_sql(&query.sql)), &query.params)
}

fn bind_json<'q>(
    mut q: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    params: &'q [serde_json::Value],
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    use serde_json::Value;
    for value in params {
        q = match value {
            Value::Null => q.bind(Option::<String>::None),
            Value::Bool(b) => q.bind(*b),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    q.bind(i)
                } else if let Some(f) = n.as_f64() {
                    q.bind(f)
                } else {
                    q.bind(n.to_string())
                }
            }
            Value::String(s) => q.bind(s.clone()),
            other => q.bind(other.to_string()),
        };
    }
    q
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
               cast(table_type as char),
               cast(table_comment as char),
               cast(table_rows as signed)
        from information_schema.tables
        where table_schema = database()
          and table_type in ('BASE TABLE', 'VIEW')
        order by table_schema, table_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata objects failed: {e}"))?;

    let mut builder = MetaBuilder::default();
    for row in object_rows {
        let schema: String = row.try_get(0).unwrap_or_else(|_| schema_name.clone());
        let name: String = row.try_get(1).unwrap_or_default();
        let table_type: String = row.try_get(2).unwrap_or_default();
        let kind = if table_type == "VIEW" {
            DbObjectMetadataKind::View
        } else {
            DbObjectMetadataKind::Table
        };
        builder.add_object(schema.clone(), name.clone(), kind);
        if let Some(object) = builder.object_mut(&schema, &name) {
            let comment = row.try_get::<Option<String>, _>(3).unwrap_or(None);
            object.comment = comment.filter(|comment| !comment.is_empty());
            let estimate = row.try_get::<Option<i64>, _>(4).unwrap_or(None);
            object.row_estimate = estimate.and_then(|value| (value >= 0).then_some(value as u64));
        }
    }

    let routine_rows = sqlx::query(
        r#"
        select cast(routine_schema as char),
               cast(routine_name as char),
               cast(routine_type as char)
        from information_schema.routines
        where routine_schema = database()
        order by routine_schema, routine_name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata routines failed: {e}"))?;

    for row in routine_rows {
        let schema: String = row.try_get(0).unwrap_or_else(|_| schema_name.clone());
        let name: String = row.try_get(1).unwrap_or_default();
        let routine_type: String = row.try_get(2).unwrap_or_default();
        let kind = if routine_type == "FUNCTION" {
            DbObjectMetadataKind::Function
        } else {
            DbObjectMetadataKind::Procedure
        };
        builder.add_object(schema, name, kind);
    }

    let column_rows = sqlx::query(
        r#"
        select cast(table_schema as char),
               cast(table_name as char),
               cast(column_name as char),
               cast(column_type as char),
               cast(is_nullable as char),
               cast(ordinal_position as signed),
               cast(column_default as char),
               cast(column_comment as char)
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
        if let Some(object) = builder.object_mut(&schema, &table) {
            let nullable: String = row.try_get(4).unwrap_or_default();
            object.columns.push(ColumnMetadata {
                name: row.try_get(2).unwrap_or_default(),
                data_type: row.try_get(3).unwrap_or_default(),
                nullable: nullable == "YES",
                ordinal: row.try_get::<i32, _>(5).unwrap_or_default(),
                default_value: row.try_get::<Option<String>, _>(6).unwrap_or(None),
                comment: row
                    .try_get::<Option<String>, _>(7)
                    .unwrap_or(None)
                    .filter(|comment| !comment.is_empty()),
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
        if let Some(object) = builder.object_mut(&schema, &table) {
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

    let pk_rows = sqlx::query(
        r#"
        select cast(table_schema as char), cast(table_name as char),
               cast(column_name as char)
        from information_schema.key_column_usage
        where table_schema = database() and constraint_name = 'PRIMARY'
        order by table_schema, table_name, ordinal_position
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata primary keys failed: {e}"))?;
    for row in pk_rows {
        let schema: String = row.try_get(0).unwrap_or_default();
        let table: String = row.try_get(1).unwrap_or_default();
        if let Some(object) = builder.object_mut(&schema, &table) {
            if let Ok(column) = row.try_get::<String, _>(2) {
                object.primary_key.push(column);
            }
        }
    }

    let fk_rows = sqlx::query(
        r#"
        select cast(table_schema as char), cast(table_name as char),
               cast(constraint_name as char), cast(column_name as char),
               cast(referenced_table_schema as char), cast(referenced_table_name as char),
               cast(referenced_column_name as char)
        from information_schema.key_column_usage
        where table_schema = database() and referenced_table_name is not null
        order by table_schema, table_name, constraint_name, ordinal_position
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata foreign keys failed: {e}"))?;
    // Rows for one FK share (table, constraint_name); accumulate in order.
    let mut current: Option<(String, String, String)> = None;
    for row in fk_rows {
        let schema: String = row.try_get(0).unwrap_or_default();
        let table: String = row.try_get(1).unwrap_or_default();
        let constraint: String = row.try_get(2).unwrap_or_default();
        let column: String = row.try_get(3).unwrap_or_default();
        let ref_schema: String = row.try_get(4).unwrap_or_default();
        let ref_table: String = row.try_get(5).unwrap_or_default();
        let ref_column: String = row.try_get(6).unwrap_or_default();
        let key = (schema.clone(), table.clone(), constraint.clone());
        if let Some(object) = builder.object_mut(&schema, &table) {
            if current.as_ref() != Some(&key) {
                object.foreign_keys.push(super::ForeignKey {
                    columns: Vec::new(),
                    references_schema: Some(ref_schema),
                    references_table: ref_table,
                    references_columns: Vec::new(),
                });
                current = Some(key);
            }
            if let Some(fk) = object.foreign_keys.last_mut() {
                fk.columns.push(column);
                fk.references_columns.push(ref_column);
            }
        }
    }

    for (schema, table) in builder.object_keys() {
        if let Some(ddl) = show_create_table(pool, &schema, &table).await {
            if let Some(object) = builder.object_mut(&schema, &table) {
                object.ddl = Some(ddl);
            }
        }
        let columns = match builder.object_mut(&schema, &table) {
            Some(object) => object.columns.clone(),
            None => continue,
        };
        if let Some(sample) = quick_sample(pool, &schema, &table, &columns).await {
            if let Some(object) = builder.object_mut(&schema, &table) {
                object.sample = Some(sample);
            }
        }
    }

    Ok(builder.finish())
}

async fn show_create_table(pool: &MySqlPool, schema: &str, table: &str) -> Option<String> {
    let sql = format!("show create table {}", qualified_ident(schema, table));
    let row = sqlx::query(super::audited_sql(&sql))
        .fetch_one(pool)
        .await
        .ok()?;
    row.try_get::<String, _>(1).ok()
}

async fn quick_sample(
    pool: &MySqlPool,
    schema: &str,
    table: &str,
    columns: &[ColumnMetadata],
) -> Option<DbQuickSample> {
    let sample_sql = format!("select * from {} limit 6", qualified_ident(schema, table));
    let mut rows = sqlx::query(super::audited_sql(&sample_sql))
        .fetch_all(pool)
        .await
        .ok()?;
    let truncated = rows.len() > 5;
    rows.truncate(5);
    Some(DbQuickSample {
        columns: columns.iter().map(|column| column.name.clone()).collect(),
        rows: rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|index| sample_cell(cell_to_json(row, index)))
                    .collect()
            })
            .collect(),
        truncated,
    })
}

fn qualified_ident(schema: &str, name: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(name))
}

fn quote_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

fn sample_cell(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::String(value) => value,
        other => other.to_string(),
    }
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
