//! Snowflake database adapter via the SQL API / Login Session REST API.

use reqwest::{Client, Url};
use serde_json::{json, Value};

use super::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, ForeignKey, RowSet,
};

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
    let raw_url = profile
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty());
    let parsed_url = raw_url.and_then(|url| Url::parse(url).ok());
    let host_input = profile
        .host
        .as_deref()
        .map(str::trim)
        .filter(|host| !host.is_empty())
        .or_else(|| parsed_url.as_ref().and_then(|url| url.host_str()))
        .unwrap_or("localhost");
    let host = snowflake_api_host(host_input);
    let mut url = match (raw_url, parsed_url.as_ref()) {
        (Some(raw), Some(parsed)) if parsed.scheme() == "http" || parsed.scheme() == "https" => {
            raw.to_string()
        }
        (Some(_), Some(parsed)) if parsed.scheme() == "snowflake" => {
            format!("https://{host}")
        }
        (Some(raw), _) => format!("https://{}", snowflake_api_host(raw)),
        (None, _) => format!("https://{host}"),
    };
    if url.ends_with('/') {
        url.pop();
    }

    let database_input = profile
        .database
        .clone()
        .filter(|database| !database.trim().is_empty())
        .or_else(|| parsed_url.as_ref().and_then(database_from_url_path))
        .unwrap_or_default();
    let (database, schema) = split_database_schema(
        database_input,
        profile
            .options
            .get("schema")
            .cloned()
            .or_else(|| query_value(parsed_url.as_ref(), "schema")),
    );
    let warehouse = profile
        .options
        .get("warehouse")
        .cloned()
        .or_else(|| query_value(parsed_url.as_ref(), "warehouse"));
    let role = profile
        .options
        .get("role")
        .cloned()
        .or_else(|| query_value(parsed_url.as_ref(), "role"));

    let client = Client::new();

    // Determine account name from host (e.g. account.snowflakecomputing.com)
    let account = if let Some(idx) = host.to_lowercase().find(".snowflakecomputing.com") {
        host[..idx].to_string()
    } else {
        host.clone()
    };

    let login_name = profile
        .user
        .clone()
        .filter(|user| !user.trim().is_empty())
        .or_else(|| {
            parsed_url.as_ref().and_then(|url| {
                let username = url.username();
                (!username.is_empty()).then(|| username.to_string())
            })
        })
        .unwrap_or_default();
    let password = profile
        .password
        .clone()
        .filter(|password| !password.is_empty())
        .or_else(|| {
            parsed_url
                .as_ref()
                .and_then(|url| url.password().map(str::to_string))
        })
        .unwrap_or_default();

    // Perform Snowflake session login if password is provided
    let token = if !password.is_empty() {
        let login_url = format!("{url}/api/v1/login-request");
        let payload = json!({
            "data": {
                "CLIENT_APP_ID": "IrodoriTable",
                "CLIENT_APP_VERSION": "0.1.5",
                "ACCOUNT_NAME": account,
                "LOGIN_NAME": login_name,
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
        profile
            .options
            .get("token")
            .cloned()
            .or_else(|| query_value(parsed_url.as_ref(), "token"))
            .unwrap_or_default()
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
    let mut builder = super::meta::MetaBuilder::default();
    let database = sql_string_literal(&conn.database);
    let schema_filter = metadata_schema_filter("TABLE_SCHEMA", conn.schema.as_deref());
    let constraint_schema_filter = metadata_schema_filter("t.TABLE_SCHEMA", conn.schema.as_deref());
    let fk_schema_filter = metadata_schema_filter("fk.TABLE_SCHEMA", conn.schema.as_deref());
    let routine_schema_filter = metadata_schema_filter("PROCEDURE_SCHEMA", conn.schema.as_deref());
    let function_schema_filter = metadata_schema_filter("FUNCTION_SCHEMA", conn.schema.as_deref());

    let object_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, COMMENT, ROW_COUNT, NULL AS VIEW_DEFINITION \
         FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_CATALOG = {database}{schema_filter} \
         UNION ALL \
         SELECT TABLE_SCHEMA, TABLE_NAME, 'VIEW' AS TABLE_TYPE, COMMENT, NULL AS ROW_COUNT, VIEW_DEFINITION \
         FROM INFORMATION_SCHEMA.VIEWS \
         WHERE TABLE_CATALOG = {database}{schema_filter} \
         ORDER BY TABLE_SCHEMA, TABLE_NAME"
    );
    let (object_cols, object_rows, _) = run_query(conn, &object_sql, 5000).await?;
    let schema_idx = object_cols.iter().position(|c| c == "TABLE_SCHEMA");
    let table_idx = object_cols.iter().position(|c| c == "TABLE_NAME");
    let type_idx = object_cols.iter().position(|c| c == "TABLE_TYPE");
    let comment_idx = object_cols.iter().position(|c| c == "COMMENT");
    let rows_idx = object_cols.iter().position(|c| c == "ROW_COUNT");
    let ddl_idx = object_cols.iter().position(|c| c == "VIEW_DEFINITION");

    for row in object_rows {
        let (Some(s_idx), Some(t_idx), Some(ty_idx)) = (schema_idx, table_idx, type_idx) else {
            continue;
        };
        let schema = value_as_string(row.get(s_idx));
        let table = value_as_string(row.get(t_idx));
        if schema.is_empty() || table.is_empty() {
            continue;
        }
        let table_type = value_as_string(row.get(ty_idx));
        let kind = if table_type.eq_ignore_ascii_case("VIEW") {
            DbObjectMetadataKind::View
        } else {
            DbObjectMetadataKind::Table
        };
        builder.add_object(schema.clone(), table.clone(), kind);
        if let Some(object) = builder.object_mut(&schema, &table) {
            object.comment = comment_idx.and_then(|idx| non_empty_string(row.get(idx)));
            object.row_estimate = rows_idx
                .and_then(|idx| value_as_u64(row.get(idx)))
                .filter(|value| *value > 0);
            if kind == DbObjectMetadataKind::View {
                object.ddl =
                    ddl_idx
                        .and_then(|idx| non_empty_string(row.get(idx)))
                        .map(|definition| {
                            format!(
                                "CREATE VIEW {}.{} AS\n{}",
                                quote_ident(&schema),
                                quote_ident(&table),
                                definition
                            )
                        });
            }
        }
    }

    let routine_sql = format!(
        "SELECT PROCEDURE_SCHEMA AS ROUTINE_SCHEMA, PROCEDURE_NAME AS ROUTINE_NAME, 'PROCEDURE' AS ROUTINE_TYPE \
         FROM INFORMATION_SCHEMA.PROCEDURES \
         WHERE PROCEDURE_CATALOG = {database}{routine_schema_filter} \
         UNION ALL \
         SELECT FUNCTION_SCHEMA AS ROUTINE_SCHEMA, FUNCTION_NAME AS ROUTINE_NAME, 'FUNCTION' AS ROUTINE_TYPE \
         FROM INFORMATION_SCHEMA.FUNCTIONS \
         WHERE FUNCTION_CATALOG = {database}{function_schema_filter} \
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME"
    );
    if let Ok((routine_cols, routine_rows, _)) = run_query(conn, &routine_sql, 5000).await {
        let schema_idx = routine_cols.iter().position(|c| c == "ROUTINE_SCHEMA");
        let name_idx = routine_cols.iter().position(|c| c == "ROUTINE_NAME");
        let type_idx = routine_cols.iter().position(|c| c == "ROUTINE_TYPE");
        for row in routine_rows {
            let (Some(s_idx), Some(n_idx), Some(t_idx)) = (schema_idx, name_idx, type_idx) else {
                continue;
            };
            let schema = value_as_string(row.get(s_idx));
            let name = value_as_string(row.get(n_idx));
            let routine_type = value_as_string(row.get(t_idx));
            let kind = if routine_type.eq_ignore_ascii_case("FUNCTION") {
                DbObjectMetadataKind::Function
            } else {
                DbObjectMetadataKind::Procedure
            };
            builder.add_object(schema, name, kind);
        }
    }

    let column_sql = format!(
        "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION, \
                IS_NULLABLE, COLUMN_DEFAULT, COMMENT \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_CATALOG = {database}{schema_filter} \
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    );

    let (cols, rows, _) = run_query(conn, &column_sql, 10000).await?;
    let schema_idx = cols.iter().position(|c| c == "TABLE_SCHEMA");
    let table_idx = cols.iter().position(|c| c == "TABLE_NAME");
    let col_name_idx = cols.iter().position(|c| c == "COLUMN_NAME");
    let data_type_idx = cols.iter().position(|c| c == "DATA_TYPE");
    let ord_idx = cols.iter().position(|c| c == "ORDINAL_POSITION");
    let nullable_idx = cols.iter().position(|c| c == "IS_NULLABLE");
    let default_idx = cols.iter().position(|c| c == "COLUMN_DEFAULT");
    let comment_idx = cols.iter().position(|c| c == "COMMENT");

    if let (Some(s_idx), Some(t_idx), Some(c_idx), Some(d_idx), Some(o_idx)) =
        (schema_idx, table_idx, col_name_idx, data_type_idx, ord_idx)
    {
        for row in rows {
            let schema = value_as_string(row.get(s_idx));
            let table = value_as_string(row.get(t_idx));
            let column = value_as_string(row.get(c_idx));
            let data_type = value_as_string(row.get(d_idx));
            let ordinal = value_as_i32(row.get(o_idx)).unwrap_or(1);

            if schema.is_empty() || table.is_empty() || column.is_empty() {
                continue;
            }

            if builder.object_mut(&schema, &table).is_none() {
                builder.add_object(schema.clone(), table.clone(), DbObjectMetadataKind::Table);
            }
            if let Some(obj) = builder.object_mut(&schema, &table) {
                let nullable = nullable_idx
                    .map(|idx| value_as_string(row.get(idx)))
                    .unwrap_or_default();
                obj.columns.push(ColumnMetadata {
                    name: column,
                    data_type,
                    nullable: nullable.eq_ignore_ascii_case("YES"),
                    ordinal,
                    default_value: default_idx.and_then(|idx| non_empty_string(row.get(idx))),
                    comment: comment_idx.and_then(|idx| non_empty_string(row.get(idx))),
                });
            }
        }
    }

    let pk_sql = format!(
        "SELECT k.TABLE_SCHEMA, k.TABLE_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION \
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t \
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k \
           ON k.CONSTRAINT_CATALOG = t.CONSTRAINT_CATALOG \
          AND k.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA \
          AND k.CONSTRAINT_NAME = t.CONSTRAINT_NAME \
         WHERE t.TABLE_CATALOG = {database}{constraint_schema_filter} \
           AND t.CONSTRAINT_TYPE = 'PRIMARY KEY' \
         ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.ORDINAL_POSITION"
    );
    if let Ok((pk_cols, pk_rows, _)) = run_query(conn, &pk_sql, 5000).await {
        let schema_idx = pk_cols.iter().position(|c| c == "TABLE_SCHEMA");
        let table_idx = pk_cols.iter().position(|c| c == "TABLE_NAME");
        let column_idx = pk_cols.iter().position(|c| c == "COLUMN_NAME");
        for row in pk_rows {
            let (Some(s_idx), Some(t_idx), Some(c_idx)) = (schema_idx, table_idx, column_idx)
            else {
                continue;
            };
            let schema = value_as_string(row.get(s_idx));
            let table = value_as_string(row.get(t_idx));
            let column = value_as_string(row.get(c_idx));
            if let Some(object) = builder.object_mut(&schema, &table) {
                object.primary_key.push(column);
            }
        }
    }

    let fk_sql = format!(
        "SELECT fk.TABLE_SCHEMA, fk.TABLE_NAME, fk.COLUMN_NAME, \
                pk.TABLE_SCHEMA AS REFERENCED_SCHEMA, pk.TABLE_NAME AS REFERENCED_TABLE, \
                pk.COLUMN_NAME AS REFERENCED_COLUMN, fk.ORDINAL_POSITION \
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE fk \
         JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc \
           ON rc.CONSTRAINT_CATALOG = fk.CONSTRAINT_CATALOG \
          AND rc.CONSTRAINT_SCHEMA = fk.CONSTRAINT_SCHEMA \
          AND rc.CONSTRAINT_NAME = fk.CONSTRAINT_NAME \
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE pk \
           ON pk.CONSTRAINT_CATALOG = rc.UNIQUE_CONSTRAINT_CATALOG \
          AND pk.CONSTRAINT_SCHEMA = rc.UNIQUE_CONSTRAINT_SCHEMA \
          AND pk.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME \
          AND pk.ORDINAL_POSITION = fk.POSITION_IN_UNIQUE_CONSTRAINT \
         WHERE fk.CONSTRAINT_CATALOG = {database}{fk_schema_filter} \
         ORDER BY fk.TABLE_SCHEMA, fk.TABLE_NAME, fk.CONSTRAINT_NAME, fk.ORDINAL_POSITION"
    );
    if let Ok((fk_cols, fk_rows, _)) = run_query(conn, &fk_sql, 5000).await {
        attach_foreign_keys(&mut builder, &fk_cols, fk_rows);
    }

    Ok(builder.finish())
}

fn split_database_schema(
    database_input: String,
    explicit_schema: Option<String>,
) -> (String, Option<String>) {
    let mut database = database_input.trim().to_string();
    let mut schema = explicit_schema.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    });

    if schema.is_none() {
        let current = database.clone();
        if let Some((db, sc)) = current.split_once('/') {
            database = db.trim().to_string();
            let trimmed = sc.trim();
            if !trimmed.is_empty() {
                schema = Some(trimmed.to_string());
            }
        } else if let Some((db, sc)) = current.split_once('.') {
            database = db.trim().to_string();
            let trimmed = sc.trim();
            if !trimmed.is_empty() {
                schema = Some(trimmed.to_string());
            }
        }
    }

    (database, schema)
}

fn snowflake_api_host(input: &str) -> String {
    let trimmed = input
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    let lower = trimmed.to_lowercase();
    if lower.contains("snowflakecomputing.com")
        || lower.starts_with("localhost")
        || lower.starts_with("127.")
    {
        trimmed.to_string()
    } else {
        format!("{trimmed}.snowflakecomputing.com")
    }
}

fn database_from_url_path(url: &Url) -> Option<String> {
    let parts: Vec<_> = url
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .take(2)
        .collect();
    match parts.as_slice() {
        [] => None,
        [database] => Some((*database).to_string()),
        [database, schema] => Some(format!("{database}/{schema}")),
        _ => None,
    }
}

fn query_value(url: Option<&Url>, key: &str) -> Option<String> {
    url?.query_pairs()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.trim().is_empty())
}

