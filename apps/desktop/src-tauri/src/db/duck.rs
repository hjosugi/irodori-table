//! Embedded DuckDB (feature `duckdb`). The crate bundles libduckdb (C++), which
//! is a heavy build, so this engine is off by default. DuckDB is synchronous, so
//! queries run on a blocking thread.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use super::{
    hex_encode, ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbEngine, DbObjectMetadata,
    DbObjectMetadataKind, DbQuickSample, RowSet, SchemaMetadata,
};

pub fn connect(profile: &ConnectionProfile) -> Result<duckdb::Connection, String> {
    let path = profile.database.clone().or_else(|| profile.url.clone());
    let conn = match path.as_deref() {
        _ if matches!(profile.engine, DbEngine::MotherDuck) => duckdb::Connection::open_in_memory(),
        None | Some("") | Some(":memory:") => duckdb::Connection::open_in_memory(),
        Some(p) => duckdb::Connection::open(p),
    }
    .map_err(|e| format!("connect failed: {e}"))?;
    Ok(conn)
}

pub fn seed_sample(conn: &duckdb::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        create table if not exists countries (
            id integer primary key,
            iso_code varchar not null,
            name varchar not null
        );
        create table if not exists customers (
            id integer primary key,
            name varchar not null,
            country_id integer,
            lifetime_value bigint not null,
            last_order_at timestamp
        );
        create table if not exists orders (
            id integer primary key,
            customer_id integer not null,
            ordered_at timestamp not null,
            total bigint not null,
            status varchar not null
        );
        create or replace view customer_revenue as
        select c.id, c.name, coalesce(sum(o.total), 0) as total_revenue
        from customers c
        left join orders o on o.customer_id = c.id
        group by c.id, c.name;
        "#,
    )
    .map_err(|e| format!("duckdb sample schema failed: {e}"))?;

    let existing = conn
        .query_row("select count(*) from customers", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0);
    if existing > 0 {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        insert into countries values
            (1, 'JP', 'Japan'),
            (2, 'US', 'United States'),
            (3, 'NL', 'Netherlands');

        insert into customers values
            (233, 'Shiro Systems', 1, 4412200, timestamp '2026-06-18 16:15:00'),
            (447, 'Minato Labs', 1, 5128800, timestamp '2026-06-19 08:03:00'),
            (620, 'Higashi Market', 1, 4889100, timestamp '2026-06-18 19:27:00'),
            (917, 'Northwind Retail', 2, 7720100, timestamp '2026-06-20 11:12:00'),
            (1029, 'Kawase Foods', 1, 9841200, timestamp '2026-06-20 18:34:00'),
            (1104, 'Iris Trading', 3, 3824000, timestamp '2026-06-17 21:06:00'),
            (1441, 'Aster Works', 2, 6533000, timestamp '2026-06-19 23:41:00');

        insert into orders values
            (1, 1029, timestamp '2026-06-20 18:34:00', 9841200, 'paid'),
            (2, 917, timestamp '2026-06-20 11:12:00', 7720100, 'paid'),
            (3, 1441, timestamp '2026-06-19 23:41:00', 6533000, 'paid'),
            (4, 447, timestamp '2026-06-19 08:03:00', 5128800, 'processing'),
            (5, 620, timestamp '2026-06-18 19:27:00', 4889100, 'paid'),
            (6, 233, timestamp '2026-06-18 16:15:00', 4412200, 'paid'),
            (7, 1104, timestamp '2026-06-17 21:06:00', 3824000, 'refunded');
        "#,
    )
    .map_err(|e| format!("duckdb sample data failed: {e}"))?;
    Ok(())
}

pub fn version(conn: &Arc<Mutex<duckdb::Connection>>) -> Option<String> {
    let guard = conn.lock().ok()?;
    guard
        .query_row("select version()", [], |r| r.get::<_, String>(0))
        .ok()
}

pub async fn run_query(
    conn: &Arc<Mutex<duckdb::Connection>>,
    sql: &str,
    cap: usize,
) -> Result<RowSet, String> {
    let conn = conn.clone();
    let sql = sql.to_string();
    tokio::task::spawn_blocking(move || -> Result<RowSet, String> {
        let guard = conn
            .lock()
            .map_err(|_| "duckdb mutex poisoned".to_string())?;

        // Classify the statement (Beekeeper-style): only row-returning statements
        // go through `query`; DDL/DML go through `execute`, which avoids the duckdb
        // crate panicking when it inspects columns on a non-result statement.
        let lead = sql.trim_start().to_ascii_lowercase();
        let is_query = [
            "select", "with", "show", "pragma", "explain", "describe", "values", "table", "call",
        ]
        .iter()
        .any(|kw| lead.starts_with(kw));
        if !is_query {
            guard
                .execute(&sql, [])
                .map_err(|e| format!("query failed: {e}"))?;
            return Ok((Vec::new(), Vec::new(), false));
        }

        let mut stmt = guard
            .prepare(&sql)
            .map_err(|e| format!("query failed: {e}"))?;
        let mut duck_rows = stmt.query([]).map_err(|e| format!("query failed: {e}"))?;
        // DuckDB only materializes the result schema after execution, so read the
        // column names from the executed statement (not the prepared one).
        let columns: Vec<String> = match duck_rows.as_ref() {
            Some(s) => s.column_names().iter().map(|c| c.to_string()).collect(),
            None => Vec::new(),
        };
        let column_count = columns.len();

        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        while let Some(row) = duck_rows.next().map_err(|e| format!("query failed: {e}"))? {
            if rows.len() >= cap {
                truncated = true;
                break;
            }
            let mut cells = Vec::with_capacity(column_count);
            for i in 0..column_count {
                cells.push(cell_to_json(row, i));
            }
            rows.push(cells);
        }
        Ok((columns, rows, truncated))
    })
    .await
    .map_err(|e| format!("duckdb task failed: {e}"))?
}

