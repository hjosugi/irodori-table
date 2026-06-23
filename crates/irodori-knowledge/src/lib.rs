//! Local knowledge-base storage and source snapshot primitives.

use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};

pub const CRATE_NAME: &str = "irodori-knowledge";
pub const SCHEMA_SQL: &str = include_str!("../../../knowledge/schema.sql");

pub type Result<T> = std::result::Result<T, sqlx::Error>;

#[derive(Clone)]
pub struct KnowledgeStore {
    pool: SqlitePool,
}

impl KnowledgeStore {
    /// Open or create a knowledge database at `path`, then apply the tracked
    /// schema. This mirrors `tools/knowledge/refresh.mjs`, keeping Rust and Node
    /// initialization on the same SQL source.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path.as_ref())
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        let store = Self { pool };
        store.apply_schema().await?;
        Ok(store)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn apply_schema(&self) -> Result<()> {
        sqlx::raw_sql(SCHEMA_SQL).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn upsert_source(&self, source: &SourceInput) -> Result<()> {
        sqlx::query(
            r#"
            insert into sources (
              id, name, product, category, source_type, url, official, cadence, enabled, notes, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
            on conflict(id) do update set
              name = excluded.name,
              product = excluded.product,
              category = excluded.category,
              source_type = excluded.source_type,
              url = excluded.url,
              official = excluded.official,
              cadence = excluded.cadence,
              enabled = excluded.enabled,
              notes = excluded.notes,
              updated_at = current_timestamp
            "#,
        )
        .bind(&source.id)
        .bind(&source.name)
        .bind(&source.product)
        .bind(&source.category)
        .bind(&source.source_type)
        .bind(&source.url)
        .bind(bool_to_int(source.official))
        .bind(&source.cadence)
        .bind(bool_to_int(source.enabled))
        .bind(&source.notes)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_sources(&self) -> Result<Vec<SourceRecord>> {
        let rows = sqlx::query(
            r#"
            select id, name, product, category, source_type, url, official, cadence, enabled,
                   notes, last_checked_at, last_changed_at, last_hash, created_at, updated_at
            from sources
            order by product, id
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(source_from_row).collect()
    }

    pub async fn insert_snapshot(&self, snapshot: &SnapshotInput) -> Result<i64> {
        let content_hash = snapshot
            .content_hash
            .clone()
            .unwrap_or_else(|| snapshot_hash(&snapshot.url, &snapshot.raw_text));

        if let Some(row) =
            sqlx::query("select id from source_snapshots where source_id = ? and content_hash = ?")
                .bind(&snapshot.source_id)
                .bind(&content_hash)
                .fetch_optional(&self.pool)
                .await?
        {
            return row.try_get("id");
        }

        let result = sqlx::query(
            r#"
            insert into source_snapshots (
              source_id, fetched_at, http_status, content_hash, title, url, raw_text, metadata_json
            ) values (?, coalesce(?, current_timestamp), ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&snapshot.source_id)
        .bind(&snapshot.fetched_at)
        .bind(snapshot.http_status)
        .bind(&content_hash)
        .bind(&snapshot.title)
        .bind(&snapshot.url)
        .bind(&snapshot.raw_text)
        .bind(&snapshot.metadata_json)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn get_snapshot(&self, id: i64) -> Result<Option<SnapshotRecord>> {
        let row = sqlx::query(
            r#"
            select id, source_id, fetched_at, http_status, content_hash, title, url, raw_text, metadata_json
            from source_snapshots
            where id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(snapshot_from_row).transpose()
    }

    pub async fn latest_snapshot(&self, source_id: &str) -> Result<Option<SnapshotRecord>> {
        let row = sqlx::query(
            r#"
            select id, source_id, fetched_at, http_status, content_hash, title, url, raw_text, metadata_json
            from source_snapshots
            where source_id = ?
            order by fetched_at desc, id desc
            limit 1
            "#,
        )
        .bind(source_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(snapshot_from_row).transpose()
    }

    pub async fn search_snapshots(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SnapshotSearchHit>> {
        let rows = sqlx::query(
            r#"
            select ss.id, ss.source_id, s.product, s.name as source_name, ss.title, ss.url,
                   snippet(source_snapshots_fts, 1, '[', ']', ' ... ', 18) as snippet
            from source_snapshots_fts
            join source_snapshots ss on ss.id = source_snapshots_fts.rowid
            join sources s on s.id = ss.source_id
            where source_snapshots_fts match ?
            order by rank
            limit ?
            "#,
        )
        .bind(query)
        .bind(limit.clamp(1, 1_000) as i64)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(search_hit_from_row).collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceInput {
    pub id: String,
    pub name: String,
    pub product: String,
    pub category: String,
    pub source_type: String,
    pub url: String,
    pub official: bool,
    pub cadence: String,
    pub enabled: bool,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRecord {
    pub id: String,
    pub name: String,
    pub product: String,
    pub category: String,
    pub source_type: String,
    pub url: String,
    pub official: bool,
    pub cadence: String,
    pub enabled: bool,
    pub notes: String,
    pub last_checked_at: Option<String>,
    pub last_changed_at: Option<String>,
    pub last_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotInput {
    pub source_id: String,
    pub fetched_at: Option<String>,
    pub http_status: Option<i64>,
    pub content_hash: Option<String>,
    pub title: Option<String>,
    pub url: String,
    pub raw_text: String,
    pub metadata_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotRecord {
    pub id: i64,
    pub source_id: String,
    pub fetched_at: String,
    pub http_status: Option<i64>,
    pub content_hash: String,
    pub title: Option<String>,
    pub url: String,
    pub raw_text: String,
    pub metadata_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotSearchHit {
    pub id: i64,
    pub source_id: String,
    pub product: String,
    pub source_name: String,
    pub title: Option<String>,
    pub url: String,
    pub snippet: String,
}

pub fn snapshot_hash(url: &str, raw_text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hasher.update(b"\n");
    hasher.update(raw_text.as_bytes());
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn bool_to_int(value: bool) -> i64 {
    i64::from(value)
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

fn source_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SourceRecord> {
    Ok(SourceRecord {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        product: row.try_get("product")?,
        category: row.try_get("category")?,
        source_type: row.try_get("source_type")?,
        url: row.try_get("url")?,
        official: int_to_bool(row.try_get("official")?),
        cadence: row.try_get("cadence")?,
        enabled: int_to_bool(row.try_get("enabled")?),
        notes: row.try_get("notes")?,
        last_checked_at: row.try_get("last_checked_at")?,
        last_changed_at: row.try_get("last_changed_at")?,
        last_hash: row.try_get("last_hash")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn snapshot_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SnapshotRecord> {
    Ok(SnapshotRecord {
        id: row.try_get("id")?,
        source_id: row.try_get("source_id")?,
        fetched_at: row.try_get("fetched_at")?,
        http_status: row.try_get("http_status")?,
        content_hash: row.try_get("content_hash")?,
        title: row.try_get("title")?,
        url: row.try_get("url")?,
        raw_text: row.try_get("raw_text")?,
        metadata_json: row.try_get("metadata_json")?,
    })
}

fn search_hit_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SnapshotSearchHit> {
    Ok(SnapshotSearchHit {
        id: row.try_get("id")?,
        source_id: row.try_get("source_id")?,
        product: row.try_get("product")?,
        source_name: row.try_get("source_name")?,
        title: row.try_get("title")?,
        url: row.try_get("url")?,
        snippet: row.try_get("snippet")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn sqlite_store_round_trips_sources_snapshots_and_search() {
        let store = KnowledgeStore::open(temp_db_path("roundtrip"))
            .await
            .expect("open store");

        let source = SourceInput {
            id: "postgres-docs-current".into(),
            name: "PostgreSQL current documentation".into(),
            product: "PostgreSQL".into(),
            category: "database".into(),
            source_type: "spec".into(),
            url: "https://www.postgresql.org/docs/current/".into(),
            official: true,
            cadence: "weekly".into(),
            enabled: true,
            notes: "Reference for SQL syntax and catalogs.".into(),
        };
        store.upsert_source(&source).await.expect("upsert source");

        let sources = store.list_sources().await.expect("list sources");
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, source.id);
        assert!(sources[0].official);
        assert!(sources[0].enabled);

        let snapshot = SnapshotInput {
            source_id: source.id.clone(),
            fetched_at: Some("2026-06-23T00:00:00Z".into()),
            http_status: Some(200),
            content_hash: None,
            title: Some("ALTER TABLE".into()),
            url: source.url.clone(),
            raw_text: "ALTER TABLE changes table definitions and constraints.".into(),
            metadata_json: r#"{"contentType":"text/html"}"#.into(),
        };
        let id = store
            .insert_snapshot(&snapshot)
            .await
            .expect("insert snapshot");
        let duplicate_id = store
            .insert_snapshot(&snapshot)
            .await
            .expect("dedupe snapshot");
        assert_eq!(id, duplicate_id);

        let stored = store
            .get_snapshot(id)
            .await
            .expect("get snapshot")
            .expect("snapshot exists");
        assert_eq!(stored.source_id, source.id);
        assert_eq!(stored.http_status, Some(200));
        assert_eq!(
            stored.content_hash,
            snapshot_hash(&snapshot.url, &snapshot.raw_text)
        );

        let latest = store
            .latest_snapshot(&source.id)
            .await
            .expect("latest snapshot")
            .expect("latest exists");
        assert_eq!(latest.id, id);

        let hits = store
            .search_snapshots("ALTER", 10)
            .await
            .expect("search snapshots");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, id);
        assert_eq!(hits[0].product, "PostgreSQL");
        assert!(hits[0].snippet.contains("[ALTER]"));
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let mut path = std::env::temp_dir();
        path.push(format!(
            "irodori_knowledge_{name}_{}_{}.sqlite",
            std::process::id(),
            nonce
        ));
        let _ = std::fs::remove_file(&path);
        path
    }
}
