//! Google Cloud Bigtable database adapter via the GCP REST API.

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};

use super::{
    gcp_auth, ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbError, DbObjectMetadataKind,
    DbResult, RowSet,
};

/// OAuth scope requested for service-account tokens. The Bigtable Admin API
/// (table listing) needs more than the data scope, so `cloud-platform` it is.
const OAUTH_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";

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

pub async fn connect(profile: &ConnectionProfile) -> DbResult<BigtableConn> {
    let client = Client::new();
    let password = profile.password.clone().unwrap_or_default();

    // 1. Resolve GCP Auth and Project/Instance IDs
    let (project_id, access_token) = if password.trim().starts_with('{')
        && password.trim().ends_with('}')
    {
        let key: GcpServiceAccountKey = serde_json::from_str(&password).map_err(|e| {
            DbError::connection(format!("Invalid Google Service Account JSON: {e}"))
        })?;
        let token =
            gcp_auth::fetch_oauth2_token(&client, &key.client_email, &key.private_key, OAUTH_SCOPE)
                .await?;
        (key.project_id, token)
    } else {
        let project = profile.host.clone().unwrap_or_default();
        if project.is_empty() {
            return Err(DbError::connection(
                "GCP Project ID must be specified in the Host field",
            ));
        }
        (project, password)
    };

    let instance_id = profile.database.clone().unwrap_or_default();
    if instance_id.is_empty() {
        return Err(DbError::connection(
            "Bigtable Instance ID must be specified in the Database field",
        ));
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

pub async fn run_query(conn: &BigtableConn, sql: &str, cap: usize) -> DbResult<RowSet> {
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
        return Err(DbError::validation("Could not extract table ID from query"));
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
        .map_err(|e| DbError::query(format!("Bigtable query request failed: {e}")))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(DbError::query(format!(
            "Bigtable query failed with HTTP {status}: {err_text}"
        )));
    }

    let responses: Vec<ReadRowsResponse> = res
        .json()
        .await
        .map_err(|e| DbError::query(format!("Failed to parse Bigtable response: {e}")))?;

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
                        .ok()
                        .and_then(|bytes| String::from_utf8(bytes).ok())
                        .unwrap_or_else(|| rk.clone());
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
                        .ok()
                        .and_then(|bytes| String::from_utf8(bytes).ok())
                        .unwrap_or_else(|| q.clone());
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
    columns.extend(all_columns_set);

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

pub async fn metadata(conn: &BigtableConn) -> DbResult<DatabaseMetadata> {
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
        .map_err(|e| DbError::metadata(format!("Failed to list Bigtable tables: {e}")))?;

    if !res.status().is_success() {
        return Ok(DatabaseMetadata {
            schemas: Vec::new(),
        });
    }

    let val: TableListResponse = res
        .json()
        .await
        .map_err(|e| DbError::metadata(format!("Failed to parse Bigtable Admin response: {e}")))?;

    let mut builder = super::meta::MetaBuilder::default();
    let schema_name = conn.instance_id.clone();
    builder.ensure_schema(schema_name.clone());

    if let Some(tables) = val.tables {
        for table in tables {
            let table_id = table
                .name
                .split('/')
                .next_back()
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

                // Add listed Column Families (row_key already owns ordinal 1)
                if let Some(families) = table.column_families {
                    for (ordinal, (fam, _)) in (2..).zip(families) {
                        obj.columns.push(ColumnMetadata {
                            name: format!("{}:*", fam),
                            data_type: "Column Family".to_string(),
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

fn base64_decode(input: &str) -> DbResult<Vec<u8>> {
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
