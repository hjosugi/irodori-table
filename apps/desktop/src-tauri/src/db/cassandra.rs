//! Cassandra and ScyllaDB database adapter.

use scylla::client::session::Session;
use scylla::client::session_builder::SessionBuilder;
use scylla::value::{CqlValue, Row};
use serde_json::Value as JValue;

use super::{ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, RowSet};

pub struct CassandraConn {
    session: Session,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<CassandraConn, String> {
    let host = profile.host.clone().unwrap_or_else(|| "127.0.0.1".into());
    let port = profile.port.unwrap_or(9042);
    let user = profile.user.clone();
    let password = profile.password.clone();
    let keyspace = profile.database.clone().unwrap_or_else(|| "system".into());

    let mut builder = SessionBuilder::new().known_node(format!("{host}:{port}"));
    if let (Some(u), Some(p)) = (user, password) {
        builder = builder.user(u, p);
    }
    let session = builder
        .build()
        .await
        .map_err(|e| format!("Failed to connect to Cassandra: {e}"))?;

    if keyspace != "system" && !keyspace.is_empty() {
        session
            .use_keyspace(&keyspace, false)
            .await
            .map_err(|e| format!("Failed to select keyspace {keyspace}: {e}"))?;
    }

    Ok(CassandraConn { session })
}

pub async fn version(conn: &CassandraConn) -> Option<String> {
    let res = conn
        .session
        .query_unpaged("SELECT release_version FROM system.local", &[])
        .await
        .ok()?;

    if let Ok(rows_result) = res.into_rows_result() {
        if let Ok(mut rows) = rows_result.rows::<Row>() {
            if let Some(Ok(row_obj)) = rows.next() {
                if let Some(Some(val)) = row_obj.columns.first() {
                    return Some(format!("Cassandra {}", format_cell_value(val)));
                }
            }
        }
    }
    Some("Cassandra".to_string())
}

pub async fn run_query(conn: &CassandraConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    let res = conn
        .session
        .query_unpaged(sql, &[])
        .await
        .map_err(|e| format!("Cassandra query failed: {e}"))?;

    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut truncated = false;

    if res.is_rows() {
        let rows_result = res.into_rows_result().map_err(|e| e.to_string())?;
        for col in rows_result.column_specs().iter() {
            columns.push(col.name().to_string());
        }

        let res_rows = rows_result.rows::<Row>().map_err(|e| e.to_string())?;
        for row in res_rows {
            if rows.len() >= cap {
                truncated = true;
                break;
            }
            let row_obj = row.map_err(|e| e.to_string())?;
            let mut row_values = Vec::new();
            for col_val in &row_obj.columns {
                match col_val {
                    Some(v) => row_values.push(format_cell_value(v)),
                    None => row_values.push(JValue::Null),
                }
            }
            rows.push(row_values);
        }
    }

    Ok((columns, rows, truncated))
}

pub async fn metadata(conn: &CassandraConn) -> Result<DatabaseMetadata, String> {
    let query = "SELECT keyspace_name, table_name, column_name, type \
                 FROM system_schema.columns";

    let res = conn
        .session
        .query_unpaged(query, &[])
        .await
        .map_err(|e| format!("Failed to fetch columns metadata: {e}"))?;

    let mut builder = super::meta::MetaBuilder::default();

    if res.is_rows() {
        let rows_result = res.into_rows_result().map_err(|e| e.to_string())?;
        let res_rows = rows_result.rows::<Row>().map_err(|e| e.to_string())?;
        for row in res_rows {
            let row_obj = row.map_err(|e| e.to_string())?;
            let keyspace = row_obj
                .columns
                .get(0)
                .and_then(|v| v.as_ref().map(|v| get_string_value(v)))
                .unwrap_or_default();
            let table = row_obj
                .columns
                .get(1)
                .and_then(|v| v.as_ref().map(|v| get_string_value(v)))
                .unwrap_or_default();
            let column = row_obj
                .columns
                .get(2)
                .and_then(|v| v.as_ref().map(|v| get_string_value(v)))
                .unwrap_or_default();
            let data_type = row_obj
                .columns
                .get(3)
                .and_then(|v| v.as_ref().map(|v| get_string_value(v)))
                .unwrap_or_else(|| "text".to_string());

            if keyspace.is_empty() || table.is_empty() || column.is_empty() {
                continue;
            }

            builder.add_object(keyspace.clone(), table.clone(), DbObjectMetadataKind::Table);
            if let Some(obj) = builder.object_mut(&keyspace, &table) {
                let ordinal = obj.columns.len() as i32 + 1;
                obj.columns.push(ColumnMetadata {
                    name: column,
                    data_type,
                    nullable: true,
                    ordinal,
                    default_value: None,
                    comment: None,
                });
            }
        }
    }

    Ok(builder.finish())
}

fn format_cell_value(val: &CqlValue) -> JValue {
    match val {
        CqlValue::Ascii(s) | CqlValue::Text(s) => JValue::String(s.clone()),
        CqlValue::Int(i) => JValue::Number((*i).into()),
        CqlValue::BigInt(i) => JValue::Number((*i).into()),
        CqlValue::Boolean(b) => JValue::Bool(*b),
        CqlValue::Double(d) => serde_json::Number::from_f64(*d)
            .map(JValue::Number)
            .unwrap_or_else(|| JValue::String(d.to_string())),
        CqlValue::Float(f) => serde_json::Number::from_f64(*f as f64)
            .map(JValue::Number)
            .unwrap_or_else(|| JValue::String(f.to_string())),
        _ => JValue::String(format!("{val:?}")),
    }
}

fn get_string_value(val: &CqlValue) -> String {
    match val {
        CqlValue::Ascii(s) | CqlValue::Text(s) => s.clone(),
        CqlValue::Int(i) => i.to_string(),
        CqlValue::BigInt(i) => i.to_string(),
        CqlValue::Boolean(b) => b.to_string(),
        _ => format!("{val:?}"),
    }
}