pub async fn metadata(conn: &Arc<Mutex<duckdb::Connection>>) -> Result<DatabaseMetadata, String> {
    let conn = conn.clone();
    tokio::task::spawn_blocking(move || -> Result<DatabaseMetadata, String> {
        let guard = conn
            .lock()
            .map_err(|_| "duckdb mutex poisoned".to_string())?;

        let mut schemas: BTreeMap<String, BTreeMap<String, DbObjectMetadata>> = BTreeMap::new();
        let mut stmt = guard
            .prepare(
                r#"
                select table_schema, table_name, table_type
                from information_schema.tables
                where table_schema not in ('information_schema', 'pg_catalog')
                order by table_schema, table_name
                "#,
            )
            .map_err(|e| format!("metadata objects failed: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("metadata objects failed: {e}"))?;
        for row in rows {
            let (schema, name, table_type) =
                row.map_err(|e| format!("metadata objects failed: {e}"))?;
            let kind = if table_type.eq_ignore_ascii_case("VIEW") {
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
                    comment: None,
                    ddl: None,
                    row_estimate: None,
                    sample: None,
                    columns: Vec::new(),
                    indexes: Vec::new(),
                    primary_key: Vec::new(),
                    foreign_keys: Vec::new(),
                },
            );
        }

        let mut stmt = guard
            .prepare(
                r#"
                select table_schema, table_name, column_name, data_type,
                       is_nullable, ordinal_position, column_default
                from information_schema.columns
                where table_schema not in ('information_schema', 'pg_catalog')
                order by table_schema, table_name, ordinal_position
                "#,
            )
            .map_err(|e| format!("metadata columns failed: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i32>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| format!("metadata columns failed: {e}"))?;
        for row in rows {
            let (schema, table, name, data_type, nullable, ordinal, default_value) =
                row.map_err(|e| format!("metadata columns failed: {e}"))?;
            if let Some(object) = schemas.get_mut(&schema).and_then(|s| s.get_mut(&table)) {
                object.columns.push(ColumnMetadata {
                    name,
                    data_type,
                    nullable: nullable.eq_ignore_ascii_case("YES"),
                    ordinal,
                    default_value,
                    comment: None,
                });
            }
        }

        for schema in schemas.values_mut() {
            for object in schema.values_mut() {
                object.row_estimate = row_count(&guard, &object.schema, &object.name);
                object.sample = quick_sample(&guard, &object.schema, &object.name, &object.columns);
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
    })
    .await
    .map_err(|e| format!("duckdb task failed: {e}"))?
}

fn row_count(conn: &duckdb::Connection, schema: &str, table: &str) -> Option<u64> {
    let sql = format!("select count(*) from {}", qualified_ident(schema, table));
    let count = conn.query_row(&sql, [], |row| row.get::<_, i64>(0)).ok()?;
    (count >= 0).then_some(count as u64)
}

fn quick_sample(
    conn: &duckdb::Connection,
    schema: &str,
    table: &str,
    columns: &[ColumnMetadata],
) -> Option<DbQuickSample> {
    let sql = format!("select * from {} limit 6", qualified_ident(schema, table));
    let mut stmt = conn.prepare(&sql).ok()?;
    let mut rows = stmt.query([]).ok()?;
    let mut sample_rows = Vec::new();
    let mut truncated = false;
    while let Some(row) = rows.next().ok()? {
        if sample_rows.len() >= 5 {
            truncated = true;
            break;
        }
        sample_rows.push(
            (0..columns.len())
                .map(|index| sample_cell(cell_to_json(row, index)))
                .collect(),
        );
    }
    Some(DbQuickSample {
        columns: columns.iter().map(|column| column.name.clone()).collect(),
        rows: sample_rows,
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

fn cell_to_json(row: &duckdb::Row, i: usize) -> serde_json::Value {
    use duckdb::types::Value as V;
    use serde_json::Value as J;
    match row.get::<usize, V>(i) {
        Ok(V::Null) => J::Null,
        Ok(V::Boolean(b)) => J::Bool(b),
        Ok(V::TinyInt(n)) => J::from(n as i64),
        Ok(V::SmallInt(n)) => J::from(n as i64),
        Ok(V::Int(n)) => J::from(n as i64),
        Ok(V::BigInt(n)) => J::from(n),
        Ok(V::UTinyInt(n)) => J::from(n as u64),
        Ok(V::USmallInt(n)) => J::from(n as u64),
        Ok(V::UInt(n)) => J::from(n as u64),
        Ok(V::UBigInt(n)) => J::from(n),
        Ok(V::Float(f)) => J::from(f as f64),
        Ok(V::Double(f)) => J::from(f),
        Ok(V::Text(s)) => J::String(s),
        Ok(V::Blob(b)) => J::String(format!("\\x{}", hex_encode(&b))),
        // Decimals, timestamps, lists, structs, etc.: keep as their text form.
        Ok(other) => J::String(format!("{other:?}")),
        Err(_) => J::Null,
    }
}
