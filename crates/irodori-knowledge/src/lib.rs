//! Local knowledge-base storage and source snapshot primitives.

/// JOB-002 — disk-backed, job-driven inverted index builder.
pub mod index;
pub mod model;
mod row;
pub mod store;

pub use model::{SnapshotInput, SnapshotRecord, SnapshotSearchHit, SourceInput, SourceRecord};
pub use row::snapshot_hash;
pub use store::KnowledgeStore;

pub const CRATE_NAME: &str = "irodori-knowledge";
pub const SCHEMA_SQL: &str = include_str!("../../../knowledge/schema.sql");

pub type Result<T> = std::result::Result<T, sqlx::Error>;
