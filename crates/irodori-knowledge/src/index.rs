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

use irodori_core::{
    run_job, BatchOutcome, BatchResult, IrodoriError, IrodoriErrorKind, JobArtifact, JobContext,
    JobLogLevel, JobRuntime,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};

/// Rows per multi-row `INSERT` when flushing a batch. SQLite caps bound parameters
/// at 999; postings use 3 columns, so 256 rows stays well under the limit.
const INSERT_CHUNK: usize = 256;
const PROGRESS_UNIT: &str = "documents";

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

/// Build (or resume building) the index for `job_id` over `corpus` through the
/// shared batch-job envelope (JOB-004): [`run_job`] owns the job's start and
/// terminal transition while the operation drives progress, cancellation, and
/// checkpoint/resume through its [`JobContext`].
///
/// The job must already be submitted to `runtime`. Returns the build report; a
/// cancellation is a normal `Ok` outcome with `cancelled = true`.
pub async fn build_index<I>(
    runtime: &JobRuntime,
    job_id: &str,
    store: &IndexStore,
    corpus: I,
    config: IndexBuildConfig,
) -> Result<IndexBuildReport, IrodoriError>
where
    I: IntoIterator<Item = Document>,
{
    let (_record, report) = run_job(runtime, job_id, |ctx| async move {
        let report = build_index_with(&ctx, store, corpus, config).await?;
        let outcome = if report.cancelled {
            BatchOutcome::cancelled(format!(
                "cancelled after {} documents",
                report.documents_indexed
            ))
        } else {
            BatchOutcome::completed_with(
                format!(
                    "indexed {} documents ({} postings)",
                    report.documents_indexed, report.postings_written
                ),
                vec![JobArtifact {
                    id: "index".to_string(),
                    name: "inverted-index".to_string(),
                    path: "index_postings".to_string(),
                    media_type: Some("application/x-sqlite3".to_string()),
                    size_bytes: Some(report.postings_written),
                }],
            )
        };
        Ok(BatchResult::new(outcome, report))
    })
    .await?;
    Ok(report)
}

/// The index-build operation itself, expressed against the batch [`JobContext`]
/// contract: it reports progress, checkpoints for resume, and stops cooperatively
/// on cancel — but leaves start/succeed/cancel/fail to [`run_job`]. Exposed so a
/// caller already inside the batch envelope can compose it directly.
pub async fn build_index_with<I>(
    ctx: &JobContext<'_>,
    store: &IndexStore,
    corpus: I,
    config: IndexBuildConfig,
) -> Result<IndexBuildReport, IrodoriError>
where
    I: IntoIterator<Item = Document>,
{
    let flush_postings = config.flush_postings.max(1);
    let progress_every = config.progress_every_docs.max(1);
    let checkpoint_every = config.checkpoint_every_docs.max(1);

    // Resume from the checkpoint the runtime surfaced (0 for a fresh build).
    let resumed_from = ctx.resume_cursor();
    let _ = ctx.log(
        JobLogLevel::Info,
        if resumed_from > 0 {
            format!("resuming index build from document {resumed_from}")
        } else {
            "starting index build".to_string()
        },
    );

    let started = std::time::Instant::now();
    let mut doc_buffer: Vec<(String, String, i64)> = Vec::new();
    let mut posting_buffer: Vec<(String, String, i64)> = Vec::new();
    let mut peak_buffer_postings = 0usize;
    let mut documents_indexed = 0u64;
    let mut documents_skipped = 0u64;
    let mut postings_written = 0u64;
    let mut processed = resumed_from; // absolute position cursor
    let mut cancelled = false;

    for (position, document) in corpus.into_iter().enumerate() {
        let position = position as u64;
        if position < resumed_from {
            documents_skipped += 1;
            continue;
        }

        // Tokenize into per-term frequencies for this document.
        for (term, frequency) in tokenize(&document.text) {
            posting_buffer.push((term, document.id.clone(), frequency as i64));
        }
        doc_buffer.push((document.id, document.source, position as i64));
        documents_indexed += 1;
        processed = position + 1;
        peak_buffer_postings = peak_buffer_postings.max(posting_buffer.len());

        // Backpressure: flush once the postings buffer crosses the budget so RAM
        // stays flat regardless of corpus size.
        if posting_buffer.len() >= flush_postings {
            postings_written += flush_batch(store, &mut doc_buffer, &mut posting_buffer).await?;
        }

        if documents_indexed % progress_every == 0 {
            ctx.report_progress(
                processed,
                None,
                PROGRESS_UNIT,
                format!("{documents_indexed} indexed"),
            )?;
            if ctx.should_cancel() {
                cancelled = true;
                break;
            }
        }

        if documents_indexed % checkpoint_every == 0 {
            postings_written += flush_batch(store, &mut doc_buffer, &mut posting_buffer).await?;
            ctx.save_checkpoint(processed)?;
        }
    }

    // Flush whatever is left and record a final checkpoint at the true cursor.
    postings_written += flush_batch(store, &mut doc_buffer, &mut posting_buffer).await?;
    ctx.save_checkpoint(processed)?;
    if !cancelled {
        ctx.report_progress(
            processed,
            Some(processed),
            PROGRESS_UNIT,
            "index build complete",
        )?;
    }

    let elapsed = started.elapsed();
    let elapsed_ms = elapsed.as_millis() as u64;
    let throughput_docs_per_sec = if elapsed.as_secs_f64() > 0.0 {
        (documents_indexed as f64 / elapsed.as_secs_f64()) as u64
    } else {
        documents_indexed
    };

    Ok(IndexBuildReport {
        documents_indexed,
        documents_skipped,
        postings_written,
        peak_buffer_postings,
        resumed_from,
        cancelled,
        elapsed_ms,
        throughput_docs_per_sec,
    })
}

