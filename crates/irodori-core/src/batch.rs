//! JOB-004 — batch operation contract.
//!
//! A single envelope so every heavy operation (huge index build, import/export,
//! knowledge refresh, ML/eval, safe bulk edit) runs through the JOB-001 runtime
//! the same way: start once, report progress, honor cancellation, log, emit
//! artifacts, checkpoint for resume, and end in exactly one terminal transition —
//! whether driven from the desktop or a headless/API caller.
//!
//! An operation is just an async function that receives a [`JobContext`] and
//! returns a [`BatchResult`]; [`run_job`] owns the lifecycle around it. This keeps
//! the diverse operations decoupled from the runtime's state machine while
//! guaranteeing they all surface the same progress/cancel/log/artifact/resume
//! shape.

use std::future::Future;

use crate::jobs::{JobArtifact, JobCheckpoint, JobLogLevel, JobRecord, JobRuntime};
use crate::Result;

const CHECKPOINT_VERSION: u16 = 1;

/// The handle an operation uses to talk to its job: progress, cancellation,
/// resume cursor, checkpoints, logs, and artifacts. Handed to the operation by
/// [`run_job`]; the operation never touches the runtime's terminal transitions.
pub struct JobContext<'a> {
    runtime: &'a JobRuntime,
    job_id: String,
    resumable: bool,
    resume_cursor: u64,
}

impl<'a> JobContext<'a> {
    fn new(runtime: &'a JobRuntime, job_id: &str) -> Self {
        let record = runtime.get(job_id);
        let resumable = record.as_ref().map(|job| job.spec.resumable).unwrap_or(false);
        let resume_cursor = record
            .and_then(|job| job.checkpoint)
            .map(|checkpoint| checkpoint.cursor.parse::<u64>().unwrap_or(0))
            .unwrap_or(0);
        Self {
            runtime,
            job_id: job_id.to_string(),
            resumable,
            resume_cursor,
        }
    }

    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn resumable(&self) -> bool {
        self.resumable
    }

    /// The cursor a prior run checkpointed (0 for a fresh run) — where a resumable
    /// operation should pick up from.
    pub fn resume_cursor(&self) -> u64 {
        self.resume_cursor
    }

    /// Report progress in operation-defined `unit`s (e.g. "documents", "rows").
    pub fn report_progress(
        &self,
        completed: u64,
        total: Option<u64>,
        unit: &str,
        message: impl Into<String>,
    ) -> Result<()> {
        self.runtime
            .update_progress(&self.job_id, completed, total, unit, Some(message.into()))?;
        Ok(())
    }

    /// Whether a cancellation has been requested. Operations should poll this at a
    /// natural granularity and stop cooperatively.
    pub fn should_cancel(&self) -> bool {
        self.runtime.should_cancel(&self.job_id)
    }

    /// Persist a resume cursor. A no-op (still `Ok`) for non-resumable jobs, so an
    /// operation can checkpoint unconditionally and let the spec decide.
    pub fn save_checkpoint(&self, cursor: u64) -> Result<()> {
        if self.resumable {
            self.runtime.update_checkpoint(
                &self.job_id,
                JobCheckpoint::new(CHECKPOINT_VERSION, cursor.to_string(), "{}"),
            )?;
        }
        Ok(())
    }

    pub fn log(&self, level: JobLogLevel, message: impl Into<String>) -> Result<()> {
        self.runtime
            .append_log(&self.job_id, level, message.into(), Default::default())?;
        Ok(())
    }

    pub fn emit_artifact(&self, artifact: JobArtifact) -> Result<()> {
        self.runtime.add_artifact(&self.job_id, artifact)?;
        Ok(())
    }
}

/// How an operation finished. A failure is reported by returning `Err` from the
/// operation, not a variant here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchOutcome {
    Completed {
        message: String,
        artifacts: Vec<JobArtifact>,
    },
    Cancelled {
        message: String,
    },
}

impl BatchOutcome {
    pub fn completed(message: impl Into<String>) -> Self {
        Self::Completed {
            message: message.into(),
            artifacts: Vec::new(),
        }
    }

    pub fn completed_with(message: impl Into<String>, artifacts: Vec<JobArtifact>) -> Self {
        Self::Completed {
            message: message.into(),
            artifacts,
        }
    }

    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::Cancelled {
            message: message.into(),
        }
    }
}

/// An operation's result: how it finished plus the domain value (a report, an
/// output path, …) returned to the [`run_job`] caller.
pub struct BatchResult<T> {
    pub outcome: BatchOutcome,
    pub value: T,
}

impl<T> BatchResult<T> {
    pub fn new(outcome: BatchOutcome, value: T) -> Self {
        Self { outcome, value }
    }
}

