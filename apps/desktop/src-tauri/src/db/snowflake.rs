//! Snowflake database adapter via the SQL API / Login Session REST API.

use reqwest::Client;
use serde_json::{json, Value};

use super::{ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, RowSet};

pub struct SnowflakeConn {
    client: Client,
    url: String,
    token: String,
    database: String,
    schema: Option<String>,
    warehouse: Option<String>,
    role: Option<String>,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<SnowflakeConn, String> {
    let host = profile.host.clone().unwrap_or_else(|| "localhost".into());
    let mut url = match &profile.url {
        Some(u) => u.clone(),
        None => format!("https://{host}"),
    };
    if url.ends_with('/') {
        url.pop();
    }

    let database = profile.database.clone().unwrap_or_default();
    let schema = profile.options.get("schema").cloned();
    let warehouse = profile.options.get("warehouse").cloned();
    let role = profile.options.get("role").cloned();

    let client = Client::new();

    // Determine account name from host (e.g. account.snowflakecomputing.com)
    let account = if let Some(idx) = host.to_lowercase().find(".snowflakecomputing.com") {
        host[..idx].to_string()
    } else {
        host.clone()
    };

    let password = profile.password.clone().unwrap_or_default();

    // Perform Snowflake session login if password is provided
    let token = if !password.is_empty() {
        let login_url = format!("{url}/api/v1/login-request");
        let payload = json!({
            "data": {
                "CLIENT_APP_ID": "IrodoriTable",
                "CLIENT_APP_VERSION": "0.1.5",
                "ACCOUNT_NAME": account,
                "LOGIN_NAME": profile.user.clone().unwrap_or_default(),
                "PASSWORD": password
            }
        });

        let res = client
            .post(&login_url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Snowflake login request failed: {e}"))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!(
                "Snowflake login failed with HTTP {status}: {err_text}"
            ));
        }

        let val: Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Snowflake login response: {e}"))?;

        if val
            .get("success")
            .and_then(|s| s.as_bool())
            .unwrap_or(false)
        {
            val.get("data")
                .and_then(|d| d.get("token"))
                .and_then(|t| t.as_str())
                .ok_or_else(|| "Snowflake login succeeded but returned no token".to_string())?
                .to_string()
        } else {
            let msg = val
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            return Err(format!("Snowflake authentication failed: {msg}"));
        }
    } else {
        // Fallback or OAuth/Direct token authentication
        profile.options.get("token").cloned().unwrap_or_default()
    };

    Ok(SnowflakeConn {
        client,
        url,
        token,
        database,
        schema,
        warehouse,
        role,
    })
}

pub async fn version(conn: &SnowflakeConn) -> Option<String> {
    let (_, rows, _) = run_query(conn, "SELECT CURRENT_VERSION()", 1).await.ok()?;
    if let Some(row) = rows.first() {
        if let Some(val) = row.first() {
            if let Some(s) = val.as_str() {
                return Some(format!("Snowflake {s}"));
            }
        }
    }
    Some("Snowflake".to_string())
}

pub async fn run_query(conn: &SnowflakeConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    let query_url = format!("{}/api/v1/query-request", conn.url);

    let mut payload = json!({
        "sqlText": sql,
        "database": conn.database,
    });

    if let Some(schema) = &conn.schema {
        payload
            .as_object_mut()
            .unwrap()
            .insert("schema".to_string(), json!(schema));
    }
    if let Some(wh) = &conn.warehouse {
        payload
            .as_object_mut()
            .unwrap()
            .insert("warehouse".to_string(), json!(wh));
    }
    if let Some(role) = &conn.role {
        payload
            .as_object_mut()
            .unwrap()
            .insert("role".to_string(), json!(role));
    }

    let res = conn
        .client
        .post(&query_url)
        .header(
            "Authorization",
            format!("Snowflake Token=\"{}\"", conn.token),
        )
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "Snowflake query failed with HTTP {status}: {err_text}"
        ));
    }

    let val: Value = res
        .json()
        .await
        .map_err(|e| format!("failed to parse JSON response: {e}"))?;

    if !val
        .get("success")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        let err_text = val
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown query execution error");
        return Err(format!("Snowflake query failed: {err_text}"));
    }

    let data = val
        .get("data")
        .ok_or_else(|| "Missing data field in Snowflake response".to_string())?;

    let mut columns = Vec::new();
    if let Some(rowtype) = data.get("rowtype").and_then(|r| r.as_array()) {
        for rt in rowtype {
            if let Some(name) = rt.get("name").and_then(|n| n.as_str()) {
                columns.push(name.to_string());
            }
        }
    }

    let mut rows = Vec::new();
    let mut truncated = false;
    if let Some(rowset) = data.get("rowset").and_then(|r| r.as_array()) {
        for row_val in rowset {
            if rows.len() >= cap {
                truncated = true;
                break;
            }
            if let Some(arr) = row_val.as_array() {
                rows.push(arr.clone());
            } else {
                let mut fallback = Vec::new();
                for _ in &columns {
                    fallback.push(Value::Null);
                }
                rows.push(fallback);
            }
        }
    }

    Ok((columns, rows, truncated))
}

pub async fn metadata(conn: &SnowflakeConn) -> Result<DatabaseMetadata, String> {
    let sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_CATALOG = '{}' \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
        conn.database.replace('\'', "''")
    );

    let (cols, rows, _) = run_query(conn, &sql, 5000).await?;
    let schema_idx = cols.iter().position(|c| c == "TABLE_SCHEMA");
    let table_idx = cols.iter().position(|c| c == "TABLE_NAME");
    let col_name_idx = cols.iter().position(|c| c == "COLUMN_NAME");
    let data_type_idx = cols.iter().position(|c| c == "DATA_TYPE");
    let ord_idx = cols.iter().position(|c| c == "ORDINAL_POSITION");

    let mut builder = super::meta::MetaBuilder::default();

    if let (Some(s_idx), Some(t_idx), Some(c_idx), Some(d_idx), Some(o_idx)) =
        (schema_idx, table_idx, col_name_idx, data_type_idx, ord_idx)
    {
        for row in rows {
            let schema = row
                .get(s_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let table = row
                .get(t_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let column = row
                .get(c_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let data_type = row
                .get(d_idx)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let ordinal = row
                .get(o_idx)
                .and_then(|v| v.as_str().and_then(|s| s.parse::<i32>().ok()))
                .or_else(|| row.get(o_idx).and_then(|v| v.as_i64().map(|i| i as i32)))
                .unwrap_or(1);

            if schema.is_empty() || table.is_empty() || column.is_empty() {
                continue;
            }

            builder.add_object(schema.clone(), table.clone(), DbObjectMetadataKind::Table);
            if let Some(obj) = builder.object_mut(&schema, &table) {
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