/// Flush buffered documents and postings to disk in one transaction, clearing the
/// buffers. Returns the number of posting rows written.
async fn flush_batch(
    store: &IndexStore,
    doc_buffer: &mut Vec<(String, String, i64)>,
    posting_buffer: &mut Vec<(String, String, i64)>,
) -> Result<u64, IrodoriError> {
    if doc_buffer.is_empty() && posting_buffer.is_empty() {
        return Ok(0);
    }
    let docs = std::mem::take(doc_buffer);
    let postings = std::mem::take(posting_buffer);
    let written = postings.len() as u64;

    let mut tx = store.pool.begin().await.map_err(internal)?;
    for chunk in docs.chunks(INSERT_CHUNK) {
        let mut sql = String::from("INSERT OR IGNORE INTO index_docs(doc_id, source, ord) VALUES ");
        push_placeholders(&mut sql, chunk.len(), 3);
        let mut query = sqlx::query(&sql);
        for (doc_id, source, ord) in chunk {
            query = query.bind(doc_id).bind(source).bind(ord);
        }
        query.execute(&mut *tx).await.map_err(internal)?;
    }
    for chunk in postings.chunks(INSERT_CHUNK) {
        let mut sql =
            String::from("INSERT OR IGNORE INTO index_postings(term, doc_id, frequency) VALUES ");
        push_placeholders(&mut sql, chunk.len(), 3);
        let mut query = sqlx::query(&sql);
        for (term, doc_id, frequency) in chunk {
            query = query.bind(term).bind(doc_id).bind(frequency);
        }
        query.execute(&mut *tx).await.map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    Ok(written)
}

fn push_placeholders(sql: &mut String, rows: usize, cols: usize) {
    for row in 0..rows {
        if row > 0 {
            sql.push(',');
        }
        sql.push('(');
        for col in 0..cols {
            if col > 0 {
                sql.push(',');
            }
            sql.push('?');
        }
        sql.push(')');
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
mod tests {
    use super::*;
    use irodori_core::{JobCheckpoint, JobKind, JobRuntime, JobSpec};

    fn resumable_spec(title: &str) -> JobSpec {
        JobSpec {
            resumable: true,
            ..JobSpec::new(JobKind::IndexBuild, title)
        }
    }

    fn runtime_with_job(id: &str) -> JobRuntime {
        let runtime = JobRuntime::default();
        runtime
            .submit_with_id(id, resumable_spec("index build"))
            .expect("submit");
        runtime
    }

    fn doc(n: usize, text: &str) -> Document {
        Document::new(format!("doc-{n}"), "test", text)
    }

    #[tokio::test]
    async fn builds_and_queries_a_small_corpus() {
        let store = IndexStore::open_in_memory().await.expect("open");
        let runtime = runtime_with_job("j1");
        let corpus = vec![
            doc(0, "the quick brown fox"),
            doc(1, "the lazy brown dog"),
            doc(2, "quick quick quick foxes"),
        ];
        let report = build_index(&runtime, "j1", &store, corpus, IndexBuildConfig::default())
            .await
            .expect("build");

        assert_eq!(report.documents_indexed, 3);
        assert!(!report.cancelled);
        assert_eq!(store.document_count().await.unwrap(), 3);

        // "brown" is in docs 0 and 1.
        let brown = store.search("brown").await.unwrap();
        assert_eq!(brown.len(), 2);
        assert!(brown.iter().any(|p| p.doc_id == "doc-0"));
        assert!(brown.iter().any(|p| p.doc_id == "doc-1"));

        // "quick" appears 3x in doc 2, 1x in doc 0 → doc 2 ranks first by frequency.
        let quick = store.search("quick").await.unwrap();
        assert_eq!(quick[0].doc_id, "doc-2");
        assert_eq!(quick[0].frequency, 3);

        // Normalization: a mixed-case query hits the same postings.
        assert_eq!(store.search("BROWN").await.unwrap().len(), 2);
        assert!(store.search("missing").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rebuild_is_idempotent() {
        let store = IndexStore::open_in_memory().await.expect("open");
        let corpus = vec![doc(0, "alpha beta"), doc(1, "beta gamma")];

        let runtime = runtime_with_job("a");
        build_index(&runtime, "a", &store, corpus.clone(), IndexBuildConfig::default())
            .await
            .unwrap();
        let postings_after_first = store.posting_count().await.unwrap();

        // Re-indexing the same corpus must not duplicate documents or postings.
        let runtime2 = runtime_with_job("b");
        build_index(&runtime2, "b", &store, corpus, IndexBuildConfig::default())
            .await
            .unwrap();
        assert_eq!(store.document_count().await.unwrap(), 2);
        assert_eq!(store.posting_count().await.unwrap(), postings_after_first);
    }

    #[tokio::test]
    async fn memory_stays_flat_over_a_large_corpus() {
        // The anti-OOM guarantee: peak postings RAM is bounded by the flush budget
        // no matter how many documents stream through, and the index is complete
        // and queryable afterward. The corpus is a lazy iterator, so it is never
        // fully materialized either.
        let store = IndexStore::open_in_memory().await.expect("open");
        let runtime = runtime_with_job("big");
        let total = 50_000usize;
        let flush_postings = 5_000usize;
        let corpus = (0..total).map(|n| {
            // Each doc has ~4 distinct terms: a shared one, a bucketed one, a rare one.
            Document::new(
                format!("doc-{n}"),
                "synthetic",
                format!("common term bucket{} unique{}", n % 100, n),
            )
        });

        let config = IndexBuildConfig {
            flush_postings,
            progress_every_docs: 5_000,
            checkpoint_every_docs: 10_000,
        };
        let report = build_index(&runtime, "big", &store, corpus, config)
            .await
            .expect("build");

        assert_eq!(report.documents_indexed, total as u64);
        assert!(
            report.peak_buffer_postings <= flush_postings + 8,
            "peak buffer {} must stay near the flush budget {}",
            report.peak_buffer_postings,
            flush_postings
        );
        assert_eq!(store.document_count().await.unwrap(), total as u64);
        // "common" is in every document.
        assert_eq!(store.search("common").await.unwrap().len(), total);
        // A bucket term is shared by 1/100th of the corpus.
        assert_eq!(store.search("bucket7").await.unwrap().len(), total / 100);
        // A unique term hits exactly one document.
        let unique = store.search("unique42").await.unwrap();
        assert_eq!(unique.len(), 1);
        assert_eq!(unique[0].doc_id, "doc-42");

        // The job finished and recorded throughput + an artifact.
        let job = runtime.get("big").unwrap();
        assert_eq!(job.status, irodori_core::JobStatus::Succeeded);
        assert!(!job.artifacts.is_empty());
    }

    #[tokio::test]
    async fn resumes_from_checkpoint_after_cancellation() {
        let store = IndexStore::open_in_memory().await.expect("open");
        let runtime = runtime_with_job("r");
        let total = 5_000usize;
        let build_corpus = || (0..total).map(|n| doc(n, &format!("word{} shared", n % 10)));

        // First pass: cancel partway through. The checkpoint records the cursor.
        // The job must be Running before a cancel request (cancelling a still-queued
        // job terminates it outright), so start it, then request cancellation: the
        // build's first progress check then stops it cooperatively.
        let config = IndexBuildConfig {
            flush_postings: 1_000,
            progress_every_docs: 500,
            checkpoint_every_docs: 1_000,
        };
        runtime.start("r").unwrap();
        runtime.request_cancel("r").unwrap();
        let first = build_index(&runtime, "r", &store, build_corpus(), config)
            .await
            .unwrap();
        assert!(first.cancelled);
        assert!(first.documents_indexed < total as u64);
        let partial = store.document_count().await.unwrap();
        assert!(partial > 0 && partial < total as u64);

        // Resume on a fresh job seeded with the prior checkpoint: it skips the
        // already-indexed prefix and finishes the rest.
        let runtime2 = JobRuntime::default();
        runtime2
            .submit_with_id("r2", resumable_spec("resume"))
            .unwrap();
        runtime2.start("r2").unwrap();
        runtime2
            .update_checkpoint(
                "r2",
                JobCheckpoint::new(1, partial.to_string(), "{}"),
            )
            .unwrap();

        let second = build_index(&runtime2, "r2", &store, build_corpus(), config)
            .await
            .unwrap();
        assert!(!second.cancelled);
        assert_eq!(second.resumed_from, partial);
        assert_eq!(second.documents_skipped, partial);
        assert_eq!(second.documents_indexed, total as u64 - partial);

        // The combined index covers the whole corpus with no gaps or duplicates.
        assert_eq!(store.document_count().await.unwrap(), total as u64);
        assert_eq!(store.search("shared").await.unwrap().len(), total);
    }
}
