//! BigQuery database adapter via the Google Cloud REST API.

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    gcp_auth, ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbError, DbObjectMetadataKind,
    DbResult, RowSet,
};

/// OAuth scope requested for service-account tokens (BigQuery jobs + data).
const OAUTH_SCOPE: &str = "https://www.googleapis.com/auth/bigquery";

pub struct BigQueryConn {
    client: Client,
    project_id: String,
    access_token: String,
}

#[derive(Deserialize)]
struct GcpServiceAccountKey {
    project_id: String,
    client_email: String,
    private_key: String,
}

pub async fn connect(profile: &ConnectionProfile) -> DbResult<BigQueryConn> {
    let client = Client::new();
    let password = profile.password.clone().unwrap_or_default();

    // 1. Resolve GCP Auth and Project ID
    let (project_id, access_token) = if password.trim().starts_with('{')
        && password.trim().ends_with('}')
    {
        // Parse Service Account JSON key
        let key: GcpServiceAccountKey = serde_json::from_str(&password).map_err(|e| {
            DbError::connection(format!("Invalid Google Service Account JSON: {e}"))
        })?;

        let token =
            gcp_auth::fetch_oauth2_token(&client, &key.client_email, &key.private_key, OAUTH_SCOPE)
                .await?;
        (key.project_id, token)
    } else {
        // Direct OAuth Access Token
        let project = profile
            .database
            .clone()
            .or_else(|| profile.host.clone())
            .unwrap_or_default();
        if project.is_empty() {
            return Err(DbError::connection(
                "GCP Project ID must be specified (set database or host to Project ID)",
            ));
        }
        (project, password)
    };

    Ok(BigQueryConn {
        client,
        project_id,
        access_token,
    })
}

pub async fn version(_conn: &BigQueryConn) -> Option<String> {
    Some("Google BigQuery v2 API".to_string())
}

pub async fn run_query(conn: &BigQueryConn, sql: &str, cap: usize) -> DbResult<RowSet> {
    let url = format!(
        "https://bigquery.googleapis.com/bigquery/v2/projects/{}/queries",
        conn.project_id
    );

    let payload = json!({
        "query": sql,
        "useLegacySql": false,
        "maxResults": cap
    });

    let res = conn
        .client
        .post(&url)
        .bearer_auth(&conn.access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| DbError::query(format!("BigQuery query request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(DbError::query(format!(
            "BigQuery query failed with HTTP {status}: {err_text}"
        )));
    }

    let val: Value = res
        .json()
        .await
        .map_err(|e| DbError::query(format!("Failed to parse BigQuery response: {e}")))?;

    if let Some(err) = val
        .get("errors")
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
    {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown BigQuery error");
        return Err(DbError::query(msg.to_string()));
    }

    let mut columns = Vec::new();
    if let Some(fields) = val
        .get("schema")
        .and_then(|s| s.get("fields"))
        .and_then(|f| f.as_array())
    {
        for f in fields {
            if let Some(name) = f.get("name").and_then(|n| n.as_str()) {
                columns.push(name.to_string());
            }
        }
    }

    let mut rows = Vec::new();
    let mut truncated = false;
    if let Some(rowset) = val.get("rows").and_then(|r| r.as_array()) {
        for row_val in rowset {
            if rows.len() >= cap {
                truncated = true;
                break;
            }
            let mut row_values = Vec::new();
            if let Some(f_arr) = row_val.get("f").and_then(|f| f.as_array()) {
                for cell in f_arr {
                    row_values.push(cell.get("v").cloned().unwrap_or(Value::Null));
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

pub async fn metadata(conn: &BigQueryConn) -> DbResult<DatabaseMetadata> {
    // 1. List all Datasets in the project
    let datasets_url = format!(
        "https://bigquery.googleapis.com/bigquery/v2/projects/{}/datasets",
        conn.project_id
    );

    let res = conn
        .client
        .get(&datasets_url)
        .bearer_auth(&conn.access_token)
        .send()
        .await
        .map_err(|e| DbError::metadata(format!("Failed to list BigQuery datasets: {e}")))?;

    if !res.status().is_success() {
        return Ok(DatabaseMetadata {
            schemas: Vec::new(),
        });
    }

    let val: Value = res.json().await.unwrap_or(Value::Null);
    let mut datasets = Vec::new();
    if let Some(arr) = val.get("datasets").and_then(|d| d.as_array()) {
        for dataset in arr {
            if let Some(d_id) = dataset
                .get("datasetReference")
                .and_then(|r| r.get("datasetId"))
                .and_then(|i| i.as_str())
            {
                datasets.push(d_id.to_string());
            }
        }
    }

    let mut builder = super::meta::MetaBuilder::default();

    // 2. Query INFORMATION_SCHEMA.COLUMNS for each dataset (free system query)
    for dataset in datasets {
        builder.ensure_schema(dataset.clone());
        let sql = format!(
            "SELECT table_name, column_name, data_type, ordinal_position \
             FROM `{}`.INFORMATION_SCHEMA.COLUMNS \
             ORDER BY table_name, ordinal_position",
            dataset
        );

        if let Ok((cols, rows, _)) = run_query(conn, &sql, 5000).await {
            let table_idx = cols.iter().position(|c| c == "table_name");
            let column_idx = cols.iter().position(|c| c == "column_name");
            let type_idx = cols.iter().position(|c| c == "data_type");
            let ord_idx = cols.iter().position(|c| c == "ordinal_position");

            if let (Some(t_idx), Some(c_idx), Some(ty_idx), Some(o_idx)) =
                (table_idx, column_idx, type_idx, ord_idx)
            {
                for row in rows {
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
                        .get(ty_idx)
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let ordinal = row
                        .get(o_idx)
                        .and_then(|v| v.as_str().and_then(|s| s.parse::<i32>().ok()))
                        .or_else(|| row.get(o_idx).and_then(|v| v.as_i64().map(|i| i as i32)))
                        .unwrap_or(1);

                    if table.is_empty() || column.is_empty() {
                        continue;
                    }

                    builder.add_object(dataset.clone(), table.clone(), DbObjectMetadataKind::Table);
                    if let Some(obj) = builder.object_mut(&dataset, &table) {
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
        }
    }

    Ok(builder.finish())
}
