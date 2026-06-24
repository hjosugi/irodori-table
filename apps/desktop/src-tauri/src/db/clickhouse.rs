//! ClickHouse database adapter via the HTTP interface.

use reqwest::Client;
use serde_json::Value;

use super::{ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, RowSet};

pub struct ClickHouseConn {
    client: Client,
    url: String,
    database: String,
    user: Option<String>,
    password: Option<String>,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<ClickHouseConn, String> {
    let host = profile.host.clone().unwrap_or_else(|| "127.0.0.1".into());
    let port = profile.port.unwrap_or(8123);
    let mut url = match &profile.url {
        Some(u) => u.clone(),
        None => format!("http://{host}:{port}"),
    };
    if url.ends_with('/') {
        url.pop();
    }

    let database = profile.database.clone().unwrap_or_else(|| "default".into());
    let user = profile.user.clone();
    let password = profile.password.clone();

    let client = Client::new();
    Ok(ClickHouseConn {
        client,
        url,
        database,
        user,
        password,
    })
}

pub async fn version(conn: &ClickHouseConn) -> Option<String> {
    let (_, rows, _) = run_query(conn, "SELECT version()", 1).await.ok()?;
    if let Some(row) = rows.first() {
        if let Some(val) = row.first() {
            if let Some(s) = val.as_str() {
                return Some(format!("ClickHouse {s}"));
            }
        }
    }
    Some("ClickHouse".to_string())
}

pub async fn run_query(conn: &ClickHouseConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    // Send query to the ClickHouse HTTP endpoint with default_format=JSON
    let url = format!(
        "{}/?database={}&default_format=JSON",
        conn.url, conn.database
    );

    let mut req = conn.client.post(&url);
    if let (Some(u), Some(p)) = (&conn.user, &conn.password) {
        req = req.basic_auth(u, Some(p));
    }

    let res = req
        .body(sql.to_string())
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("ClickHouse query failed: {err_text}"));
    }

    let text = res
        .text()
        .await
        .map_err(|e| format!("failed to read response: {e}"))?;

    if text.trim().is_empty() {
        return Ok((Vec::new(), Vec::new(), false));
    }

    let val: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok((Vec::new(), Vec::new(), false)), // Probably empty/status response
    };

    let mut columns = Vec::new();
    if let Some(meta) = val.get("meta").and_then(|m| m.as_array()) {
        for m in meta {
            if let Some(name) = m.get("name").and_then(|n| n.as_str()) {
                columns.push(name.to_string());
            }
        }
    }

    let mut rows = Vec::new();
    let mut truncated = false;
    if let Some(data) = val.get("data").and_then(|d| d.as_array()) {
        for row_obj in data {
            if rows.len() >= cap {
                truncated = true;
                break;
            }
            let mut row_values = Vec::new();
            if let Some(obj) = row_obj.as_object() {
                for col in &columns {
                    row_values.push(obj.get(col).cloned().unwrap_or(Value::Null));
                }
            } else {
                for _ in &columns {
                    row_values.push(Value::Null);
                }
            }
            rows.push(row_values);
        }
    }

    Ok((columns, rows, truncated))
}

pub async fn metadata(conn: &ClickHouseConn) -> Result<DatabaseMetadata, String> {
    let sql = format!(
        "SELECT table, name, type FROM system.columns WHERE database = '{}' ORDER BY table, position",
        conn.database.replace('\'', "''")
    );

    let (cols, rows, _) = run_query(conn, &sql, 5000).await?;
    let table_idx = cols.iter().position(|c| c == "table");
    let name_idx = cols.iter().position(|c| c == "name");
    let type_idx = cols.iter().position(|c| c == "type");

    let mut builder = super::meta::MetaBuilder::default();
    builder.ensure_schema(conn.database.clone());

    if let (Some(t_idx), Some(n_idx), Some(ty_idx)) = (table_idx, name_idx, type_idx) {
        for row in rows {
            let table = row
                .get(t_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = row
                .get(n_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let data_type = row
                .get(ty_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if table.is_empty() || name.is_empty() {
                continue;
            }

            builder.add_object(
                conn.database.clone(),
                table.clone(),
                DbObjectMetadataKind::Table,
            );

            if let Some(obj) = builder.object_mut(&conn.database, &table) {
                let ordinal = obj.columns.len() as i32 + 1;
                obj.columns.push(ColumnMetadata {
                    name,
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
