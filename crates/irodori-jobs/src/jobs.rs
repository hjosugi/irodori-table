use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{IrodoriError, Result};

mod runtime;

pub use runtime::{JobRuntime, JobRuntimeConfig};
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

    pub(super) fn next_backoff_ms(&self, attempt: u16) -> u64 {
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
    pub(super) fn new(id: String, spec: JobSpec, now: u64) -> Self {
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

pub(super) fn validate_id(label: &str, value: &str) -> Result<()> {
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

pub(super) fn validate_required(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(IrodoriError::validation(format!("{label} is required")))
    } else {
        Ok(())
    }
}

pub(super) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests;
