//! Oracle via the pure-Rust thin `oracle-rs` driver — **no Oracle Instant Client**,
//! the way A5:SQL Mk-2's "direct connection" mode works.
//!
//! Everything Oracle-specific is confined to this one module, so swapping the
//! driver (or forking the permissive `oracle-rs` to harden it) later touches only
//! this file. The connection is wrapped in a mutex because one TNS connection is a
//! single session.

use oracle_rs::{Config, Connection as OraConn, Value};
use tokio::sync::Mutex;

use super::{
    hex_encode, ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadata,
    DbObjectMetadataKind, IndexMetadata, RowSet, SchemaMetadata,
};

pub struct OracleHandle {
    conn: Mutex<OraConn>,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<OracleHandle, String> {
    let host = profile.host.clone().unwrap_or_else(|| "localhost".into());
    let port = profile.port.unwrap_or(1521);
    // Oracle's "database" field is the service name (e.g. FREEPDB1).
    let service = profile
        .database
        .clone()
        .unwrap_or_else(|| "FREEPDB1".into());
    let user = profile.user.clone().unwrap_or_default();
    let password = profile.password.clone().unwrap_or_default();

    let config = Config::new(&host, port, &service, &user, &password);
    let conn = OraConn::connect_with_config(config)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    Ok(OracleHandle {
        conn: Mutex::new(conn),
    })
}

pub async fn version(h: &OracleHandle) -> Option<String> {
    let guard = h.conn.lock().await;
    let res = guard
        .query("select banner from v$version where rownum = 1", &[])
        .await
        .ok()?;
    res.rows
        .first()
        .and_then(|r| r.get(0))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
}

pub async fn run_query(h: &OracleHandle, sql: &str, cap: usize) -> Result<RowSet, String> {
    let guard = h.conn.lock().await;
    let res = guard
        .query(sql, &[])
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let columns: Vec<String> = res.columns.iter().map(|c| c.name.clone()).collect();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = res.has_more_rows;
    for row in &res.rows {
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let cells = (0..columns.len())
            .map(|i| value_to_json(row.get(i)))
            .collect();
        rows.push(cells);
    }
    Ok((columns, rows, truncated))
}

pub async fn metadata(h: &OracleHandle) -> Result<DatabaseMetadata, String> {
    let guard = h.conn.lock().await;
    let user_res = guard
        .query("select user from dual", &[])
        .await
        .map_err(|e| format!("metadata user failed: {e}"))?;
    let schema = user_res
        .rows
        .first()
        .and_then(|row| value_string(row.get(0)))
        .unwrap_or_else(|| "USER".into());

    let objects_res = guard
        .query(
            r#"
            select table_name, 'TABLE' as object_type from user_tables
            union all
            select view_name as table_name, 'VIEW' as object_type from user_views
            order by table_name
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("metadata objects failed: {e}"))?;

    let mut objects: Vec<DbObjectMetadata> = objects_res
        .rows
        .iter()
        .filter_map(|row| {
            let name = value_string(row.get(0))?;
            let object_type = value_string(row.get(1)).unwrap_or_default();
            Some(DbObjectMetadata {
                schema: schema.clone(),
                name,
                kind: if object_type == "VIEW" {
                    DbObjectMetadataKind::View
                } else {
                    DbObjectMetadataKind::Table
                },
                columns: Vec::new(),
                indexes: Vec::new(),
                primary_key: Vec::new(),
                foreign_keys: Vec::new(),
            })
        })
        .collect();

    let columns_res = guard
        .query(
            r#"
            select table_name, column_name, data_type, nullable, column_id
            from user_tab_columns
            order by table_name, column_id
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("metadata columns failed: {e}"))?;

    for row in &columns_res.rows {
        let table = value_string(row.get(0)).unwrap_or_default();
        if let Some(object) = objects.iter_mut().find(|object| object.name == table) {
            object.columns.push(ColumnMetadata {
                name: value_string(row.get(1)).unwrap_or_default(),
                data_type: value_string(row.get(2)).unwrap_or_default(),
                nullable: value_string(row.get(3)).as_deref() == Some("Y"),
                ordinal: value_i64(row.get(4)).unwrap_or_default() as i32,
                default_value: None,
            });
        }
    }

    let indexes_res = guard
        .query(
            r#"
            select i.table_name,
                   i.index_name,
                   i.uniqueness,
                   listagg(c.column_name, ',') within group (order by c.column_position) as columns
            from user_indexes i
            join user_ind_columns c on c.index_name = i.index_name
            group by i.table_name, i.index_name, i.uniqueness
            order by i.table_name, i.index_name
            "#,
            &[],
        )
        .await
        .map_err(|e| format!("metadata indexes failed: {e}"))?;

    for row in &indexes_res.rows {
        let table = value_string(row.get(0)).unwrap_or_default();
        if let Some(object) = objects.iter_mut().find(|object| object.name == table) {
            let raw_columns = value_string(row.get(3)).unwrap_or_default();
            object.indexes.push(IndexMetadata {
                name: value_string(row.get(1)).unwrap_or_default(),
                columns: raw_columns
                    .split(',')
                    .filter(|part| !part.is_empty())
                    .map(str::to_string)
                    .collect(),
                unique: value_string(row.get(2)).as_deref() == Some("UNIQUE"),
            });
        }
    }

    Ok(DatabaseMetadata {
        schemas: vec![SchemaMetadata {
            name: schema,
            objects,
        }],
    })
}

/// Decode an Oracle [`Value`] to JSON. Scalars and JSON map directly; high-scale
/// `NUMBER` and dates/timestamps render best-effort for now (precision-safe
/// decimals + ISO temporals are a refinement).
fn value_to_json(v: Option<&Value>) -> serde_json::Value {
    use serde_json::Value as J;
    let Some(v) = v else { return J::Null };
    match v {
        Value::Null => J::Null,
        Value::Boolean(b) => J::Bool(*b),
        Value::Integer(i) => J::from(*i),
        Value::Float(f) => J::from(*f),
        Value::String(s) => J::String(s.clone()),
        Value::Bytes(b) => J::String(format!("\\x{}", hex_encode(b))),
        Value::Json(j) => j.clone(),
        Value::Number(_) => v
            .as_i64()
            .map(J::from)
            .or_else(|| v.as_f64().map(J::from))
            .unwrap_or_else(|| J::String(format!("{v:?}"))),
        other => J::String(format!("{other:?}")),
    }
}

fn value_string(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Integer(i) => Some(i.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Number(n) => Some(format!("{n:?}")),
        other => Some(format!("{other:?}")),
    }
}

fn value_i64(v: Option<&Value>) -> Option<i64> {
    v.and_then(Value::as_i64)
}
