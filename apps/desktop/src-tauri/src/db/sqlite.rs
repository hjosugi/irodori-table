//! SQLite via a native sqlx pool. SQLite is dynamically typed, so values are
//! decoded by trying the storage classes in order.

use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::{Row, ValueRef};

use super::meta::MetaBuilder;
use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbObjectMetadataKind, IndexMetadata,
    RawResultSet, RowSet,
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
    super::stream::collect_capped(sqlx::query(sql).fetch(pool), cap, cell_to_json).await
}

pub async fn run_query_sets(
    pool: &SqlitePool,
    sql: &str,
    cap: usize,
) -> Result<Vec<RawResultSet>, String> {
    let statements = super::split_sql_statements(sql);
    let statements = if statements.is_empty() {
        vec![sql.trim().to_string()]
    } else {
        statements
    };
    let mut sets = Vec::with_capacity(statements.len());
    for (statement_index, statement) in statements.into_iter().enumerate() {
        let start = std::time::Instant::now();
        let (columns, rows, truncated) = run_query(pool, &statement, cap).await?;
        sets.push(RawResultSet {
            statement_index,
            statement,
            columns,
            rows,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
        });
    }
    Ok(sets)
}

pub async fn stream_query(
    pool: &SqlitePool,
    sql: &str,
    ctx: &super::stream::StreamCtx,
) -> Result<super::stream::StreamSummary, String> {
    super::stream::stream_capped(sqlx::query(sql).fetch(pool), ctx, cell_to_json).await
}

pub async fn stream_query_sets(
    pool: &SqlitePool,
    sql: &str,
    ctx: &super::stream::StreamCtx,
) -> Result<super::stream::StreamSummary, String> {
    let statements = super::split_sql_statements(sql);
    let statements = if statements.is_empty() {
        vec![sql.trim().to_string()]
    } else {
        statements
    };
    let mut result_sets = Vec::with_capacity(statements.len());
    let mut row_count = 0;
    let mut truncated = false;
    for (statement_index, statement) in statements.into_iter().enumerate() {
        if ctx.cancelled() {
            return Err("query cancelled".to_string());
        }
        let set_ctx = ctx.for_result_set(statement_index);
        let start = std::time::Instant::now();
        let mut summary = stream_query(pool, &statement, &set_ctx).await?;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        row_count += summary.row_count;
        truncated |= summary.truncated;
        for set in &mut summary.result_sets {
            set.elapsed_ms = elapsed_ms;
        }
        result_sets.extend(summary.result_sets);
    }
    Ok(super::stream::StreamSummary {
        result_sets,
        truncated,
        row_count,
    })
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

    let mut builder = MetaBuilder::default();
    for row in object_rows {
        let schema: String = row.try_get("schema_name").unwrap_or_else(|_| "main".into());
        let name: String = row.try_get("name").unwrap_or_default();
        let object_type: String = row.try_get("type").unwrap_or_default();
        let kind = if object_type == "view" {
            DbObjectMetadataKind::View
        } else {
            DbObjectMetadataKind::Table
        };
        builder.add_object(schema, name, kind);
    }

    for (schema, table) in builder.object_keys() {
        let column_sql = format!("pragma table_xinfo({})", quote_string(&table));
        let column_rows = sqlx::query(&column_sql)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("metadata columns failed for {table}: {e}"))?;

        if let Some(object) = builder.object_mut(&schema, &table) {
            // `pk` in table_xinfo is the 1-based position in the primary key (0 = not
            // a key column); collect and order them.
            let mut primary_key: Vec<(i64, String)> = Vec::new();
            for row in column_rows {
                let hidden = row.try_get::<i64, _>("hidden").unwrap_or(0);
                if hidden != 0 {
                    continue;
                }
                let not_null = row.try_get::<i64, _>("notnull").unwrap_or(0);
                let ordinal = row.try_get::<i64, _>("cid").unwrap_or(0) as i32 + 1;
                let name: String = row.try_get("name").unwrap_or_default();
                let pk = row.try_get::<i64, _>("pk").unwrap_or(0);
                if pk > 0 {
                    primary_key.push((pk, name.clone()));
                }
                object.columns.push(ColumnMetadata {
                    name,
                    data_type: row
                        .try_get::<String, _>("type")
                        .unwrap_or_else(|_| "ANY".into()),
                    nullable: not_null == 0,
                    ordinal,
                    default_value: row
                        .try_get::<Option<String>, _>("dflt_value")
                        .unwrap_or(None),
                    comment: None,
                });
            }
            primary_key.sort_by_key(|(position, _)| *position);
            object.primary_key = primary_key.into_iter().map(|(_, name)| name).collect();

            let fk_sql = format!("pragma foreign_key_list({})", quote_string(&table));
            let fk_rows = sqlx::query(&fk_sql)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("metadata foreign keys failed for {table}: {e}"))?;
            // Rows for one FK share an `id`, ordered by `seq`.
            let mut by_id: std::collections::BTreeMap<i64, super::ForeignKey> =
                std::collections::BTreeMap::new();
            for row in fk_rows {
                let id = row.try_get::<i64, _>("id").unwrap_or(0);
                let entry = by_id.entry(id).or_insert_with(|| super::ForeignKey {
                    columns: Vec::new(),
                    references_schema: None,
                    references_table: row.try_get::<String, _>("table").unwrap_or_default(),
                    references_columns: Vec::new(),
                });
                if let Ok(from) = row.try_get::<String, _>("from") {
                    entry.columns.push(from);
                }
                if let Ok(to) = row.try_get::<String, _>("to") {
                    entry.references_columns.push(to);
                }
            }
            object.foreign_keys = by_id.into_values().collect();

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

    Ok(builder.finish())
}

fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Apply result-grid edits in one transaction (rolls back on the first failure).
pub async fn apply_edits(
    pool: &SqlitePool,
    edits: &super::edit::TableEdits,
) -> Result<super::edit::AppliedEdits, String> {
    let plan = super::edit::plan(super::engine::Wire::Sqlite, edits)?;
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

/// Bind a statement's JSON params by inferred storage class (SQLite is dynamically
/// typed, so text/int/real/null all bind cleanly).
fn bind(
    stmt: &super::edit::Statement,
) -> sqlx::query::Query<'_, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'_>> {
    use serde_json::Value;
    let mut q = sqlx::query(&stmt.sql);
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
