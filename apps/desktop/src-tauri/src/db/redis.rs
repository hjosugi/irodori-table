//! Redis key-value store adapter.

use serde_json::Value as JValue;
use tokio::sync::Mutex;

use super::{ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadataKind, RowSet};

pub struct RedisConn {
    conn: Mutex<redis::aio::MultiplexedConnection>,
    db_index: i64,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<RedisConn, String> {
    let host = profile.host.clone().unwrap_or_else(|| "127.0.0.1".into());
    let port = profile.port.unwrap_or(6379);

    let mut url = match &profile.url {
        Some(u) => u.clone(),
        None => {
            let auth = match (&profile.user, &profile.password) {
                (Some(u), Some(p)) if !p.is_empty() => format!("{u}:{p}@"),
                (_, Some(p)) if !p.is_empty() => format!(":{p}@"),
                _ => String::new(),
            };
            format!("redis://{auth}{host}:{port}")
        }
    };

    let db_index = profile
        .database
        .as_ref()
        .and_then(|d| d.parse::<i64>().ok())
        .unwrap_or(0);

    if db_index > 0 {
        if !url.contains("://") {
            url = format!("redis://{url}");
        }
        url = format!("{url}/{db_index}");
    }

    let client = redis::Client::open(url).map_err(|e| e.to_string())?;
    let conn = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| format!("Failed to connect to Redis: {e}"))?;

    Ok(RedisConn {
        conn: Mutex::new(conn),
        db_index,
    })
}

pub async fn version(conn: &RedisConn) -> Option<String> {
    let mut guard = conn.conn.lock().await;
    let info: String = redis::cmd("INFO")
        .arg("server")
        .query_async(&mut *guard)
        .await
        .ok()?;

    for line in info.lines() {
        if line.starts_with("redis_version:") {
            return Some(format!("Redis {}", line["redis_version:".len()..].trim()));
        }
    }
    Some("Redis".into())
}

pub async fn run_query(conn: &RedisConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    let parts = split_args(sql);
    if parts.is_empty() {
        return Err("No command specified".into());
    }

    let cmd = parts[0].to_uppercase();
    let args = &parts[1..];

    let mut guard = conn.conn.lock().await;
    let mut c = redis::cmd(&cmd);
    for arg in args {
        c.arg(arg);
    }

    let val: redis::Value = c
        .query_async(&mut *guard)
        .await
        .map_err(|e| e.to_string())?;

    Ok(map_redis_value_to_rowset(val, cap))
}

pub async fn metadata(conn: &RedisConn) -> Result<DatabaseMetadata, String> {
    let mut guard = conn.conn.lock().await;

    // Scan up to 200 keys
    let scan_res: (u64, Vec<String>) = redis::cmd("SCAN")
        .arg("0")
        .arg("COUNT")
        .arg("200")
        .query_async(&mut *guard)
        .await
        .unwrap_or((0, Vec::new()));

    let mut builder = super::meta::MetaBuilder::default();
    let schema_name = format!("db{}", conn.db_index);
    builder.ensure_schema(schema_name.clone());

    for key in scan_res.1 {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(&mut *guard)
            .await
            .unwrap_or_else(|_| "string".to_string());

        builder.add_object(
            schema_name.clone(),
            key.clone(),
            DbObjectMetadataKind::Table,
        );
        if let Some(obj) = builder.object_mut(&schema_name, &key) {
            obj.columns.push(ColumnMetadata {
                name: "value".to_string(),
                data_type: key_type,
                nullable: true,
                ordinal: 1,
                default_value: None,
                comment: None,
            });
        }
    }

    Ok(builder.finish())
}

fn split_args(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' || ch == '\'' {
            in_quotes = !in_quotes;
        } else if ch.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn map_redis_value_to_rowset(val: redis::Value, cap: usize) -> RowSet {
    match val {
        redis::Value::Nil => (vec!["value".to_string()], vec![vec![JValue::Null]], false),
        redis::Value::Int(i) => (
            vec!["value".to_string()],
            vec![vec![JValue::Number(i.into())]],
            false,
        ),
        redis::Value::BulkString(bytes) => {
            let s = String::from_utf8_lossy(&bytes).into_owned();
            (
                vec!["value".to_string()],
                vec![vec![JValue::String(s)]],
                false,
            )
        }
        redis::Value::Array(items) => {
            let columns = vec!["index".to_string(), "value".to_string()];
            let mut rows = Vec::new();
            let mut truncated = false;
            for (idx, item) in items.into_iter().enumerate() {
                if rows.len() >= cap {
                    truncated = true;
                    break;
                }
                let item_val = match item {
                    redis::Value::Nil => JValue::Null,
                    redis::Value::Int(i) => JValue::Number(i.into()),
                    redis::Value::BulkString(bytes) => {
                        JValue::String(String::from_utf8_lossy(&bytes).into_owned())
                    }
                    _ => JValue::String(format!("{item:?}")),
                };
                rows.push(vec![JValue::Number(idx.into()), item_val]);
            }
            (columns, rows, truncated)
        }
        redis::Value::SimpleString(s) => (
            vec!["status".to_string()],
            vec![vec![JValue::String(s)]],
            false,
        ),
        redis::Value::Okay => (
            vec!["status".to_string()],
            vec![vec![JValue::String("OK".to_string())]],
            false,
        ),
        _ => (
            vec!["value".to_string()],
            vec![vec![JValue::String(format!("{val:?}"))]],
            false,
        ),
    }
}
