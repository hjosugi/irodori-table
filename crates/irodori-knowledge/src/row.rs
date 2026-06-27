//! Content hashing and SQLite row -> model mapping helpers.

use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::model::{SnapshotRecord, SnapshotSearchHit, SourceRecord};
use crate::Result;

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

pub(crate) fn bool_to_int(value: bool) -> i64 {
    i64::from(value)
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

pub(crate) fn source_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SourceRecord> {
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

pub(crate) fn snapshot_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SnapshotRecord> {
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

pub(crate) fn search_hit_from_row(row: sqlx::sqlite::SqliteRow) -> Result<SnapshotSearchHit> {
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
