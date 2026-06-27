//! Index build pipeline (JOB-002/JOB-004): stream a corpus through the shared

use irodori_error::IrodoriError;
use irodori_jobs::{
    run_job, BatchOutcome, BatchResult, JobArtifact, JobContext, JobLogLevel, JobRuntime,
};
use sqlx::{QueryBuilder, Sqlite};

use super::{internal, tokenize, Document, IndexBuildConfig, IndexBuildReport, IndexStore};

/// Rows per multi-row `INSERT` when flushing a batch. SQLite caps bound parameters
/// at 999; postings use 3 columns, so 256 rows stays well under the limit.
const INSERT_CHUNK: usize = 256;
const PROGRESS_UNIT: &str = "documents";

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
        let mut query =
            QueryBuilder::<Sqlite>::new("INSERT OR IGNORE INTO index_docs(doc_id, source, ord) ");
        query.push_values(chunk, |mut row, (doc_id, source, ord)| {
            row.push_bind(doc_id).push_bind(source).push_bind(*ord);
        });
        query.build().execute(&mut *tx).await.map_err(internal)?;
    }
    for chunk in postings.chunks(INSERT_CHUNK) {
        let mut query = QueryBuilder::<Sqlite>::new(
            "INSERT OR IGNORE INTO index_postings(term, doc_id, frequency) ",
        );
        query.push_values(chunk, |mut row, (term, doc_id, frequency)| {
            row.push_bind(term).push_bind(doc_id).push_bind(*frequency);
        });
        query.build().execute(&mut *tx).await.map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    Ok(written)
}
