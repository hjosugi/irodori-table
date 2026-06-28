//! PostgreSQL (and Postgres-wire engines) via a native sqlx pool.

use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, Row, TypeInfo, ValueRef};

use super::meta::MetaBuilder;
use super::{engine::Wire, explain};
use super::{
    hex_encode, ColumnMetadata, DatabaseMetadata, DbEngine, DbObjectMetadata, DbObjectMetadataKind,
    DbQuickSample, IndexMetadata, PreparedQuery, QueryPlanAnalysis, QueryPlanMode, RowSet,
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
    super::stream::collect_capped(
        sqlx::query(super::audited_sql(sql)).fetch(pool),
        cap,
        cell_to_json,
    )
    .await
}

pub async fn run_prepared_query(
    pool: &PgPool,
    query: &PreparedQuery,
    cap: usize,
) -> Result<RowSet, String> {
    super::stream::collect_capped(bind_query(query).fetch(pool), cap, cell_to_json).await
}

pub async fn stream_query(
    pool: &PgPool,
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
    pool: &PgPool,
    query: &PreparedQuery,
    ctx: &super::stream::StreamCtx,
) -> Result<super::stream::StreamSummary, String> {
    super::stream::stream_capped(bind_query(query).fetch(pool), ctx, cell_to_json).await
}

pub async fn explain_query(
    pool: &PgPool,
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
) -> Result<QueryPlanAnalysis, String> {
    let statement = single_explain_statement(sql)?;
    let prefix = match mode {
        QueryPlanMode::Plan => "EXPLAIN (FORMAT JSON)",
        QueryPlanMode::Analyze => "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)",
    };
    let explain_sql = format!("{prefix} {statement}");
    let json = sqlx::query_scalar::<_, serde_json::Value>(super::audited_sql(&explain_sql))
        .fetch_one(pool)
        .await
        .map_err(|e| format!("PostgreSQL explain failed: {e}"))?;
    let raw = serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string());
    Ok(explain::analysis_from_postgres_json(
        wire, &statement, mode, json, raw,
    ))
}

/// Apply result-grid edits in one transaction (rolls back on the first failure).
/// Note: JSON params bind by inferred type; a precision-typed column (decimal/
/// timestamp decoded to a string) or a typed `NULL` may need explicit casts —
/// tracked as a follow-up once column-type metadata is threaded through.
pub async fn apply_edits(
    pool: &PgPool,
    edits: &super::edit::TableEdits,
) -> Result<super::edit::AppliedEdits, String> {
    let plan = super::edit::plan(super::engine::Wire::Postgres, edits)?;
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
) -> sqlx::query::Query<'_, sqlx::Postgres, sqlx::postgres::PgArguments> {
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
) -> sqlx::query::Query<'_, sqlx::Postgres, sqlx::postgres::PgArguments> {
    bind_json(sqlx::query(super::audited_sql(&query.sql)), &query.params)
}

fn bind_json<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    params: &'q [serde_json::Value],
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
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

