//! SQLite via a native sqlx pool. SQLite is dynamically typed, so values are
//! decoded by trying the storage classes in order.

use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::{Row, ValueRef};

use super::error::{DbError, DbResult};
use super::meta::MetaBuilder;
use super::{engine::Wire, explain};
use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbObjectMetadataKind, DbQuickSample,
    IndexMetadata, PreparedQuery, QueryPlanAnalysis, QueryPlanMode, RawResultSet, RowSet,
};

pub async fn connect(url: &str) -> DbResult<SqlitePool> {
    // Single writer; one connection avoids file-lock surprises.
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect(url)
        .await
        .map_err(|e| DbError::connection(format!("connect failed: {e}")))
}

pub async fn seed_sample(pool: &SqlitePool) -> DbResult<()> {
    let statements = [
        r#"
        create table if not exists countries (
            id integer primary key,
            iso_code text not null unique,
            name text not null
        )
        "#,
        r#"
        create table if not exists customers (
            id integer primary key,
            name text not null,
            country_id integer references countries(id),
            lifetime_value integer not null,
            last_order_at text
        )
        "#,
        r#"
        create table if not exists orders (
            id integer primary key,
            customer_id integer not null references customers(id),
            ordered_at text not null,
            total integer not null,
            status text not null
        )
        "#,
        r#"
        create view if not exists customer_revenue as
        select c.id, c.name, coalesce(sum(o.total), 0) as total_revenue
        from customers c
        left join orders o on o.customer_id = c.id
        group by c.id, c.name
        "#,
    ];
    for statement in statements {
        sqlx::query(super::audited_sql(statement))
            .execute(pool)
            .await
            .map_err(|e| DbError::query(format!("sqlite sample schema failed: {e}")))?;
    }

    let existing = sqlx::query_scalar::<_, i64>("select count(*) from customers")
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    if existing > 0 {
        return Ok(());
    }

    let inserts = [
        r#"
        insert into countries (id, iso_code, name) values
            (1, 'JP', 'Japan'),
            (2, 'US', 'United States'),
            (3, 'NL', 'Netherlands')
        "#,
        r#"
        insert into customers (id, name, country_id, lifetime_value, last_order_at) values
            (233, 'Shiro Systems', 1, 4412200, '2026-06-18 16:15'),
            (447, 'Minato Labs', 1, 5128800, '2026-06-19 08:03'),
            (620, 'Higashi Market', 1, 4889100, '2026-06-18 19:27'),
            (917, 'Northwind Retail', 2, 7720100, '2026-06-20 11:12'),
            (1029, 'Kawase Foods', 1, 9841200, '2026-06-20 18:34'),
            (1104, 'Iris Trading', 3, 3824000, '2026-06-17 21:06'),
            (1441, 'Aster Works', 2, 6533000, '2026-06-19 23:41')
        "#,
        r#"
        insert into orders (id, customer_id, ordered_at, total, status) values
            (1, 1029, '2026-06-20 18:34', 9841200, 'paid'),
            (2, 917, '2026-06-20 11:12', 7720100, 'paid'),
            (3, 1441, '2026-06-19 23:41', 6533000, 'paid'),
            (4, 447, '2026-06-19 08:03', 5128800, 'processing'),
            (5, 620, '2026-06-18 19:27', 4889100, 'paid'),
            (6, 233, '2026-06-18 16:15', 4412200, 'paid'),
            (7, 1104, '2026-06-17 21:06', 3824000, 'refunded')
        "#,
    ];
    for statement in inserts {
        sqlx::query(super::audited_sql(statement))
            .execute(pool)
            .await
            .map_err(|e| DbError::query(format!("sqlite sample data failed: {e}")))?;
    }
    Ok(())
}

pub async fn version(pool: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>("select sqlite_version()")
        .fetch_one(pool)
        .await
        .ok()
}

