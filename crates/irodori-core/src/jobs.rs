use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{IrodoriError, Result};

const DEFAULT_MAX_CONCURRENT_JOBS: u16 = 2;
const DEFAULT_MAX_HISTORY: usize = 200;
const DEFAULT_PROGRESS_UNIT: &str = "items";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum JobKind {
    KnowledgeRefresh,
    Import,
    Export,
    IndexBuild,
    MlEvaluation,
    BulkEdit,
    SourceScan,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::Cancelling)
    }

    pub fn is_terminal(self) -> bool {
        !self.is_active()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum JobLogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobRetryPolicy {
    // Total attempts, including the first run.
    pub max_attempts: u16,
    pub initial_backoff_ms: u64,
    pub max_backoff_ms: u64,
}

impl Default for JobRetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 1,
            initial_backoff_ms: 1_000,
            max_backoff_ms: 60_000,
        }
    }
}

impl JobRetryPolicy {
    pub fn no_retry() -> Self {
        Self::default()
    }

    pub fn with_retries(max_attempts: u16) -> Self {
        Self {
            max_attempts: max_attempts.max(1),
            ..Self::default()
        }
    }

    fn next_backoff_ms(&self, attempt: u16) -> u64 {
        let exponent = attempt.saturating_sub(1).min(10) as u32;
        self.initial_backoff_ms
            .saturating_mul(2_u64.saturating_pow(exponent))
            .min(self.max_backoff_ms)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobConcurrencyPolicy {
    // Empty means the job only counts against the global concurrency cap.
    pub group: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_concurrent_in_group: Option<u16>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobResourceBudget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_memory_mb: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_disk_mb: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_cpu_percent: Option<u8>,
}

impl JobResourceBudget {
    pub fn validate(&self) -> Result<()> {
        if self
            .max_cpu_percent
            .is_some_and(|value| value == 0 || value > 100)
        {
            return Err(IrodoriError::validation(
                "job CPU budget must be between 1 and 100 percent",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobSpec {
    pub kind: JobKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default)]
    pub retry: JobRetryPolicy,
    #[serde(default)]
    pub concurrency: JobConcurrencyPolicy,
    #[serde(default)]
    pub resource_budget: JobResourceBudget,
    #[serde(default)]
    pub resumable: bool,
}

impl JobSpec {
    pub fn new(kind: JobKind, title: impl Into<String>) -> Self {
        Self {
            kind,
            title: title.into(),
            source: None,
            tags: Vec::new(),
            retry: JobRetryPolicy::default(),
            concurrency: JobConcurrencyPolicy::default(),
            resource_budget: JobResourceBudget::default(),
            resumable: false,
        }
    }

    pub fn validate(&self) -> Result<()> {
        validate_required("job title", &self.title)?;
        if self.retry.max_attempts == 0 {
            return Err(IrodoriError::validation(
                "job retry policy must allow at least one attempt",
            ));
        }
        if let Some(max) = self.concurrency.max_concurrent_in_group {
            if max == 0 {
                return Err(IrodoriError::validation(
                    "job group concurrency limit must be greater than zero",
                ));
            }
        }
        self.resource_budget.validate()?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobProgress {
    pub completed: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub total: Option<u64>,
    pub unit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub percent: Option<u8>,
}

impl Default for JobProgress {
    fn default() -> Self {
        Self {
            completed: 0,
            total: None,
            unit: DEFAULT_PROGRESS_UNIT.to_string(),
            message: None,
            percent: None,
        }
    }
}

impl JobProgress {
    pub fn new(
        completed: u64,
        total: Option<u64>,
        unit: impl Into<String>,
        message: Option<String>,
    ) -> Self {
        let percent = total.and_then(|total| {
            if total == 0 {
                None
            } else {
                Some(((completed.min(total) * 100) / total) as u8)
            }
        });
        Self {
            completed,
            total,
            unit: unit.into(),
            message,
            percent,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobCheckpoint {
    pub version: u16,
    pub cursor: String,
    pub payload_json: String,
    pub saved_at_ms: u64,
}

impl JobCheckpoint {
    pub fn new(version: u16, cursor: impl Into<String>, payload_json: impl Into<String>) -> Self {
        Self {
            version,
            cursor: cursor.into(),
            payload_json: payload_json.into(),
            saved_at_ms: now_millis(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobArtifact {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub media_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobLogEntry {
    pub sequence: u64,
    pub occurred_at_ms: u64,
    pub level: JobLogLevel,
    pub message: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    pub spec: JobSpec,
    pub status: JobStatus,
    pub progress: JobProgress,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub started_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finished_at_ms: Option<u64>,
    pub attempt: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_retry_at_ms: Option<u64>,
    pub cancel_requested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub checkpoint: Option<JobCheckpoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<JobArtifact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<IrodoriError>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub logs: Vec<JobLogEntry>,
}

impl JobRecord {
    fn new(id: String, spec: JobSpec, now: u64) -> Self {
        Self {
            id,
            spec,
            status: JobStatus::Queued,
            progress: JobProgress::default(),
            created_at_ms: now,
            updated_at_ms: now,
            started_at_ms: None,
            finished_at_ms: None,
            attempt: 0,
            next_retry_at_ms: None,
            cancel_requested: false,
            checkpoint: None,
            artifacts: Vec::new(),
            error: None,
            logs: Vec::new(),
        }
    }

    pub fn summary(&self) -> JobSummary {
        JobSummary {
            id: self.id.clone(),
            kind: self.spec.kind,
            title: self.spec.title.clone(),
            status: self.status,
            progress: self.progress.clone(),
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
            started_at_ms: self.started_at_ms,
            finished_at_ms: self.finished_at_ms,
            attempt: self.attempt,
            cancel_requested: self.cancel_requested,
            next_retry_at_ms: self.next_retry_at_ms,
            latest_log_message: self.logs.last().map(|entry| entry.message.clone()),
            artifact_count: self.artifacts.len() as u32,
            error: self.error.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobSummary {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
    pub status: JobStatus,
    pub progress: JobProgress,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub started_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub finished_at_ms: Option<u64>,
    pub attempt: u16,
    pub cancel_requested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_retry_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub latest_log_message: Option<String>,
    pub artifact_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<IrodoriError>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobList {
    pub active: Vec<JobSummary>,
    pub history: Vec<JobSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobRuntimeConfig {
    pub max_concurrent_jobs: u16,
    pub max_history: usize,
}

impl Default for JobRuntimeConfig {
    fn default() -> Self {
        Self {
            max_concurrent_jobs: DEFAULT_MAX_CONCURRENT_JOBS,
            max_history: DEFAULT_MAX_HISTORY,
        }
    }
}

#[derive(Debug)]
pub struct JobRuntime {
    inner: Mutex<JobRuntimeInner>,
}

impl Default for JobRuntime {
    fn default() -> Self {
        Self::new(JobRuntimeConfig::default())
    }
}

impl JobRuntime {
    pub fn new(config: JobRuntimeConfig) -> Self {
        Self {
            inner: Mutex::new(JobRuntimeInner {
                config,
                jobs: BTreeMap::new(),
                order: VecDeque::new(),
                next_job_sequence: 1,
                next_log_sequence: 1,
            }),
        }
    }

    pub fn submit(&self, spec: JobSpec) -> Result<JobRecord> {
        let mut inner = self.lock()?;
        let id = inner.next_job_id();
        inner.submit_with_id(id, spec)
    }

    pub fn submit_with_id(&self, id: impl Into<String>, spec: JobSpec) -> Result<JobRecord> {
        self.lock()?.submit_with_id(id.into(), spec)
    }

    pub fn list(&self) -> JobList {
        self.lock()
            .map(|inner| inner.list())
            .unwrap_or_else(|_| JobList::default())
    }

    pub fn get(&self, id: &str) -> Option<JobRecord> {
        self.lock()
            .ok()
            .and_then(|inner| inner.jobs.get(id).cloned())
    }

    pub fn start(&self, id: &str) -> Result<JobRecord> {
        self.lock()?.start(id)
    }

    pub fn update_progress(
        &self,
        id: &str,
        completed: u64,
        total: Option<u64>,
        unit: impl Into<String>,
        message: Option<String>,
    ) -> Result<JobRecord> {
        self.lock()?
            .update_progress(id, completed, total, unit.into(), message)
    }

    pub fn append_log(
        &self,
        id: &str,
        level: JobLogLevel,
        message: impl Into<String>,
        fields: BTreeMap<String, String>,
    ) -> Result<JobRecord> {
        self.lock()?.append_log(id, level, message.into(), fields)
    }

    pub fn update_checkpoint(&self, id: &str, checkpoint: JobCheckpoint) -> Result<JobRecord> {
        self.lock()?.update_checkpoint(id, checkpoint)
    }

    pub fn add_artifact(&self, id: &str, artifact: JobArtifact) -> Result<JobRecord> {
        self.lock()?.add_artifact(id, artifact)
    }

    pub fn request_cancel(&self, id: &str) -> Result<JobRecord> {
        self.lock()?.request_cancel(id)
    }

    pub fn should_cancel(&self, id: &str) -> bool {
        self.get(id)
            .map(|job| job.cancel_requested || job.status == JobStatus::Cancelling)
            .unwrap_or(false)
    }

    pub fn mark_cancelled(&self, id: &str, message: impl Into<String>) -> Result<JobRecord> {
        self.lock()?.mark_cancelled(id, message.into())
    }

    pub fn succeed(&self, id: &str, message: impl Into<String>) -> Result<JobRecord> {
        self.lock()?.succeed(id, message.into())
    }

    pub fn fail(&self, id: &str, error: IrodoriError) -> Result<JobRecord> {
        self.lock()?.fail(id, error)
    }

    pub fn retry(&self, id: &str) -> Result<JobRecord> {
        self.lock()?.retry(id)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, JobRuntimeInner>> {
        self.inner.lock().map_err(|_| {
            IrodoriError::new(
                crate::IrodoriErrorKind::Internal,
                "job runtime lock poisoned",
            )
        })
    }
}

#[derive(Debug)]
struct JobRuntimeInner {
    config: JobRuntimeConfig,
    jobs: BTreeMap<String, JobRecord>,
    order: VecDeque<String>,
    next_job_sequence: u64,
    next_log_sequence: u64,
}

impl JobRuntimeInner {
    fn next_job_id(&mut self) -> String {
        let sequence = self.next_job_sequence;
        self.next_job_sequence += 1;
        format!("job-{}-{sequence}", now_millis())
    }

    fn submit_with_id(&mut self, id: String, spec: JobSpec) -> Result<JobRecord> {
        validate_id("job id", &id)?;
        spec.validate()?;
        if self.jobs.contains_key(&id) {
            return Err(IrodoriError::validation(format!(
                "job id already exists: {id}"
            )));
        }

        let now = now_millis();
        let mut job = JobRecord::new(id.clone(), spec, now);
        self.push_log(&mut job, JobLogLevel::Info, "job queued", BTreeMap::new());
        self.jobs.insert(id.clone(), job.clone());
        self.order.push_back(id);
        self.prune_history();
        Ok(job)
    }

    fn list(&self) -> JobList {
        let mut active = Vec::new();
        let mut history = Vec::new();
        for id in &self.order {
            let Some(job) = self.jobs.get(id) else {
                continue;
            };
            if job.status.is_active() {
                active.push(job.summary());
            } else {
                history.push(job.summary());
            }
        }
        active.sort_by_key(|job| (job.status_sort_key(), job.created_at_ms));
        history.sort_by_key(|job| std::cmp::Reverse(job.updated_at_ms));
        JobList { active, history }
    }

    fn start(&mut self, id: &str) -> Result<JobRecord> {
        let candidate = self.job(id)?;
        if candidate.status != JobStatus::Queued {
            return Err(IrodoriError::validation(format!(
                "job {id} is not queued and cannot be started"
            )));
        }
        self.ensure_can_start(candidate)?;

        let mut job = self.jobs.remove(id).expect("job checked above");
        let now = now_millis();
        job.status = JobStatus::Running;
        job.started_at_ms.get_or_insert(now);
        job.updated_at_ms = now;
        job.finished_at_ms = None;
        job.next_retry_at_ms = None;
        job.cancel_requested = false;
        job.attempt = job.attempt.saturating_add(1);
        let attempt = job.attempt;
        self.push_log(
            &mut job,
            JobLogLevel::Info,
            format!("job started attempt {attempt}"),
            BTreeMap::new(),
        );
        self.jobs.insert(id.to_string(), job.clone());
        Ok(job)
    }

    fn update_progress(
        &mut self,
        id: &str,
        completed: u64,
        total: Option<u64>,
        unit: String,
        message: Option<String>,
    ) -> Result<JobRecord> {
        self.update_job(id, |job, _| {
            if !matches!(job.status, JobStatus::Running | JobStatus::Cancelling) {
                return Err(IrodoriError::validation(format!(
                    "job {id} is not running and cannot report progress"
                )));
            }
            job.progress = JobProgress::new(completed, total, unit, message);
            Ok(())
        })
    }

    fn append_log(
        &mut self,
        id: &str,
        level: JobLogLevel,
        message: String,
        fields: BTreeMap<String, String>,
    ) -> Result<JobRecord> {
        let sequence = self.next_log_sequence;
        self.next_log_sequence += 1;
        self.update_job(id, |job, now| {
            job.logs.push(JobLogEntry {
                sequence,
                occurred_at_ms: now,
                level,
                message,
                fields,
            });
            Ok(())
        })
    }

    fn update_checkpoint(&mut self, id: &str, checkpoint: JobCheckpoint) -> Result<JobRecord> {
        self.update_job(id, |job, _| {
            if !job.spec.resumable {
                return Err(IrodoriError::validation(format!(
                    "job {id} is not resumable and cannot store checkpoints"
                )));
            }
            job.checkpoint = Some(checkpoint);
            Ok(())
        })
    }

    fn add_artifact(&mut self, id: &str, artifact: JobArtifact) -> Result<JobRecord> {
        validate_id("artifact id", &artifact.id)?;
        validate_required("artifact name", &artifact.name)?;
        validate_required("artifact path", &artifact.path)?;
        self.update_job(id, |job, _| {
            job.artifacts.push(artifact);
            Ok(())
        })
    }

    fn request_cancel(&mut self, id: &str) -> Result<JobRecord> {
        self.update_job(id, |job, _| {
            match job.status {
                JobStatus::Queued => {
                    job.status = JobStatus::Cancelled;
                    job.finished_at_ms = Some(now_millis());
                    job.cancel_requested = true;
                }
                JobStatus::Running | JobStatus::Cancelling => {
                    job.status = JobStatus::Cancelling;
                    job.cancel_requested = true;
                }
                JobStatus::Succeeded | JobStatus::Failed | JobStatus::Cancelled => {}
            }
            Ok(())
        })
    }

    fn mark_cancelled(&mut self, id: &str, message: String) -> Result<JobRecord> {
        let message = if message.trim().is_empty() {
            "job cancelled".to_string()
        } else {
            message
        };
        let sequence = self.next_log_sequence;
        self.next_log_sequence += 1;
        let record = self.update_job(id, |job, now| {
            job.status = JobStatus::Cancelled;
            job.cancel_requested = true;
            job.finished_at_ms = Some(now);
            job.logs.push(JobLogEntry {
                sequence,
                occurred_at_ms: now,
                level: JobLogLevel::Warn,
                message,
                fields: BTreeMap::new(),
            });
            Ok(())
        })?;
        self.prune_history();
        Ok(record)
    }

    fn succeed(&mut self, id: &str, message: String) -> Result<JobRecord> {
        let sequence = self.next_log_sequence;
        self.next_log_sequence += 1;
        let record = self.update_job(id, |job, now| {
            if !matches!(job.status, JobStatus::Running | JobStatus::Cancelling) {
                return Err(IrodoriError::validation(format!(
                    "job {id} is not running and cannot be marked succeeded"
                )));
            }
            job.status = JobStatus::Succeeded;
            job.finished_at_ms = Some(now);
            job.cancel_requested = false;
            if job.progress.total.is_some() {
                job.progress.percent = Some(100);
            }
            if !message.trim().is_empty() {
                job.logs.push(JobLogEntry {
                    sequence,
                    occurred_at_ms: now,
                    level: JobLogLevel::Info,
                    message,
                    fields: BTreeMap::new(),
                });
            }
            Ok(())
        })?;
        self.prune_history();
        Ok(record)
    }

    fn fail(&mut self, id: &str, error: IrodoriError) -> Result<JobRecord> {
        let sequence = self.next_log_sequence;
        self.next_log_sequence += 1;
        let record = self.update_job(id, |job, now| {
            if !matches!(job.status, JobStatus::Running | JobStatus::Cancelling) {
                return Err(IrodoriError::validation(format!(
                    "job {id} is not running and cannot fail"
                )));
            }
            job.error = Some(error.clone());
            job.logs.push(JobLogEntry {
                sequence,
                occurred_at_ms: now,
                level: JobLogLevel::Error,
                message: error.message.clone(),
                fields: BTreeMap::new(),
            });
            if job.attempt < job.spec.retry.max_attempts && !job.cancel_requested {
                let backoff = job.spec.retry.next_backoff_ms(job.attempt);
                job.status = JobStatus::Queued;
                job.next_retry_at_ms = Some(now.saturating_add(backoff));
            } else {
                job.status = JobStatus::Failed;
                job.finished_at_ms = Some(now);
                job.next_retry_at_ms = None;
            }
            Ok(())
        })?;
        self.prune_history();
        Ok(record)
    }

    fn retry(&mut self, id: &str) -> Result<JobRecord> {
        self.update_job(id, |job, _| {
            if !matches!(job.status, JobStatus::Failed | JobStatus::Cancelled) {
                return Err(IrodoriError::validation(format!(
                    "job {id} is not failed or cancelled and cannot be retried"
                )));
            }
            job.status = JobStatus::Queued;
            job.finished_at_ms = None;
            job.next_retry_at_ms = None;
            job.cancel_requested = false;
            Ok(())
        })
    }

    fn update_job<F>(&mut self, id: &str, update: F) -> Result<JobRecord>
    where
        F: FnOnce(&mut JobRecord, u64) -> Result<()>,
    {
        let now = now_millis();
        let job = self.job_mut(id)?;
        update(job, now)?;
        job.updated_at_ms = now;
        Ok(job.clone())
    }

    fn ensure_can_start(&self, candidate: &JobRecord) -> Result<()> {
        let running_total = self
            .jobs
            .values()
            .filter(|job| matches!(job.status, JobStatus::Running | JobStatus::Cancelling))
            .count() as u16;
        if running_total >= self.config.max_concurrent_jobs {
            return Err(IrodoriError::validation(format!(
                "job concurrency limit reached: {}",
                self.config.max_concurrent_jobs
            )));
        }

        let Some(limit) = candidate.spec.concurrency.max_concurrent_in_group else {
            return Ok(());
        };
        let group = candidate.spec.concurrency.group.as_str();
        if group.is_empty() {
            return Ok(());
        }
        let running_in_group = self
            .jobs
            .values()
            .filter(|job| {
                matches!(job.status, JobStatus::Running | JobStatus::Cancelling)
                    && job.spec.concurrency.group == group
            })
            .count() as u16;
        if running_in_group >= limit {
            return Err(IrodoriError::validation(format!(
                "job group concurrency limit reached for {group}: {limit}"
            )));
        }
        Ok(())
    }

    fn job(&self, id: &str) -> Result<&JobRecord> {
        self.jobs.get(id).ok_or_else(|| {
            IrodoriError::new(
                crate::IrodoriErrorKind::NotFound,
                format!("job not found: {id}"),
            )
        })
    }

    fn job_mut(&mut self, id: &str) -> Result<&mut JobRecord> {
        self.jobs.get_mut(id).ok_or_else(|| {
            IrodoriError::new(
                crate::IrodoriErrorKind::NotFound,
                format!("job not found: {id}"),
            )
        })
    }

    fn push_log(
        &mut self,
        job: &mut JobRecord,
        level: JobLogLevel,
        message: impl Into<String>,
        fields: BTreeMap<String, String>,
    ) {
        let sequence = self.next_log_sequence;
        self.next_log_sequence += 1;
        job.logs.push(JobLogEntry {
            sequence,
            occurred_at_ms: now_millis(),
            level,
            message: message.into(),
            fields,
        });
    }

    fn prune_history(&mut self) {
        if self.config.max_history == 0 {
            return;
        }
        let terminal_ids: Vec<String> = self
            .order
            .iter()
            .filter_map(|id| {
                self.jobs
                    .get(id)
                    .filter(|job| job.status.is_terminal())
                    .map(|_| id.clone())
            })
            .collect();
        let excess = terminal_ids.len().saturating_sub(self.config.max_history);
        if excess == 0 {
            return;
        }
        for id in terminal_ids.into_iter().take(excess) {
            self.jobs.remove(&id);
            self.order.retain(|next| next != &id);
        }
    }
}

impl JobSummary {
    fn status_sort_key(&self) -> u8 {
        match self.status {
            JobStatus::Running | JobStatus::Cancelling => 0,
            JobStatus::Queued => 1,
            JobStatus::Succeeded | JobStatus::Failed | JobStatus::Cancelled => 2,
        }
    }
}

fn validate_id(label: &str, value: &str) -> Result<()> {
    validate_required(label, value)?;
    if value.len() > 160 {
        return Err(IrodoriError::validation(format!(
            "{label} must be 160 characters or fewer"
        )));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
    {
        return Err(IrodoriError::validation(format!(
            "{label} may only contain ASCII letters, numbers, '-', '_', '.', or ':'"
        )));
    }
    Ok(())
}

fn validate_required(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(IrodoriError::validation(format!("{label} is required")))
    } else {
        Ok(())
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> JobRuntime {
        JobRuntime::new(JobRuntimeConfig {
            max_concurrent_jobs: 1,
            max_history: 2,
        })
    }

    #[test]
    fn job_lifecycle_tracks_progress_logs_artifacts_and_success() {
        let runtime = runtime();
        let mut spec = JobSpec::new(JobKind::Export, "export result");
        spec.resumable = true;

        let queued = runtime.submit_with_id("job.export.1", spec).unwrap();
        assert_eq!(queued.status, JobStatus::Queued);
        assert_eq!(queued.logs.len(), 1);

        let started = runtime.start("job.export.1").unwrap();
        assert_eq!(started.status, JobStatus::Running);
        assert_eq!(started.attempt, 1);

        let progressed = runtime
            .update_progress("job.export.1", 50, Some(100), "rows", Some("half".into()))
            .unwrap();
        assert_eq!(progressed.progress.percent, Some(50));

        let checkpoint = JobCheckpoint::new(1, "row:50", r#"{"row":50}"#);
        assert_eq!(
            runtime
                .update_checkpoint("job.export.1", checkpoint.clone())
                .unwrap()
                .checkpoint,
            Some(checkpoint)
        );

        runtime
            .add_artifact(
                "job.export.1",
                JobArtifact {
                    id: "csv".into(),
                    name: "CSV".into(),
                    path: "/tmp/result.csv".into(),
                    media_type: Some("text/csv".into()),
                    size_bytes: Some(128),
                },
            )
            .unwrap();

        let done = runtime.succeed("job.export.1", "export finished").unwrap();
        assert_eq!(done.status, JobStatus::Succeeded);
        assert_eq!(done.progress.percent, Some(100));
        assert_eq!(done.artifacts.len(), 1);
        assert_eq!(runtime.list().history.len(), 1);
    }

    #[test]
    fn global_and_group_concurrency_limits_are_enforced() {
        let runtime = runtime();
        runtime
            .submit_with_id("job.one", JobSpec::new(JobKind::IndexBuild, "one"))
            .unwrap();
        runtime
            .submit_with_id("job.two", JobSpec::new(JobKind::IndexBuild, "two"))
            .unwrap();
        runtime.start("job.one").unwrap();
        let error = runtime.start("job.two").unwrap_err();
        assert_eq!(error.kind, crate::IrodoriErrorKind::Validation);

        let grouped = JobRuntime::new(JobRuntimeConfig {
            max_concurrent_jobs: 4,
            max_history: 10,
        });
        let mut spec = JobSpec::new(JobKind::Import, "a");
        spec.concurrency.group = "imports".into();
        spec.concurrency.max_concurrent_in_group = Some(1);
        grouped.submit_with_id("job.a", spec.clone()).unwrap();
        spec.title = "b".into();
        grouped.submit_with_id("job.b", spec).unwrap();
        grouped.start("job.a").unwrap();
        assert_eq!(
            grouped.start("job.b").unwrap_err().kind,
            crate::IrodoriErrorKind::Validation
        );
    }

    #[test]
    fn cancel_request_marks_running_jobs_cancelling_and_queued_jobs_cancelled() {
        let runtime = runtime();
        runtime
            .submit_with_id("job.running", JobSpec::new(JobKind::SourceScan, "running"))
            .unwrap();
        runtime.start("job.running").unwrap();
        let cancelling = runtime.request_cancel("job.running").unwrap();
        assert_eq!(cancelling.status, JobStatus::Cancelling);
        assert!(runtime.should_cancel("job.running"));
        let cancelled = runtime
            .mark_cancelled("job.running", "worker stopped")
            .unwrap();
        assert_eq!(cancelled.status, JobStatus::Cancelled);

        runtime
            .submit_with_id("job.queued", JobSpec::new(JobKind::SourceScan, "queued"))
            .unwrap();
        let queued = runtime.request_cancel("job.queued").unwrap();
        assert_eq!(queued.status, JobStatus::Cancelled);
    }

    #[test]
    fn failed_jobs_requeue_until_retry_policy_is_exhausted() {
        let runtime = runtime();
        let mut spec = JobSpec::new(JobKind::KnowledgeRefresh, "refresh");
        spec.retry = JobRetryPolicy::with_retries(2);
        runtime.submit_with_id("job.retry", spec).unwrap();
        runtime.start("job.retry").unwrap();

        let retrying = runtime
            .fail("job.retry", IrodoriError::from("network timed out"))
            .unwrap();
        assert_eq!(retrying.status, JobStatus::Queued);
        assert!(retrying.next_retry_at_ms.is_some());

        runtime.start("job.retry").unwrap();
        let failed = runtime
            .fail("job.retry", IrodoriError::from("network timed out again"))
            .unwrap();
        assert_eq!(failed.status, JobStatus::Failed);
        assert!(failed.finished_at_ms.is_some());
    }
}
