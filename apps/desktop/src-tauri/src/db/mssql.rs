//! Microsoft SQL Server via the pure-Rust `tiberius` TDS driver — no SQL Server
//! client library required.
//!
//! tiberius is single-connection (not a sqlx pool), so we hold one `Client`
//! behind a mutex per connection. Cells decode off the raw `ColumnData` so exact
//! numerics and temporals stay precision-safe end-to-end (DBeaver's
//! `setBigDecimal`/timezone rule): `DECIMAL/NUMERIC/MONEY` render to a
//! scale-preserving string, temporals to ISO 8601 / RFC3339, binary to hex.

use std::collections::BTreeMap;
use std::sync::Arc;

use futures_util::TryStreamExt;
use tiberius::time::chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use tiberius::{AuthMethod, Client, ColumnData, Config, FromSql, QueryItem};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::{
    hex_encode, ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadata,
    DbObjectMetadataKind, IndexMetadata, RowSet, SchemaMetadata,
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
                let cells: Vec<serde_json::Value> = row
                    .cells()
                    .map(|(_, data)| column_data_to_json(data))
                    .collect();
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

/// Decode one cell off the raw `ColumnData` (not lossy `try_get::<f64>`), so each
/// TDS type maps to a precision-safe JSON value the way the sqlx engines do:
/// exact numerics → scale-preserving string, temporals → ISO 8601 / RFC3339,
/// binary → `\x`-prefixed hex, UUID → string. Integers/float/bool/string/xml pass
/// through; NULL (the `None` payload) becomes JSON null.
fn column_data_to_json(data: &ColumnData<'static>) -> serde_json::Value {
    use serde_json::Value;
    match data {
        ColumnData::U8(v) => v.map_or(Value::Null, |x| Value::from(x as i64)),
        ColumnData::I16(v) => v.map_or(Value::Null, |x| Value::from(x as i64)),
        ColumnData::I32(v) => v.map_or(Value::Null, |x| Value::from(x as i64)),
        ColumnData::I64(v) => v.map_or(Value::Null, Value::from),
        ColumnData::F32(v) => v.map_or(Value::Null, |x| Value::from(x as f64)),
        ColumnData::F64(v) => v.map_or(Value::Null, Value::from),
        ColumnData::Bit(v) => v.map_or(Value::Null, Value::Bool),
        ColumnData::String(v) => v
            .as_ref()
            .map_or(Value::Null, |s| Value::String(s.to_string())),
        ColumnData::Guid(v) => v.map_or(Value::Null, |u| Value::String(u.to_string())),
        ColumnData::Binary(v) => v.as_ref().map_or(Value::Null, |b| {
            Value::String(format!("\\x{}", hex_encode(b)))
        }),
        // Exact numerics: keep full precision and display scale as a string instead
        // of round-tripping through f64 (BigDecimal/`setBigDecimal` lesson).
        ColumnData::Numeric(v) => v.map_or(Value::Null, |n| {
            Value::String(numeric_to_string(n.value(), n.scale()))
        }),
        ColumnData::Xml(v) => v
            .as_ref()
            .map_or(Value::Null, |x| Value::String(x.to_string())),
        // Temporals: decode via chrono so the formatting matches the other engines.
        ColumnData::DateTime(_) | ColumnData::SmallDateTime(_) | ColumnData::DateTime2(_) => {
            temporal(data, |d| {
                NaiveDateTime::from_sql(d)
                    .ok()
                    .flatten()
                    .map(|t| t.to_string())
            })
        }
        ColumnData::Date(_) => temporal(data, |d| {
            NaiveDate::from_sql(d).ok().flatten().map(|t| t.to_string())
        }),
        ColumnData::Time(_) => temporal(data, |d| {
            NaiveTime::from_sql(d).ok().flatten().map(|t| t.to_string())
        }),
        ColumnData::DateTimeOffset(_) => temporal(data, |d| {
            DateTime::<FixedOffset>::from_sql(d)
                .ok()
                .flatten()
                .map(|t| t.to_rfc3339())
        }),
    }
}

/// Run a chrono `FromSql` decode and wrap the result as a JSON string (NULL or a
/// decode miss → JSON null), keeping the temporal arms above terse.
fn temporal(
    data: &ColumnData<'static>,
    decode: impl Fn(&ColumnData<'static>) -> Option<String>,
) -> serde_json::Value {
    decode(data).map_or(serde_json::Value::Null, serde_json::Value::String)
}

/// Render a TDS `Numeric` (an `i128` mantissa with a base-10 `scale`) as an exact
/// decimal string, preserving sign and trailing zeros so display scale survives
/// (e.g. `value = 100, scale = 2` → `"1.00"`).
fn numeric_to_string(value: i128, scale: u8) -> String {
    let scale = scale as usize;
    if scale == 0 {
        return value.to_string();
    }
    let digits = value.unsigned_abs().to_string();
    // Left-pad so there is at least one integer digit before the point.
    let padded = if digits.len() <= scale {
        format!("{}{digits}", "0".repeat(scale + 1 - digits.len()))
    } else {
        digits
    };
    let point = padded.len() - scale;
    let (int_part, frac_part) = padded.split_at(point);
    let sign = if value < 0 { "-" } else { "" };
    format!("{sign}{int_part}.{frac_part}")
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

#[cfg(test)]
mod tests {
    use super::numeric_to_string;

    #[test]
    fn numeric_preserves_scale_sign_and_trailing_zeros() {
        assert_eq!(numeric_to_string(123_456, 2), "1234.56");
        assert_eq!(numeric_to_string(100, 2), "1.00"); // trailing zeros kept
        assert_eq!(numeric_to_string(5, 3), "0.005"); // left-padded fraction
        assert_eq!(numeric_to_string(-50, 2), "-0.50"); // sign + sub-one magnitude
        assert_eq!(numeric_to_string(7, 0), "7"); // scale 0 is the raw integer
    }
}