/// Drive a batch operation through the job runtime under one uniform envelope.
///
/// `job_id` must already be submitted. `run_job` starts it (a no-op for an
/// already-running resume), runs `operation` with a [`JobContext`], and maps the
/// result to a single terminal transition: `Completed` records its artifacts then
/// `succeed`s; `Cancelled` `mark_cancelled`s; an `Err` `fail`s the job and
/// propagates. Returns the job's final record plus the operation's domain value.
pub async fn run_job<'a, F, Fut, T>(
    runtime: &'a JobRuntime,
    job_id: &str,
    operation: F,
) -> Result<(JobRecord, T)>
where
    F: FnOnce(JobContext<'a>) -> Fut,
    Fut: Future<Output = Result<BatchResult<T>>>,
{
    // Idempotent start: a fresh job is Queued -> Running; a resumed job is already
    // Running, so a benign "not queued" error is ignored.
    let _ = runtime.start(job_id);
    let context = JobContext::new(runtime, job_id);
    match operation(context).await {
        Ok(BatchResult { outcome, value }) => {
            let record = match outcome {
                BatchOutcome::Completed { message, artifacts } => {
                    for artifact in artifacts {
                        runtime.add_artifact(job_id, artifact)?;
                    }
                    runtime.succeed(job_id, message)?
                }
                BatchOutcome::Cancelled { message } => runtime.mark_cancelled(job_id, message)?,
            };
            Ok((record, value))
        }
        Err(error) => {
            let _ = runtime.fail(job_id, error.clone());
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::{JobKind, JobRuntime, JobSpec, JobStatus};

    fn runtime_with(id: &str, resumable: bool) -> JobRuntime {
        let runtime = JobRuntime::default();
        let spec = JobSpec {
            resumable,
            ..JobSpec::new(JobKind::Export, "batch op")
        };
        runtime.submit_with_id(id, spec).expect("submit");
        runtime
    }

    fn artifact(id: &str) -> JobArtifact {
        JobArtifact {
            id: id.to_string(),
            name: "out".to_string(),
            path: "/tmp/out".to_string(),
            media_type: None,
            size_bytes: None,
        }
    }

    #[tokio::test]
    async fn run_job_completes_records_artifacts_and_returns_value() {
        let runtime = runtime_with("done", false);
        let (record, value) = run_job(&runtime, "done", |ctx| async move {
            ctx.report_progress(5, Some(10), "rows", "halfway")?;
            ctx.report_progress(10, Some(10), "rows", "all done")?;
            Ok(BatchResult::new(
                BatchOutcome::completed_with("exported 10 rows", vec![artifact("file")]),
                10u64,
            ))
        })
        .await
        .expect("run");

        assert_eq!(record.status, JobStatus::Succeeded);
        assert_eq!(value, 10);
        assert_eq!(record.artifacts.len(), 1);
        assert_eq!(record.progress.completed, 10);
    }

    #[tokio::test]
    async fn run_job_marks_cancellation() {
        let runtime = runtime_with("cancel", false);
        // The operation observes a cancellation request and stops cooperatively.
        runtime.start("cancel").unwrap();
        runtime.request_cancel("cancel").unwrap();
        let (record, partial) = run_job(&runtime, "cancel", |ctx| async move {
            let stopped = ctx.should_cancel();
            Ok(BatchResult::new(
                BatchOutcome::cancelled("stopped early"),
                stopped,
            ))
        })
        .await
        .expect("run");
        assert!(partial, "operation saw the cancel request");
        assert_eq!(record.status, JobStatus::Cancelled);
    }

    #[tokio::test]
    async fn run_job_fails_on_error() {
        let runtime = runtime_with("boom", false);
        let result: Result<(JobRecord, ())> = run_job(&runtime, "boom", |_ctx| async move {
            Err(crate::IrodoriError::new(
                crate::IrodoriErrorKind::Internal,
                "kaboom",
            ))
        })
        .await;
        assert!(result.is_err());
        assert_eq!(runtime.get("boom").unwrap().status, JobStatus::Failed);
    }

    #[tokio::test]
    async fn context_exposes_resume_cursor_and_guards_checkpoints() {
        // Resumable job seeded with a checkpoint: the context surfaces the cursor.
        let runtime = runtime_with("res", true);
        runtime.start("res").unwrap();
        runtime
            .update_checkpoint("res", JobCheckpoint::new(1, "250", "{}"))
            .unwrap();
        run_job(&runtime, "res", |ctx| async move {
            assert!(ctx.resumable());
            assert_eq!(ctx.resume_cursor(), 250);
            ctx.save_checkpoint(500)?;
            Ok(BatchResult::new(BatchOutcome::completed("ok"), ()))
        })
        .await
        .expect("run");
        assert_eq!(
            runtime.get("res").unwrap().checkpoint.unwrap().cursor,
            "500"
        );

        // Non-resumable job: save_checkpoint is a silent no-op, never an error.
        let runtime2 = runtime_with("nores", false);
        run_job(&runtime2, "nores", |ctx| async move {
            assert!(!ctx.resumable());
            assert_eq!(ctx.resume_cursor(), 0);
            ctx.save_checkpoint(99)?;
            Ok(BatchResult::new(BatchOutcome::completed("ok"), ()))
        })
        .await
        .expect("run");
        assert!(runtime2.get("nores").unwrap().checkpoint.is_none());
    }
}
