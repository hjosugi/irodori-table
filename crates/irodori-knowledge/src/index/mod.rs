//! JOB-002 — huge local index builder.
//!
//! Builds a disk-backed inverted index over an arbitrarily large document corpus
//! without ever holding the whole corpus (or index) in RAM. Documents are pulled
//! lazily from an iterator, tokenized, and accumulated into a bounded in-memory
//! postings buffer that is flushed to SQLite once it crosses a budget — so peak
//! memory stays flat no matter how large the corpus is, the same anti-TablePlus
//! discipline EXEC-010 applies to result rows.
//!
//! The build is driven through the shared [`JobRuntime`] (JOB-001): it reports
//! progress, honors cancellation, and writes a [`JobCheckpoint`] after each
//! committed batch so an interrupted build resumes from the last durable cursor
//! instead of restarting. Re-running over an overlapping corpus is idempotent
//! (`INSERT OR IGNORE` on the document key and the `(term, doc_id)` posting key),
//! which also makes incremental "index the new documents" runs cheap.

use std::path::Path;

use irodori_error::{IrodoriError, IrodoriErrorKind};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};

mod build;
pub use build::{build_index, build_index_with};

/// A corpus document to index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    pub id: String,
    pub source: String,
    pub text: String,
}

impl Document {
    pub fn new(id: impl Into<String>, source: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source: source.into(),
            text: text.into(),
        }
    }
}

/// One posting returned by a term lookup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Posting {
    pub doc_id: String,
    pub frequency: u32,
}

/// Tuning for an index build.
#[derive(Debug, Clone, Copy)]
pub struct IndexBuildConfig {
    /// Flush the in-memory postings buffer to disk once it reaches this many
    /// entries. This is the flat-memory budget: peak RAM is bounded by it.
    pub flush_postings: usize,
    /// Emit a progress update / cancellation check every this many documents.
    pub progress_every_docs: u64,
    /// Persist a resume checkpoint every this many documents (also forces a flush
    /// so the checkpoint cursor never points past durable data).
    pub checkpoint_every_docs: u64,
}

impl Default for IndexBuildConfig {
    fn default() -> Self {
        Self {
            flush_postings: 50_000,
            progress_every_docs: 1_000,
            checkpoint_every_docs: 10_000,
        }
    }
}

/// Outcome of an index build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexBuildReport {
    /// Documents newly written this run (excludes resume-skipped and duplicates).
    pub documents_indexed: u64,
    /// Documents skipped because a checkpoint resumed past them.
    pub documents_skipped: u64,
    /// Posting rows written this run.
    pub postings_written: u64,
    /// Largest the in-memory postings buffer ever grew — the flat-memory witness.
    pub peak_buffer_postings: usize,
    /// Cursor this run resumed from (0 for a fresh build).
    pub resumed_from: u64,
    /// Whether the build stopped early on a cancellation request.
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub throughput_docs_per_sec: u64,
}

/// A disk-backed inverted index. Open once, then build into it and query it.
#[derive(Clone)]
pub struct IndexStore {
    pool: SqlitePool,
}

impl IndexStore {
    /// Open (creating if needed) an index database at `path`. Pass `":memory:"`
    /// for an ephemeral index.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self, IrodoriError> {
        let options = SqliteConnectOptions::new()
            .filename(path.as_ref())
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal);
        Self::open_with(options).await
    }

    /// Open an in-memory index (each connection shares one database).
    pub async fn open_in_memory() -> Result<Self, IrodoriError> {
        // A shared-cache in-memory DB so the single pooled connection is stable.
        let options = SqliteConnectOptions::new()
            .filename(":memory:")
            .create_if_missing(true);
        Self::open_with(options).await
    }

    async fn open_with(options: SqliteConnectOptions) -> Result<Self, IrodoriError> {
        // One writer connection keeps the index build single-threaded and avoids
        // SQLite write-lock contention. `min_connections(1)` pins that connection so
        // an in-memory (`:memory:`) index survives between a build and a later
        // search instead of vanishing when the pool would otherwise close an idle
        // connection.
        let pool = SqlitePoolOptions::new()
            .min_connections(1)
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(internal)?;
        let store = Self { pool };
        store.apply_schema().await?;
        Ok(store)
    }

    async fn apply_schema(&self) -> Result<(), IrodoriError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS index_docs (\
                 doc_id TEXT PRIMARY KEY,\
                 source TEXT NOT NULL,\
                 ord INTEGER NOT NULL\
             )",
        )
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS index_postings (\
                 term TEXT NOT NULL,\
                 doc_id TEXT NOT NULL,\
                 frequency INTEGER NOT NULL,\
                 PRIMARY KEY (term, doc_id)\
             )",
        )
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_postings_term ON index_postings (term)")
            .execute(&self.pool)
            .await
            .map_err(internal)?;
        Ok(())
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Look up a term, returning matching documents ordered by descending
    /// frequency. The term is normalized the same way the indexer tokenizes.
    pub async fn search(&self, term: &str) -> Result<Vec<Posting>, IrodoriError> {
        let normalized = normalize_token(term);
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query(
            "SELECT doc_id, frequency FROM index_postings WHERE term = ? \
             ORDER BY frequency DESC, doc_id ASC",
        )
        .bind(&normalized)
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        rows.into_iter()
            .map(|row| {
                Ok(Posting {
                    doc_id: row.try_get("doc_id").map_err(internal)?,
                    frequency: row.try_get::<i64, _>("frequency").map_err(internal)? as u32,
                })
            })
            .collect()
    }

    pub async fn document_count(&self) -> Result<u64, IrodoriError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM index_docs")
            .fetch_one(&self.pool)
            .await
            .map_err(internal)?;
        Ok(count as u64)
    }

    pub async fn posting_count(&self) -> Result<u64, IrodoriError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM index_postings")
            .fetch_one(&self.pool)
            .await
            .map_err(internal)?;
        Ok(count as u64)
    }
}

/// Tokenize text into `(term, frequency)` pairs. Terms are lowercased ASCII
/// alphanumeric runs; everything else is a separator.
fn tokenize(text: &str) -> Vec<(String, u32)> {
    use std::collections::HashMap;
    let mut counts: HashMap<String, u32> = HashMap::new();
    for raw in text.split(|c: char| !c.is_ascii_alphanumeric()) {
        let token = normalize_token(raw);
        if token.is_empty() {
            continue;
        }
        *counts.entry(token).or_insert(0) += 1;
    }
    counts.into_iter().collect()
}

fn normalize_token(token: &str) -> String {
    token
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn internal(error: impl std::fmt::Display) -> IrodoriError {
    IrodoriError::new(IrodoriErrorKind::Internal, error.to_string())
}

#[cfg(test)]
mod tests;