pub async fn metadata(pool: &PgPool, engine: DbEngine) -> Result<DatabaseMetadata, String> {
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

    if let Ok(detail_rows) = sqlx::query(
        r#"
        select ns.nspname as schema_name,
               cls.relname as object_name,
               obj_description(cls.oid, 'pg_class') as object_comment,
               cls.reltuples::bigint as row_estimate,
               case when cls.relkind = 'v' then pg_get_viewdef(cls.oid, true) else null end as view_definition
        from pg_class cls
        join pg_namespace ns on ns.oid = cls.relnamespace
        where ns.nspname not in ('pg_catalog', 'information_schema')
          and cls.relkind in ('r', 'p', 'v')
        "#,
    )
    .fetch_all(pool)
    .await
    {
        for row in detail_rows {
            let schema: String = row.try_get("schema_name").unwrap_or_default();
            let name: String = row.try_get("object_name").unwrap_or_default();
            if let Some(object) = builder.object_mut(&schema, &name) {
                object.comment = row.try_get::<Option<String>, _>("object_comment").unwrap_or(None);
                let estimate = row.try_get::<i64, _>("row_estimate").unwrap_or(-1);
                if estimate >= 0 {
                    object.row_estimate = Some(estimate as u64);
                }
                if let Some(view_definition) =
                    row.try_get::<Option<String>, _>("view_definition").unwrap_or(None)
                {
                    object.ddl = Some(format!(
                        "create view {} as\n{}",
                        qualified_ident(&schema, &name),
                        view_definition
                    ));
                }
            }
        }
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
                comment: None,
            });
        }
    }

    if let Ok(comment_rows) = sqlx::query(
        r#"
        select ns.nspname as schema_name,
               cls.relname as table_name,
               att.attname as column_name,
               col_description(cls.oid, att.attnum) as column_comment
        from pg_attribute att
        join pg_class cls on cls.oid = att.attrelid
        join pg_namespace ns on ns.oid = cls.relnamespace
        where att.attnum > 0
          and not att.attisdropped
          and ns.nspname not in ('pg_catalog', 'information_schema')
        "#,
    )
    .fetch_all(pool)
    .await
    {
        for row in comment_rows {
            let schema: String = row.try_get("schema_name").unwrap_or_default();
            let table: String = row.try_get("table_name").unwrap_or_default();
            let column_name: String = row.try_get("column_name").unwrap_or_default();
            let comment = row
                .try_get::<Option<String>, _>("column_comment")
                .unwrap_or(None);
            if let (Some(comment), Some(object)) = (comment, builder.object_mut(&schema, &table)) {
                if let Some(column) = object
                    .columns
                    .iter_mut()
                    .find(|column| column.name == column_name)
                {
                    column.comment = Some(comment);
                }
            }
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

    let pk_rows = sqlx::query(
        r#"
        select ns.nspname as schema_name, tbl.relname as table_name,
               array_agg(att.attname order by key_ord.ordinality) as columns
        from pg_constraint con
        join pg_class tbl on tbl.oid = con.conrelid
        join pg_namespace ns on ns.oid = tbl.relnamespace
        left join lateral unnest(con.conkey) with ordinality as key_ord(attnum, ordinality) on true
        left join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_ord.attnum
        where con.contype = 'p' and ns.nspname not in ('pg_catalog', 'information_schema')
        group by ns.nspname, tbl.relname
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata primary keys failed: {e}"))?;
    for row in pk_rows {
        let schema: String = row.try_get("schema_name").unwrap_or_default();
        let table: String = row.try_get("table_name").unwrap_or_default();
        if let Some(object) = builder.object_mut(&schema, &table) {
            object.primary_key = row.try_get("columns").unwrap_or_default();
        }
    }

    let fk_rows = sqlx::query(
        r#"
        select ns.nspname as schema_name, tbl.relname as table_name,
               fns.nspname as ref_schema, ftbl.relname as ref_table,
               array_agg(att.attname order by key_ord.ordinality) as columns,
               array_agg(fatt.attname order by key_ord.ordinality) as ref_columns
        from pg_constraint con
        join pg_class tbl on tbl.oid = con.conrelid
        join pg_namespace ns on ns.oid = tbl.relnamespace
        join pg_class ftbl on ftbl.oid = con.confrelid
        join pg_namespace fns on fns.oid = ftbl.relnamespace
        left join lateral unnest(con.conkey, con.confkey)
          with ordinality as key_ord(attnum, fattnum, ordinality) on true
        left join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key_ord.attnum
        left join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = key_ord.fattnum
        where con.contype = 'f' and ns.nspname not in ('pg_catalog', 'information_schema')
        group by ns.nspname, tbl.relname, fns.nspname, ftbl.relname, con.conname
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("metadata foreign keys failed: {e}"))?;
    for row in fk_rows {
        let schema: String = row.try_get("schema_name").unwrap_or_default();
        let table: String = row.try_get("table_name").unwrap_or_default();
        let ref_schema: String = row.try_get("ref_schema").unwrap_or_default();
        if let Some(object) = builder.object_mut(&schema, &table) {
            object.foreign_keys.push(super::ForeignKey {
                columns: row.try_get("columns").unwrap_or_default(),
                references_schema: Some(ref_schema),
                references_table: row.try_get("ref_table").unwrap_or_default(),
                references_columns: row.try_get("ref_columns").unwrap_or_default(),
            });
        }
    }

    // YugabyteDB and CockroachDB distributed topology queries
    if engine == DbEngine::YugabyteDb {
        if let Ok(_) = sqlx::query("SELECT 1 FROM yb_servers() LIMIT 1")
            .fetch_one(pool)
            .await
        {
            builder.add_object(
                "yb_topology".to_string(),
                "yb_servers".to_string(),
                DbObjectMetadataKind::Table,
            );
            if let Some(obj) = builder.object_mut("yb_topology", "yb_servers") {
                obj.columns = vec![
                    ColumnMetadata {
                        name: "host".into(),
                        data_type: "text".into(),
                        nullable: false,
                        ordinal: 1,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "port".into(),
                        data_type: "integer".into(),
                        nullable: false,
                        ordinal: 2,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "num_connections".into(),
                        data_type: "integer".into(),
                        nullable: true,
                        ordinal: 3,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "node_type".into(),
                        data_type: "text".into(),
                        nullable: true,
                        ordinal: 4,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "cloud".into(),
                        data_type: "text".into(),
                        nullable: true,
                        ordinal: 5,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "region".into(),
                        data_type: "text".into(),
                        nullable: true,
                        ordinal: 6,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "zone".into(),
                        data_type: "text".into(),
                        nullable: true,
                        ordinal: 7,
                        default_value: None,
                        comment: None,
                    },
                ];
            }
        }
    } else if engine == DbEngine::CockroachDb {
        if let Ok(_) = sqlx::query("SELECT 1 FROM crdb_internal.cluster_nodes LIMIT 1")
            .fetch_one(pool)
            .await
        {
            builder.add_object(
                "crdb_topology".to_string(),
                "cluster_nodes".to_string(),
                DbObjectMetadataKind::Table,
            );
            if let Some(obj) = builder.object_mut("crdb_topology", "cluster_nodes") {
                obj.columns = vec![
                    ColumnMetadata {
                        name: "node_id".into(),
                        data_type: "integer".into(),
                        nullable: false,
                        ordinal: 1,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "address".into(),
                        data_type: "text".into(),
                        nullable: false,
                        ordinal: 2,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "sql_address".into(),
                        data_type: "text".into(),
                        nullable: true,
                        ordinal: 3,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "is_live".into(),
                        data_type: "boolean".into(),
                        nullable: false,
                        ordinal: 4,
                        default_value: None,
                        comment: None,
                    },
                    ColumnMetadata {
                        name: "locality".into(),
                        data_type: "text".into(),
                        nullable: true,
                        ordinal: 5,
                        default_value: None,
                        comment: None,
                    },
                ];
            }
        }
    }

    for (schema, table) in builder.object_keys() {
        let (kind, columns) = match builder.object_mut(&schema, &table) {
            Some(object) => (object.kind, object.columns.clone()),
            None => continue,
        };
        if let Some(sample) = quick_sample(pool, &schema, &table, &columns).await {
            if let Some(object) = builder.object_mut(&schema, &table) {
                object.sample = Some(sample);
            }
        }
        if kind == DbObjectMetadataKind::Table {
            if let Some(object) = builder.object_mut(&schema, &table) {
                if object.ddl.is_none() {
                    object.ddl = Some(render_create_table(&schema, object));
                }
            }
        }
    }

    Ok(builder.finish())
}

async fn quick_sample(
    pool: &PgPool,
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

fn render_create_table(schema: &str, object: &DbObjectMetadata) -> String {
    let columns = object
        .columns
        .iter()
        .map(|column| {
            let mut line = format!("  {} {}", quote_ident(&column.name), column.data_type);
            if !column.nullable {
                line.push_str(" not null");
            }
            if let Some(default_value) = &column.default_value {
                line.push_str(" default ");
                line.push_str(default_value);
            }
            line
        })
        .collect::<Vec<_>>()
        .join(",\n");
    format!(
        "create table {} (\n{}\n)",
        qualified_ident(schema, &object.name),
        columns
    )
}

fn qualified_ident(schema: &str, name: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(name))
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn single_explain_statement(sql: &str) -> Result<String, String> {
    let statements = super::split_sql_statements(sql);
    let statements = if statements.is_empty() {
        vec![sql.trim().trim_end_matches(';').trim().to_string()]
    } else {
        statements
    };
    match statements.as_slice() {
        [statement] if !statement.is_empty() => Ok(statement.clone()),
        [] => Err("query is empty".into()),
        _ => Err("Explain Plan supports one statement at a time".into()),
    }
}

fn sample_cell(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::String(value) => value,
        other => other.to_string(),
    }
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
