//! BigQuery database adapter via the Google Cloud REST API.

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::SystemTime;

use super::{ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, RowSet};

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

pub async fn connect(profile: &ConnectionProfile) -> Result<BigQueryConn, String> {
    let client = Client::new();
    let password = profile.password.clone().unwrap_or_default();

    // 1. Resolve GCP Auth and Project ID
    let (project_id, access_token) =
        if password.trim().starts_with('{') && password.trim().ends_with('}') {
            // Parse Service Account JSON key
            let key: GcpServiceAccountKey = serde_json::from_str(&password)
                .map_err(|e| format!("Invalid Google Service Account JSON: {e}"))?;

            let token = fetch_oauth2_token(&client, &key.client_email, &key.private_key).await?;
            (key.project_id, token)
        } else {
            // Direct OAuth Access Token
            let project = profile
                .database
                .clone()
                .or_else(|| profile.host.clone())
                .unwrap_or_default();
            if project.is_empty() {
                return Err(
                    "GCP Project ID must be specified (set database or host to Project ID)".into(),
                );
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

pub async fn run_query(conn: &BigQueryConn, sql: &str, cap: usize) -> Result<RowSet, String> {
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
        .map_err(|e| format!("BigQuery query request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "BigQuery query failed with HTTP {status}: {err_text}"
        ));
    }

    let val: Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse BigQuery response: {e}"))?;

    if let Some(err) = val
        .get("errors")
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
    {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown BigQuery error");
        return Err(msg.to_string());
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

pub async fn metadata(conn: &BigQueryConn) -> Result<DatabaseMetadata, String> {
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
        .map_err(|e| format!("Failed to list BigQuery datasets: {e}"))?;

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

// ---- GCP OAuth2 Service Account Token Signing helper ----

async fn fetch_oauth2_token(
    client: &Client,
    email: &str,
    private_key: &str,
) -> Result<String, String> {
    use openssl::hash::MessageDigest;
    use openssl::pkey::PKey;
    use openssl::sign::Signer;

    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let exp = now + 3600;

    let header = r#"{"alg":"RS256","typ":"JWT"}"#;
    let claims = format!(
        r#"{{"iss":"{}","scope":"https://www.googleapis.com/auth/bigquery","aud":"https://oauth2.googleapis.com/token","exp":{},"iat":{}}}"#,
        email, exp, now
    );

    let header_b64 = base64_url_encode(header.as_bytes());
    let claims_b64 = base64_url_encode(claims.as_bytes());
    let payload = format!("{header_b64}.{claims_b64}");

    let pkey = PKey::private_key_from_pem(private_key.as_bytes())
        .map_err(|e| format!("Invalid private key in Google Service Account: {e}"))?;

    let mut signer = Signer::new(MessageDigest::sha256(), &pkey)
        .map_err(|e| format!("Failed to initialize signer: {e}"))?;
    signer
        .update(payload.as_bytes())
        .map_err(|e| format!("Signer failed payload update: {e}"))?;
    let signature = signer
        .sign_to_vec()
        .map_err(|e| format!("Failed to sign JWT assertion: {e}"))?;
    let signature_b64 = base64_url_encode(&signature);

    let assertion = format!("{payload}.{signature_b64}");

    let body = format!(
        "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={}",
        assertion
    );

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("GCP token request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "GCP OAuth token request failed with HTTP {status}: {err_text}"
        ));
    }

    let val: Value = res.json().await.unwrap_or(Value::Null);
    let access_token = val
        .get("access_token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "GCP OAuth token response missing access_token".to_string())?
        .to_string();

    Ok(access_token)
}

fn base64_url_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut i = 0;
    while i < input.len() {
        let b0 = input[i] as usize;
        let b1 = if i + 1 < input.len() {
            input[i + 1] as usize
        } else {
            0
        };
        let b2 = if i + 2 < input.len() {
            input[i + 2] as usize
        } else {
            0
        };

        let enc0 = b0 >> 2;
        let enc1 = ((b0 & 3) << 4) | (b1 >> 4);
        let enc2 = ((b1 & 15) << 2) | (b2 >> 6);
        let enc3 = b2 & 63;

        out.push(CHARS[enc0] as char);
        out.push(CHARS[enc1] as char);
        if i + 1 < input.len() {
            out.push(CHARS[enc2] as char);
        }
        if i + 2 < input.len() {
            out.push(CHARS[enc3] as char);
        }
        i += 3;
    }
    out
}
