use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{IrodoriError, Result};

use super::{
    now_millis, validate_id, validate_required, JobArtifact, JobCheckpoint, JobList, JobLogEntry,
    JobLogLevel, JobProgress, JobRecord, JobSpec, JobStatus, JobSummary,
};

const DEFAULT_MAX_CONCURRENT_JOBS: u16 = 2;
const DEFAULT_MAX_HISTORY: usize = 200;

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
