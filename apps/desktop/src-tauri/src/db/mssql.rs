//! Microsoft SQL Server via the pure-Rust `tiberius` TDS driver — no SQL Server
//! client library required.
//!
//! tiberius is single-connection (not a sqlx pool), so we hold one `Client`
//! behind a mutex per connection. Decimals currently decode best-effort; keeping
//! them precision-safe end-to-end is a follow-up (DBeaver's `setBigDecimal` rule).

use std::collections::BTreeMap;
use std::sync::Arc;

use futures_util::TryStreamExt;
use tiberius::{AuthMethod, Client, Config, QueryItem};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind,
    IndexMetadata, RowSet, SchemaMetadata,
};

pub type MssqlClient = Client<Compat<TcpStream>>;

pub async fn connect(profile: &ConnectionProfile) -> Result<MssqlClient, String> {
    let config = if let Some(url) = &profile.url {
        Config::from_ado_string(url).map_err(|e| format!("bad connection string: {e}"))?
    } else {
        let mut config = Config::new();
        let host = profile.host.clone().unwrap_or_else(|| "localhost".into());
        config.host(&host);
        config.port(profile.port.unwrap_or(1433));
        config.authentication(AuthMethod::sql_server(
            profile.user.clone().unwrap_or_default(),
            profile.password.clone().unwrap_or_default(),
        ));
        if let Some(db) = &profile.database {
            config.database(db);
        }
        // Dev default: accept the server's self-signed certificate.
        config.trust_cert();
        config
    };

    let tcp = TcpStream::connect(config.get_addr())
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    tcp.set_nodelay(true).ok();
    Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("connect failed: {e}"))
}

pub async fn version(client: &Arc<Mutex<MssqlClient>>) -> Option<String> {
    let mut guard = client.lock().await;
    let stream = guard.query("select @@version", &[]).await.ok()?;
    let row = stream.into_row().await.ok()??;
    let banner: Option<&str> = row.try_get(0).ok()?;
    banner.map(|s| s.lines().next().unwrap_or(s).trim().to_string())
}

pub async fn run_query(
    client: &Arc<Mutex<MssqlClient>>,
    sql: &str,
    cap: usize,
) -> Result<RowSet, String> {
    let mut guard = client.lock().await;
    let mut stream = guard
        .query(sql, &[])
        .await
        .map_err(|e| format!("query failed: {e}"))?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut truncated = false;

    // Drain the full stream (so the connection stays usable) but only keep up to
    // `cap` rows in memory.
    while let Some(item) = stream
        .try_next()
        .await
        .map_err(|e| format!("query failed: {e}"))?
    {
        if let QueryItem::Row(row) = item {
            if columns.is_empty() {
                columns = row.columns().iter().map(|c| c.name().to_string()).collect();
            }
            if rows.len() < cap {
                let mut cells = Vec::with_capacity(row.columns().len());
                for i in 0..row.columns().len() {
                    cells.push(cell_to_json(&row, i));
                }
                rows.push(cells);
            } else {
                truncated = true;
            }
        }
    }
    Ok((columns, rows, truncated))
}

