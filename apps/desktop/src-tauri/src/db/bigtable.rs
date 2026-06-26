//! Google Cloud Bigtable database adapter via the GCP REST API.

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::time::SystemTime;

use super::{ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, RowSet};

pub struct BigtableConn {
    client: Client,
    project_id: String,
    instance_id: String,
    access_token: String,
}

#[derive(Deserialize)]
struct GcpServiceAccountKey {
    project_id: String,
    client_email: String,
    private_key: String,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<BigtableConn, String> {
    let client = Client::new();
    let password = profile.password.clone().unwrap_or_default();

    // 1. Resolve GCP Auth and Project/Instance IDs
    let (project_id, access_token) =
        if password.trim().starts_with('{') && password.trim().ends_with('}') {
            let key: GcpServiceAccountKey = serde_json::from_str(&password)
                .map_err(|e| format!("Invalid Google Service Account JSON: {e}"))?;
            let token = fetch_oauth2_token(&client, &key.client_email, &key.private_key).await?;
            (key.project_id, token)
        } else {
            let project = profile.host.clone().unwrap_or_default();
            if project.is_empty() {
                return Err("GCP Project ID must be specified in the Host field".into());
            }
            (project, password)
        };

    let instance_id = profile.database.clone().unwrap_or_default();
    if instance_id.is_empty() {
        return Err("Bigtable Instance ID must be specified in the Database field".into());
    }

    Ok(BigtableConn {
        client,
        project_id,
        instance_id,
        access_token,
    })
}

pub async fn version(_conn: &BigtableConn) -> Option<String> {
    Some("Google Cloud Bigtable v2 API".to_string())
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ReadRowsResponse {
    chunks: Option<Vec<CellChunk>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CellChunk {
    row_key: Option<String>,
    family_name: Option<FamilyNameWrapper>,
    qualifier: Option<String>,
    timestamp_micros: Option<String>,
    value: Option<String>,
    value_size: Option<i32>,
    commit_row: Option<bool>,
    reset_row: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
enum FamilyNameWrapper {
    String(String),
    Object { value: String },
}

struct TempRow {
    row_key: String,
    cells: HashMap<String, String>,
}

pub async fn run_query(conn: &BigtableConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    let sql_trimmed = sql.trim();
    let mut table_id = sql_trimmed.to_string();
    let mut user_payload = json!({});

    // Parse query: if table name is followed by JSON payload, split them
    if let Some(pos) = sql_trimmed.find('{') {
        let left = sql_trimmed[..pos].trim();
        let right = &sql_trimmed[pos..];
        if !left.is_empty() {
            table_id = left.to_string();
        }
        if let Ok(parsed_json) = serde_json::from_str::<Value>(right) {
            user_payload = parsed_json;
        }
    } else {
        // SQL-like parse: "SELECT * FROM table_name [LIMIT 50]" or just "table_name"
        let lower = sql_trimmed.to_lowercase();
        if let Some(from_pos) = lower.find("from ") {
            let after_from = sql_trimmed[from_pos + 5..].trim();
            let table_end = after_from
                .find(|c: char| c.is_whitespace() || c == ';')
                .unwrap_or(after_from.len());
            table_id = after_from[..table_end].to_string();
        }
    }

    if table_id.is_empty() {
        return Err("Could not extract table ID from query".into());
    }

    let url = format!(
        "https://bigtable.googleapis.com/v2/projects/{}/instances/{}/tables/{}:readRows",
        conn.project_id, conn.instance_id, table_id
    );

    // Merge default rows_limit unless already specified in the user JSON payload
    let mut payload = user_payload.as_object().cloned().unwrap_or_default();
    if !payload.contains_key("rowsLimit") && !payload.contains_key("rows_limit") {
        payload.insert("rowsLimit".to_string(), json!(cap));
    }

    let res = conn
        .client
        .post(&url)
        .bearer_auth(&conn.access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Bigtable query request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "Bigtable query failed with HTTP {status}: {err_text}"
        ));
    }

    let responses: Vec<ReadRowsResponse> = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Bigtable response: {e}"))?;

    // State machine to parse CellChunks into rows
    let mut temp_row: Option<TempRow> = None;
    let mut current_family = String::new();
    let mut current_qualifier = String::new();
    let mut current_timestamp = String::new();
    let mut current_value = Vec::<u8>::new();

    let mut committed_rows = Vec::new();
    let mut all_columns_set = BTreeSet::new();

    for response in responses {
        if let Some(chunks) = response.chunks {
            for chunk in chunks {
                if let Some(ref rk) = chunk.row_key {
                    let decoded_rk = base64_decode(rk)
                        .and_then(|bytes| String::from_utf8(bytes).map_err(|e| e.to_string()))
                        .unwrap_or_else(|_| rk.clone());
                    temp_row = Some(TempRow {
                        row_key: decoded_rk,
                        cells: HashMap::new(),
                    });
                }
                if let Some(fm) = chunk.family_name {
                    current_family = match fm {
                        FamilyNameWrapper::String(s) => s,
                        FamilyNameWrapper::Object { value } => value,
                    };
                }
                if let Some(ref q) = chunk.qualifier {
                    current_qualifier = base64_decode(q)
                        .and_then(|bytes| String::from_utf8(bytes).map_err(|e| e.to_string()))
                        .unwrap_or_else(|_| q.clone());
                }
                if let Some(ref ts) = chunk.timestamp_micros {
                    current_timestamp = ts.clone();
                }
                if let Some(ref val) = chunk.value {
                    if let Ok(decoded_val) = base64_decode(val) {
                        current_value.extend(decoded_val);
                    }
                }
                let val_size = chunk.value_size.unwrap_or(0);
                if val_size == 0 {
                    let cell_key = if current_timestamp.is_empty() {
                        format!("{}:{}", current_family, current_qualifier)
                    } else {
                        format!(
                            "{}:{}@{}",
                            current_family, current_qualifier, current_timestamp
                        )
                    };
                    let cell_str = String::from_utf8(current_value.clone())
                        .unwrap_or_else(|_| format!("0x{}", hex_encode(&current_value)));
                    current_value.clear();
                    current_timestamp.clear();

                    if let Some(ref mut row) = temp_row {
                        row.cells.insert(cell_key.clone(), cell_str);
                        all_columns_set.insert(cell_key);
                    }
                }

                if chunk.commit_row.unwrap_or(false) {
                    if let Some(row) = temp_row.take() {
                        committed_rows.push(row);
                    }
                }
                if chunk.reset_row.unwrap_or(false) {
                    temp_row = None;
                    current_value.clear();
                    current_timestamp.clear();
                }
            }
        }
    }

    let mut columns = vec!["row_key".to_string()];
    columns.extend(all_columns_set.into_iter());

    let mut rows = Vec::new();
    let mut truncated = false;

    for row in committed_rows {
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let mut row_values = Vec::new();
        // First cell is the row key
        row_values.push(Value::String(row.row_key));
        // Other cells match the columns union list
        for col in &columns[1..] {
            let cell_val = row
                .cells
                .get(col)
                .cloned()
                .map(Value::String)
                .unwrap_or(Value::Null);
            row_values.push(cell_val);
        }
        rows.push(row_values);
    }

    Ok((columns, rows, truncated))
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct TableListResponse {
    tables: Option<Vec<AdminTable>>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct AdminTable {
    name: String,
    column_families: Option<HashMap<String, Value>>,
}

pub async fn metadata(conn: &BigtableConn) -> Result<DatabaseMetadata, String> {
    let url = format!(
        "https://bigtableadmin.googleapis.com/v2/projects/{}/instances/{}/tables",
        conn.project_id, conn.instance_id
    );

    let res = conn
        .client
        .get(&url)
        .bearer_auth(&conn.access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to list Bigtable tables: {e}"))?;

    if !res.status().is_success() {
        return Ok(DatabaseMetadata {
            schemas: Vec::new(),
        });
    }

    let val: TableListResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Bigtable Admin response: {e}"))?;

    let mut builder = super::meta::MetaBuilder::default();
    let schema_name = conn.instance_id.clone();
    builder.ensure_schema(schema_name.clone());

    if let Some(tables) = val.tables {
        for table in tables {
            let table_id = table
                .name
                .split('/')
                .last()
                .unwrap_or(&table.name)
                .to_string();

            builder.add_object(
                schema_name.clone(),
                table_id.clone(),
                DbObjectMetadataKind::Table,
            );

            if let Some(obj) = builder.object_mut(&schema_name, &table_id) {
                // Add row_key as the primary column descriptor
                obj.columns.push(ColumnMetadata {
                    name: "row_key".to_string(),
                    data_type: "bytes".to_string(),
                    nullable: false,
                    ordinal: 1,
                    default_value: None,
                    comment: Some("Row Key".to_string()),
                });

                // Add listed Column Families
                if let Some(families) = table.column_families {
                    let mut ordinal = 2;
                    for (fam, _) in families {
                        obj.columns.push(ColumnMetadata {
                            name: format!("{}:*", fam),
                            data_type: "Column Family".to_string(),
                            nullable: true,
                            ordinal,
                            default_value: None,
                            comment: None,
                        });
                        ordinal += 1;
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
        r#"{{"iss":"{}","scope":"https://www.googleapis.com/auth/cloud-platform","aud":"https://oauth2.googleapis.com/token","exp":{},"iat":{}}}"#,
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

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut val = 0u32;
    let mut valb = -8;
    for c in input.chars() {
        if c == '=' {
            break;
        }
        let tbl = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let tbl_url = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let d = if let Some(p) = tbl.iter().position(|&x| x == c as u8) {
            p as u32
        } else if let Some(p) = tbl_url.iter().position(|&x| x == c as u8) {
            p as u32
        } else {
            continue;
        };
        val = (val << 6) | d;
        valb += 6;
        if valb >= 0 {
            out.push(((val >> valb) & 0xFF) as u8);
            valb -= 8;
        }
    }
    Ok(out)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
