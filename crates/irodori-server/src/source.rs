//! SVR-002 — the data-source abstraction the API serves, plus a built-in SQLite
//! source so the server runs standalone. The desktop can provide its own
//! [`DataSource`] backed by the live connection registry to expose the same
//! adapter/proxy/security model.
//!
//! The SQLite source uses synchronous `rusqlite` on `spawn_blocking`: it owns the
//! statement string, so it avoids the `'static`/`Send` borrow constraints that
//! async SQLite drivers impose inside an `async_trait` (Send) future.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use rusqlite::types::Value as SqliteValue;
use rusqlite::Connection;
use serde_json::Value;

use crate::model::{ObjectInfo, ObjectKind, QueryResultDto};

/// A backend failure, mapped to an HTTP status by the server.
#[derive(Debug)]
pub enum DataError {
    NotFound(String),
    Backend(String),
}

impl std::fmt::Display for DataError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DataError::NotFound(m) => write!(f, "{m}"),
            DataError::Backend(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for DataError {}

/// A queryable source the API exposes. Implementations decide their own engine,
/// connectivity, and write policy.
#[async_trait]
pub trait DataSource: Send + Sync {
    fn engine(&self) -> &str;
    fn read_only(&self) -> bool;
    async fn list_objects(&self) -> Result<Vec<ObjectInfo>, DataError>;
    /// Execute `sql`, returning at most `max_rows` rows (one extra row, if present,
    /// sets `truncated`). Read-only enforcement happens before this is called.
    async fn run_query(&self, sql: &str, max_rows: u32) -> Result<QueryResultDto, DataError>;
}

/// The set of sources the API serves, keyed by id.
#[derive(Default, Clone)]
pub struct Registry {
    sources: BTreeMap<String, Arc<dyn DataSource>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(mut self, id: impl Into<String>, source: Arc<dyn DataSource>) -> Self {
        self.sources.insert(id.into(), source);
        self
    }

    pub fn insert(&mut self, id: impl Into<String>, source: Arc<dyn DataSource>) {
        self.sources.insert(id.into(), source);
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn DataSource>> {
        self.sources.get(id).cloned()
    }

    pub fn ids(&self) -> Vec<String> {
        self.sources.keys().cloned().collect()
    }
}

/// A SQLite-backed [`DataSource`] (the standalone default).
pub struct SqliteDataSource {
    conn: Arc<Mutex<Connection>>,
    read_only: bool,
}

impl SqliteDataSource {
    /// Open a SQLite database. `:memory:` (or an empty path) opens an in-memory db.
    pub fn open(path: &str, read_only: bool) -> Result<Self, DataError> {
        let conn = if path.is_empty() || path == ":memory:" {
            Connection::open_in_memory()
        } else {
            Connection::open(path)
        }
        .map_err(backend)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            read_only,
        })
    }
}

#[async_trait]
impl DataSource for SqliteDataSource {
    fn engine(&self) -> &str {
        "sqlite"
    }

    fn read_only(&self) -> bool {
        self.read_only
    }

    async fn list_objects(&self) -> Result<Vec<ObjectInfo>, DataError> {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || list_objects_blocking(&conn))
            .await
            .map_err(|e| DataError::Backend(format!("task failed: {e}")))?
    }

    async fn run_query(&self, sql: &str, max_rows: u32) -> Result<QueryResultDto, DataError> {
        let conn = Arc::clone(&self.conn);
        let sql = sql.to_owned();
        let cap = max_rows.max(1) as usize;
        tokio::task::spawn_blocking(move || run_query_blocking(&conn, &sql, cap))
            .await
            .map_err(|e| DataError::Backend(format!("task failed: {e}")))?
    }
}

fn list_objects_blocking(conn: &Mutex<Connection>) -> Result<Vec<ObjectInfo>, DataError> {
    let conn = conn.lock().map_err(|_| DataError::Backend("connection lock poisoned".into()))?;
    let mut stmt = conn
        .prepare(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .map_err(backend)?;
    let objects = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let kind: String = row.get(1)?;
            Ok(ObjectInfo {
                name,
                kind: if kind.eq_ignore_ascii_case("view") {
                    ObjectKind::View
                } else {
                    ObjectKind::Table
                },
            })
        })
        .map_err(backend)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(backend)?;
    Ok(objects)
}

fn run_query_blocking(
    conn: &Mutex<Connection>,
    sql: &str,
    cap: usize,
) -> Result<QueryResultDto, DataError> {
    let started = Instant::now();
    let conn = conn.lock().map_err(|_| DataError::Backend("connection lock poisoned".into()))?;
    let mut stmt = conn.prepare(sql).map_err(backend)?;
    let columns: Vec<String> = stmt
        .column_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect();
    let column_count = columns.len();

    let mut query_rows = stmt.query([]).map_err(backend)?;
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut truncated = false;
    while let Some(row) = query_rows.next().map_err(backend)? {
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        let mut record = Vec::with_capacity(column_count);
        for i in 0..column_count {
            let value: SqliteValue = row.get(i).map_err(backend)?;
            record.push(sqlite_value_to_json(value));
        }
        rows.push(record);
    }

    Ok(QueryResultDto {
        row_count: rows.len() as u64,
        columns,
        rows,
        elapsed_ms: started.elapsed().as_millis() as u64,
        truncated,
    })
}

fn sqlite_value_to_json(value: SqliteValue) -> Value {
    match value {
        SqliteValue::Null => Value::Null,
        SqliteValue::Integer(i) => Value::from(i),
        SqliteValue::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        SqliteValue::Text(s) => Value::String(s),
        SqliteValue::Blob(b) => Value::String(to_hex(&b)),
    }
}

fn backend(error: rusqlite::Error) -> DataError {
    DataError::Backend(error.to_string())
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut s = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(s, "{byte:02x}");
    }
    s
}