pub async fn run_query(pool: &SqlitePool, sql: &str, cap: usize) -> DbResult<RowSet> {
    super::stream::collect_capped(
        sqlx::query(super::audited_sql(sql)).fetch(pool),
        cap,
        cell_to_json,
    )
    .await
}

pub async fn run_prepared_query(
    pool: &SqlitePool,
    query: &PreparedQuery,
    cap: usize,
) -> DbResult<RowSet> {
    super::stream::collect_capped(bind_query(query).fetch(pool), cap, cell_to_json).await
}

pub async fn run_query_sets(
    pool: &SqlitePool,
    sql: &str,
    cap: usize,
) -> DbResult<Vec<RawResultSet>> {
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
) -> DbResult<super::stream::StreamSummary> {
    super::stream::stream_capped(
        sqlx::query(super::audited_sql(sql)).fetch(pool),
        ctx,
        cell_to_json,
    )
    .await
}

pub async fn stream_prepared_query(
    pool: &SqlitePool,
    query: &PreparedQuery,
    ctx: &super::stream::StreamCtx,
) -> DbResult<super::stream::StreamSummary> {
    super::stream::stream_capped(bind_query(query).fetch(pool), ctx, cell_to_json).await
}

pub async fn stream_query_sets(
    pool: &SqlitePool,
    sql: &str,
    ctx: &super::stream::StreamCtx,
) -> DbResult<super::stream::StreamSummary> {
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
            return Err(DbError::cancelled("query cancelled"));
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

pub async fn explain_query(
    pool: &SqlitePool,
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
) -> DbResult<QueryPlanAnalysis> {
    let statement = single_explain_statement(sql)?;
    let explain_sql = format!("EXPLAIN QUERY PLAN {statement}");
    let rows = sqlx::query(super::audited_sql(&explain_sql))
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::query(format!("SQLite explain failed: {e}")))?
        .into_iter()
        .map(|row| {
            let id = row.try_get::<i64, _>(0).unwrap_or_default();
            let parent = row.try_get::<i64, _>(1).unwrap_or_default();
            let detail = row
                .try_get::<String, _>(3)
                .or_else(|_| row.try_get::<String, _>("detail"))
                .unwrap_or_default();
            (id, parent, detail)
        })
        .collect();
    Ok(explain::analysis_from_sqlite_rows(
        wire, &statement, mode, rows,
    ))
}

