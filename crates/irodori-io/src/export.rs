//! JOB-004 — job-driven tabular export.
//!
//! Streams a row source through any [`TabularEncoder`](crate::TabularEncoder)
//! under the shared batch-job envelope (`irodori_core::batch`): progress every N
//! rows, cooperative cancellation, an output artifact, and a single terminal
//! transition. This is the second workflow migrated onto the contract (the first
//! being the index builder), proving the same envelope spans a streaming-IO job,
//! not just CPU/disk indexing.

use std::fmt::Display;

use irodori_core::{
    run_job, BatchOutcome, BatchResult, IrodoriError, IrodoriErrorKind, JobArtifact, JobContext,
    JobLogLevel, JobRecord, JobRuntime,
};

use crate::{Cell, OwnedCell, TabularEncoder};

const PROGRESS_UNIT: &str = "rows";

#[derive(Debug, Clone, Copy)]
pub struct ExportConfig {
    /// Report progress and check for cancellation every this many rows.
    pub progress_every_rows: u64,
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            progress_every_rows: 10_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportReport {
    pub rows_written: u64,
    pub cancelled: bool,
}

/// Export `rows` through `encoder`, driving `job_id` under the batch-job envelope.
/// `artifact_path` is recorded as the job's output artifact. Returns the job's
/// final record and the export report; a cancellation is a normal `Ok` outcome
/// with `cancelled = true` and the partially written output flushed.
pub async fn run_export<R>(
    runtime: &JobRuntime,
    job_id: &str,
    rows: R,
    encoder: &mut dyn TabularEncoder,
    artifact_path: &str,
    config: ExportConfig,
) -> Result<(JobRecord, ExportReport), IrodoriError>
where
    R: IntoIterator<Item = Vec<OwnedCell>>,
{
    let artifact_path = artifact_path.to_string();
    run_job(runtime, job_id, |ctx| async move {
        let report = export_with(&ctx, rows, encoder, config)?;
        let outcome = if report.cancelled {
            BatchOutcome::cancelled(format!(
                "export cancelled after {} rows",
                report.rows_written
            ))
        } else {
            BatchOutcome::completed_with(
                format!("exported {} rows", report.rows_written),
                vec![JobArtifact {
                    id: "export".to_string(),
                    name: "export-output".to_string(),
                    path: artifact_path,
                    media_type: None,
                    size_bytes: Some(report.rows_written),
                }],
            )
        };
        Ok(BatchResult::new(outcome, report))
    })
    .await
}

/// The export operation against the batch [`JobContext`] contract: it writes rows,
/// reports progress, and stops cooperatively on cancel, leaving the job's terminal
/// transition to [`run_job`].
pub fn export_with<R>(
    ctx: &JobContext<'_>,
    rows: R,
    encoder: &mut dyn TabularEncoder,
    config: ExportConfig,
) -> Result<ExportReport, IrodoriError>
where
    R: IntoIterator<Item = Vec<OwnedCell>>,
{
    let progress_every = config.progress_every_rows.max(1);
    let _ = ctx.log(JobLogLevel::Info, "starting export");

    let mut rows_written = 0u64;
    let mut cancelled = false;
    for row in rows {
        let cells: Vec<Cell<'_>> = row.iter().map(cell_ref).collect();
        encoder.write_row(&cells).map_err(io_err)?;
        rows_written += 1;
        if rows_written % progress_every == 0 {
            ctx.report_progress(
                rows_written,
                None,
                PROGRESS_UNIT,
                format!("{rows_written} rows"),
            )?;
            if ctx.should_cancel() {
                cancelled = true;
                break;
            }
        }
    }
    // Always flush — including a partial, cancelled export.
    encoder.finish().map_err(io_err)?;
    if !cancelled {
        ctx.report_progress(
            rows_written,
            Some(rows_written),
            PROGRESS_UNIT,
            "export complete",
        )?;
    }
    Ok(ExportReport {
        rows_written,
        cancelled,
    })
}

fn cell_ref(owned: &OwnedCell) -> Cell<'_> {
    match owned {
        OwnedCell::Null => Cell::Null,
        OwnedCell::Bool(value) => Cell::Bool(*value),
        OwnedCell::Integer(value) => Cell::Integer(*value),
        OwnedCell::Float(value) => Cell::Float(*value),
        OwnedCell::Text(value) => Cell::Text(value),
    }
}

fn io_err(error: impl Display) -> IrodoriError {
    IrodoriError::new(IrodoriErrorKind::Internal, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DelimitedEncoder;
    use irodori_core::{JobKind, JobSpec, JobStatus};

    fn runtime_with(id: &str) -> JobRuntime {
        let runtime = JobRuntime::default();
        runtime
            .submit_with_id(id, JobSpec::new(JobKind::Export, "export"))
            .expect("submit");
        runtime
    }

    #[tokio::test]
    async fn exports_rows_through_the_batch_envelope() {
        let runtime = runtime_with("export");
        let rows = vec![
            vec![OwnedCell::Integer(1), OwnedCell::Text("a".into())],
            vec![OwnedCell::Integer(2), OwnedCell::Text("b".into())],
        ];
        let mut out: Vec<u8> = Vec::new();
        let (record, report) = {
            let mut encoder = DelimitedEncoder::csv(&mut out, &["id", "name"]).unwrap();
            run_export(
                &runtime,
                "export",
                rows,
                &mut encoder,
                "/tmp/out.csv",
                ExportConfig::default(),
            )
            .await
            .expect("run")
        };

        assert_eq!(report.rows_written, 2);
        assert!(!report.cancelled);
        assert_eq!(record.status, JobStatus::Succeeded);
        assert_eq!(record.artifacts.len(), 1);
        assert_eq!(record.artifacts[0].path, "/tmp/out.csv");
        assert_eq!(String::from_utf8(out).unwrap(), "id,name\n1,a\n2,b\n");
    }

    #[tokio::test]
    async fn export_stops_cooperatively_on_cancellation() {
        let runtime = runtime_with("cancel");
        runtime.start("cancel").unwrap();
        runtime.request_cancel("cancel").unwrap();
        let rows = (0..1_000).map(|n| vec![OwnedCell::Integer(n)]);
        let mut out: Vec<u8> = Vec::new();
        let (record, report) = {
            let mut encoder = DelimitedEncoder::csv(&mut out, &["n"]).unwrap();
            run_export(
                &runtime,
                "cancel",
                rows,
                &mut encoder,
                "/tmp/out.csv",
                ExportConfig {
                    progress_every_rows: 10,
                },
            )
            .await
            .expect("run")
        };

        assert!(report.cancelled);
        assert!(report.rows_written < 1_000);
        assert_eq!(record.status, JobStatus::Cancelled);
        // The partial output was still flushed (header + the rows written so far).
        assert!(String::from_utf8(out).unwrap().starts_with("n\n0\n"));
    }
}
