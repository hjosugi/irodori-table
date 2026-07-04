//! InfluxDB v3 time-series adapter via direct HTTP REST query API.

use reqwest::Client;
use serde_json::{json, Value};

use super::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbError, DbObjectMetadataKind, DbResult,
    RowSet, SchemaMetadata,
};

pub struct InfluxConn {
    client: Client,
    url: String,
    database: String,
    token: String,
}

pub async fn connect(profile: &ConnectionProfile) -> DbResult<InfluxConn> {
    let host = profile.host.clone().unwrap_or_else(|| "127.0.0.1".into());
    let port = profile.port.unwrap_or(8086);
    let mut url = match &profile.url {
        Some(u) => u.clone(),
        None => format!("http://{host}:{port}"),
    };
    if url.ends_with('/') {
        url.pop();
    }

    let database = profile.database.clone().unwrap_or_else(|| "default".into());
    let token = profile.password.clone().unwrap_or_default();

    let client = Client::new();
    Ok(InfluxConn {
        client,
        url,
        database,
        token,
    })
}

pub async fn version(conn: &InfluxConn) -> Option<String> {
    // InfluxDB /ping endpoint returns 204 or header info
    let res = conn
        .client
        .get(format!("{}/ping", conn.url))
        .header("Authorization", format!("Token {}", conn.token))
        .send()
        .await
        .ok()?;

    let version_header = res
        .headers()
        .get("X-Influxdb-Version")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "3.x".to_string());

    Some(format!("InfluxDB {version_header}"))
}

pub async fn run_query(conn: &InfluxConn, sql: &str, cap: usize) -> DbResult<RowSet> {
    let query_url = format!("{}/api/v3/query?database={}", conn.url, conn.database);
    let payload = json!({
        "query": sql,
        "type": "sql"
    });

    let res = conn
        .client
        .post(&query_url)
        .header("Authorization", format!("Token {}", conn.token))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| DbError::query(format!("HTTP request failed: {e}")))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(DbError::query(format!("InfluxDB query failed: {err_text}")));
    }

    let text = res
        .text()
        .await
        .map_err(|e| DbError::query(format!("failed to read response: {e}")))?;

    let mut rows_json: Vec<Value> = Vec::new();
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        if let Value::Array(arr) = v {
            rows_json = arr;
        } else {
            rows_json.push(v);
        }
    } else {
        // Parse line-by-line JSON (NDJSON)
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                rows_json.push(v);
            }
        }
    }

    let mut columns = Vec::new();
    for row in &rows_json {
        if let Some(obj) = row.as_object() {
            for key in obj.keys() {
                if !columns.contains(key) {
                    columns.push(key.clone());
                }
            }
        }
    }

    let mut rows = Vec::new();
    let mut truncated = false;
    for row in rows_json {
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let mut row_values = Vec::new();
        if let Some(obj) = row.as_object() {
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

    Ok((columns, rows, truncated))
}

pub async fn metadata(conn: &InfluxConn) -> DbResult<DatabaseMetadata> {
    // Introspect schema using InfluxDB's information_schema
    let sql = "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position";
    let (cols, rows, _) = match run_query(conn, sql, 5000).await {
        Ok(res) => res,
        Err(_) => {
            // Fallback for older InfluxDB v3/v2 or if tables/columns schema is different
            return Ok(DatabaseMetadata {
                schemas: vec![SchemaMetadata {
                    name: conn.database.clone(),
                    objects: Vec::new(),
                }],
            });
        }
    };

    let table_name_idx = cols.iter().position(|c| c == "table_name");
    let column_name_idx = cols.iter().position(|c| c == "column_name");
    let data_type_idx = cols.iter().position(|c| c == "data_type");

    let mut builder = super::meta::MetaBuilder::default();

    if let (Some(t_idx), Some(c_idx), Some(d_idx)) =
        (table_name_idx, column_name_idx, data_type_idx)
    {
        for row in rows {
            let table_name = row
                .get(t_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let column_name = row
                .get(c_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let data_type = row
                .get(d_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if table_name.is_empty() || column_name.is_empty() {
                continue;
            }

            builder.add_object(
                conn.database.clone(),
                table_name.clone(),
                DbObjectMetadataKind::Table,
            );
            if let Some(obj) = builder.object_mut(&conn.database, &table_name) {
                let ordinal = obj.columns.len() as i32 + 1;
                obj.columns.push(ColumnMetadata {
                    name: column_name,
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
