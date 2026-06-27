//! Job specification, runtime, and batch-execution primitives for Irodori.
//!
//! Extracted from `irodori-core` so the knowledge/indexing layer can depend on
//! the job runtime without pulling in connection or security code. Builds only
//! on `irodori-error`.

pub mod batch;
pub mod jobs;

pub const CRATE_NAME: &str = "irodori-jobs";

pub use batch::{run_job, BatchOutcome, BatchResult, JobContext};
pub use jobs::{
    JobArtifact, JobCheckpoint, JobConcurrencyPolicy, JobKind, JobList, JobLogEntry, JobLogLevel,
    JobProgress, JobRecord, JobResourceBudget, JobRetryPolicy, JobRuntime, JobRuntimeConfig,
    JobSpec, JobStatus, JobSummary,
};