pub async fn metadata(pool: &SqlitePool) -> DbResult<DatabaseMetadata> {
    let object_rows = sqlx::query(
        r#"
        select 'main' as schema_name, name, type, sql
        from sqlite_master
        where type in ('table', 'view')
          and name not like 'sqlite_%'
        order by type, name
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::metadata(format!("metadata objects failed: {e}")))?;

    let mut builder = MetaBuilder::default();
    builder.ensure_schema("main".to_string());
    for row in object_rows {
        let schema: String = row.try_get("schema_name").unwrap_or_else(|_| "main".into());
        let name: String = row.try_get("name").unwrap_or_default();
        let object_type: String = row.try_get("type").unwrap_or_default();
        let kind = if object_type == "view" {
            DbObjectMetadataKind::View
        } else {
            DbObjectMetadataKind::Table
        };
        builder.add_object(schema.clone(), name.clone(), kind);
        if let Some(object) = builder.object_mut(&schema, &name) {
            object.ddl = row.try_get::<Option<String>, _>("sql").unwrap_or(None);
        }
    }

    for (schema, table) in builder.object_keys() {
        let column_sql = format!("pragma table_xinfo({})", quote_string(&table));
        let column_rows = sqlx::query(super::audited_sql(&column_sql))
            .fetch_all(pool)
            .await
            .map_err(|e| DbError::metadata(format!("metadata columns failed for {table}: {e}")))?;

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
            let fk_rows = sqlx::query(super::audited_sql(&fk_sql))
                .fetch_all(pool)
                .await
                .map_err(|e| {
                    DbError::metadata(format!("metadata foreign keys failed for {table}: {e}"))
                })?;
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
            let index_rows = sqlx::query(super::audited_sql(&index_sql))
                .fetch_all(pool)
                .await
                .map_err(|e| {
                    DbError::metadata(format!("metadata indexes failed for {table}: {e}"))
                })?;

            for row in index_rows {
                let name: String = row.try_get("name").unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let unique = row.try_get::<i64, _>("unique").unwrap_or(0) == 1;
                let info_sql = format!("pragma index_info({})", quote_string(&name));
                let info_rows = sqlx::query(super::audited_sql(&info_sql))
                    .fetch_all(pool)
                    .await
                    .map_err(|e| {
                        DbError::metadata(format!("metadata index columns failed for {name}: {e}"))
                    })?;
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

    for (schema, table) in builder.object_keys() {
        let columns = match builder.object_mut(&schema, &table) {
            Some(object) => object.columns.clone(),
            None => continue,
        };
        let row_estimate = row_count(pool, &schema, &table).await;
        let sample = quick_sample(pool, &schema, &table, &columns).await;
        if let Some(object) = builder.object_mut(&schema, &table) {
            object.row_estimate = row_estimate;
            object.sample = sample;
        }
    }

    Ok(builder.finish())
}

async fn row_count(pool: &SqlitePool, schema: &str, table: &str) -> Option<u64> {
    let sql = format!("select count(*) from {}", qualified_ident(schema, table));
    let count = sqlx::query_scalar::<_, i64>(super::audited_sql(&sql))
        .fetch_one(pool)
        .await
        .ok()?;
    (count >= 0).then_some(count as u64)
}

async fn quick_sample(
    pool: &SqlitePool,
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

fn qualified_ident(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn sample_cell(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::String(value) => value,
        other => other.to_string(),
    }
}

fn single_explain_statement(sql: &str) -> DbResult<String> {
    let statements = super::split_sql_statements(sql);
    let statements = if statements.is_empty() {
        vec![sql.trim().trim_end_matches(';').trim().to_string()]
    } else {
        statements
    };
    match statements.as_slice() {
        [statement] if !statement.is_empty() => Ok(statement.clone()),
        [] => Err(DbError::validation("query is empty")),
        _ => Err(DbError::validation(
            "Explain Plan supports one statement at a time",
        )),
    }
}

fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Apply result-grid edits in one transaction (rolls back on the first failure).
pub async fn apply_edits(
    pool: &SqlitePool,
    edits: &super::edit::TableEdits,
) -> DbResult<super::edit::AppliedEdits> {
    let plan = super::edit::plan(super::engine::Wire::Sqlite, edits)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DbError::edit(format!("begin failed: {e}")))?;
    let mut applied = super::edit::AppliedEdits::default();
    for stmt in &plan.deletes {
        applied.deleted += bind(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| DbError::edit(format!("delete failed: {e}")))?
            .rows_affected();
    }
    for stmt in &plan.updates {
        applied.updated += bind(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| DbError::edit(format!("update failed: {e}")))?
            .rows_affected();
    }
    for stmt in &plan.inserts {
        applied.inserted += bind(stmt)
            .execute(&mut *tx)
            .await
            .map_err(|e| DbError::edit(format!("insert failed: {e}")))?
            .rows_affected();
    }
    tx.commit()
        .await
        .map_err(|e| DbError::edit(format!("commit failed: {e}")))?;
    Ok(applied)
}

/// Bind a statement's JSON params by inferred storage class (SQLite is dynamically
/// typed, so text/int/real/null all bind cleanly).
fn bind(
    stmt: &super::edit::Statement,
) -> sqlx::query::Query<'_, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
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
) -> sqlx::query::Query<'_, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
    bind_json(sqlx::query(super::audited_sql(&query.sql)), &query.params)
}

fn bind_json<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>,
    params: &'q [serde_json::Value],
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
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
