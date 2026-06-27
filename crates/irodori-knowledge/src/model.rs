//! Knowledge-base data model: sources and their fetched snapshots.

use serde::{Deserialize, Serialize};

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