pub async fn metadata(client: &Arc<Mutex<MssqlClient>>) -> Result<DatabaseMetadata, String> {
    let mut guard = client.lock().await;
    let mut schemas: BTreeMap<String, BTreeMap<String, DbObjectMetadata>> = BTreeMap::new();

    let objects_sql = r#"
        select table_schema, table_name, table_type
        from information_schema.tables
        where table_type in ('BASE TABLE', 'VIEW')
          and table_schema not in ('INFORMATION_SCHEMA', 'sys')
        order by table_schema, table_name
    "#;
    {
        let mut stream = guard
            .query(objects_sql, &[])
            .await
            .map_err(|e| format!("metadata objects failed: {e}"))?;
        while let Some(item) = stream
            .try_next()
            .await
            .map_err(|e| format!("metadata objects failed: {e}"))?
        {
            if let QueryItem::Row(row) = item {
                let schema = get_str(&row, 0);
                let name = get_str(&row, 1);
                if name.is_empty() {
                    continue;
                }
                let table_type = get_str(&row, 2);
                let kind = if table_type.eq_ignore_ascii_case("VIEW") {
                    DbObjectMetadataKind::View
                } else {
                    DbObjectMetadataKind::Table
                };
                schemas.entry(schema.clone()).or_default().insert(
                    name.clone(),
                    DbObjectMetadata {
                        schema,
                        name,
                        kind,
                        columns: Vec::new(),
                        indexes: Vec::new(),
                    },
                );
            }
        }
    }

    let columns_sql = r#"
        select table_schema, table_name, column_name, data_type, is_nullable,
               ordinal_position, column_default
        from information_schema.columns
        where table_schema not in ('INFORMATION_SCHEMA', 'sys')
        order by table_schema, table_name, ordinal_position
    "#;
    {
        let mut stream = guard
            .query(columns_sql, &[])
            .await
            .map_err(|e| format!("metadata columns failed: {e}"))?;
        while let Some(item) = stream
            .try_next()
            .await
            .map_err(|e| format!("metadata columns failed: {e}"))?
        {
            if let QueryItem::Row(row) = item {
                let schema = get_str(&row, 0);
                let table = get_str(&row, 1);
                if let Some(object) = schemas.get_mut(&schema).and_then(|s| s.get_mut(&table)) {
                    let nullable = get_str(&row, 4);
                    object.columns.push(ColumnMetadata {
                        name: get_str(&row, 2),
                        data_type: get_str(&row, 3),
                        nullable: nullable.eq_ignore_ascii_case("YES"),
                        ordinal: get_i32(&row, 5),
                        default_value: get_optional_str(&row, 6),
                    });
                }
            }
        }
    }

    let indexes_sql = r#"
        select schema_name(t.schema_id) as schema_name,
               t.name as table_name,
               i.name as index_name,
               i.is_unique,
               string_agg(c.name, ',') within group (order by ic.key_ordinal) as columns
        from sys.indexes i
        join sys.tables t on t.object_id = i.object_id
        join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
        join sys.columns c on c.object_id = ic.object_id and c.column_id = ic.column_id
        where i.name is not null
          and schema_name(t.schema_id) not in ('sys')
          and ic.key_ordinal > 0
        group by schema_name(t.schema_id), t.name, i.name, i.is_unique
        order by schema_name(t.schema_id), t.name, i.name
    "#;
    {
        let mut stream = guard
            .query(indexes_sql, &[])
            .await
            .map_err(|e| format!("metadata indexes failed: {e}"))?;
        while let Some(item) = stream
            .try_next()
            .await
            .map_err(|e| format!("metadata indexes failed: {e}"))?
        {
            if let QueryItem::Row(row) = item {
                let schema = get_str(&row, 0);
                let table = get_str(&row, 1);
                if let Some(object) = schemas.get_mut(&schema).and_then(|s| s.get_mut(&table)) {
                    let raw_columns = get_str(&row, 4);
                    object.indexes.push(IndexMetadata {
                        name: get_str(&row, 2),
                        columns: raw_columns
                            .split(',')
                            .filter(|part| !part.is_empty())
                            .map(str::to_string)
                            .collect(),
                        unique: get_bool(&row, 3),
                    });
                }
            }
        }
    }

    Ok(DatabaseMetadata {
        schemas: schemas
            .into_iter()
            .map(|(name, objects)| SchemaMetadata {
                name,
                objects: objects.into_values().collect(),
            })
            .collect(),
    })
}

fn cell_to_json(row: &tiberius::Row, i: usize) -> serde_json::Value {
    use serde_json::Value;
    // tiberius `try_get` returns Ok(None) for NULL and Err for a type mismatch,
    // so try the supported types in order. MVP coverage: bool/ints/float/string.
    // Decimals come through as float (lossy) and datetimes/binary as null for now
    // — precision-safe decimals + temporals are a follow-up (EXEC-009b).
    if let Ok(Some(v)) = row.try_get::<bool, _>(i) {
        return Value::Bool(v);
    }
    if let Ok(Some(v)) = row.try_get::<i32, _>(i) {
        return Value::from(v as i64);
    }
    if let Ok(Some(v)) = row.try_get::<i64, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<f64, _>(i) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<&str, _>(i) {
        return Value::String(v.to_string());
    }
    Value::Null
}

fn get_str(row: &tiberius::Row, i: usize) -> String {
    get_optional_str(row, i).unwrap_or_default()
}

fn get_optional_str(row: &tiberius::Row, i: usize) -> Option<String> {
    row.try_get::<&str, _>(i).ok().flatten().map(str::to_string)
}

fn get_i32(row: &tiberius::Row, i: usize) -> i32 {
    row.try_get::<i32, _>(i)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<i16, _>(i).ok().flatten().map(i32::from))
        .unwrap_or_default()
}

fn get_bool(row: &tiberius::Row, i: usize) -> bool {
    row.try_get::<bool, _>(i).ok().flatten().unwrap_or(false)
}