fn metadata_schema_filter(column: &str, schema: Option<&str>) -> String {
    schema
        .map(str::trim)
        .filter(|schema| !schema.is_empty())
        .map(|schema| format!(" AND {column} = {}", sql_string_literal(schema)))
        .unwrap_or_default()
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn value_as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    let value = value_as_string(value);
    (!value.is_empty()).then_some(value)
}

fn value_as_i32(value: Option<&Value>) -> Option<i32> {
    match value {
        Some(Value::Number(value)) => value.as_i64().map(|value| value as i32),
        Some(Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

fn value_as_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(value)) => value.as_u64(),
        Some(Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn attach_foreign_keys(
    builder: &mut super::meta::MetaBuilder,
    cols: &[String],
    rows: Vec<Vec<Value>>,
) {
    let schema_idx = cols.iter().position(|c| c == "TABLE_SCHEMA");
    let table_idx = cols.iter().position(|c| c == "TABLE_NAME");
    let column_idx = cols.iter().position(|c| c == "COLUMN_NAME");
    let ref_schema_idx = cols.iter().position(|c| c == "REFERENCED_SCHEMA");
    let ref_table_idx = cols.iter().position(|c| c == "REFERENCED_TABLE");
    let ref_column_idx = cols.iter().position(|c| c == "REFERENCED_COLUMN");

    for row in rows {
        let (Some(s_idx), Some(t_idx), Some(c_idx), Some(rs_idx), Some(rt_idx), Some(rc_idx)) = (
            schema_idx,
            table_idx,
            column_idx,
            ref_schema_idx,
            ref_table_idx,
            ref_column_idx,
        ) else {
            continue;
        };
        let schema = value_as_string(row.get(s_idx));
        let table = value_as_string(row.get(t_idx));
        let column = value_as_string(row.get(c_idx));
        let references_schema = value_as_string(row.get(rs_idx));
        let references_table = value_as_string(row.get(rt_idx));
        let references_column = value_as_string(row.get(rc_idx));
        if let Some(object) = builder.object_mut(&schema, &table) {
            if let Some(last) = object.foreign_keys.last_mut() {
                if last.references_schema.as_deref() == Some(references_schema.as_str())
                    && last.references_table == references_table
                {
                    last.columns.push(column);
                    last.references_columns.push(references_column);
                    continue;
                }
            }
            object.foreign_keys.push(ForeignKey {
                columns: vec![column],
                references_schema: Some(references_schema),
                references_table,
                references_columns: vec![references_column],
            });
        }
    }
}
