//! Core workspace, command, error, and shared domain types for Irodori Table.

pub mod batch;
pub mod connection;
pub mod jobs;
pub mod security;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use batch::{run_job, BatchOutcome, BatchResult, JobContext};
pub use connection::{
    AuthConfig, ConnectionProfile, ConnectionProfileExport, DirectTransport, LocalFileTransport,
    PortableAuthConfig, PortableConnectionProfile, PortableProxyAuthConfig, PortableProxyChainHop,
    PortableProxyChainTransport, PortableProxyHopConfig, PortableProxyTransport,
    PortableSshAuthConfig, PortableSshProxyHop, PortableSshTunnelTransport,
    PortableTransportConfig, ProxyAuthConfig, ProxyChainHop, ProxyChainTransport, ProxyHopConfig,
    ProxyTransport, SecretRef, SecretSlot, SecretSlotPurpose, SourceFamily, SourceKind,
    SshAuthConfig, SshProxyHop, SshTunnelTransport, TransportConfig,
    CONNECTION_PROFILE_SCHEMA_VERSION,
};
pub use jobs::{
    JobArtifact, JobCheckpoint, JobConcurrencyPolicy, JobKind, JobList, JobLogEntry, JobLogLevel,
    JobProgress, JobRecord, JobResourceBudget, JobRetryPolicy, JobRuntime, JobRuntimeConfig,
    JobSpec, JobStatus, JobSummary,
};
pub use security::{
    AuditEvent, AuditEventKind, AuditLog, PrivacyMode, RedactedExport, RedactionReport, Redactor,
};

pub const CRATE_NAME: &str = "irodori-core";

pub type Result<T> = std::result::Result<T, IrodoriError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum IrodoriErrorKind {
    Validation,
    Unsupported,
    NotFound,
    Connection,
    Query,
    Metadata,
    Edit,
    Timeout,
    Cancelled,
    Transport,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct IrodoriError {
    pub kind: IrodoriErrorKind,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub code: Option<String>,
    #[serde(default)]
    pub retryable: bool,
}

impl IrodoriError {
    pub fn new(kind: IrodoriErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            code: None,
            retryable: false,
        }
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Validation, message)
    }

    pub fn transport(message: impl Into<String>) -> Self {
        Self::new(IrodoriErrorKind::Transport, message).retryable(true)
    }

    pub fn from_message(message: impl Into<String>) -> Self {
        let message = message.into();
        let kind = classify_message(&message);
        let retryable = matches!(
            kind,
            IrodoriErrorKind::Connection | IrodoriErrorKind::Timeout | IrodoriErrorKind::Transport
        );
        Self {
            kind,
            message,
            code: None,
            retryable,
        }
    }
}

impl std::fmt::Display for IrodoriError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for IrodoriError {}

impl From<String> for IrodoriError {
    fn from(value: String) -> Self {
        Self::from_message(value)
    }
}

impl From<&str> for IrodoriError {
    fn from(value: &str) -> Self {
        Self::from_message(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CommandResult<T> {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub data: Option<T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<IrodoriError>,
}

impl<T> CommandResult<T> {
    pub fn success(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn failure(error: IrodoriError) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(error),
        }
    }
}

fn classify_message(message: &str) -> IrodoriErrorKind {
    let lower = message.to_ascii_lowercase();
    if lower.contains("timed out") {
        IrodoriErrorKind::Timeout
    } else if lower.contains("cancelled") {
        IrodoriErrorKind::Cancelled
    } else if lower.contains("not supported")
        || lower.contains("does not have a production connector")
        || lower.contains("recognized but")
    {
        IrodoriErrorKind::Unsupported
    } else if lower.starts_with("no open connection") {
        IrodoriErrorKind::NotFound
    } else if lower.contains("connect failed") || lower.contains("bad connection string") {
        IrodoriErrorKind::Connection
    } else if lower.contains("metadata") {
        IrodoriErrorKind::Metadata
    } else if lower.contains("edit")
        || lower.contains("insert")
        || lower.contains("update")
        || lower.contains("delete")
        || lower.contains("commit failed")
        || lower.contains("begin failed")
    {
        IrodoriErrorKind::Edit
    } else if lower.contains("query") {
        IrodoriErrorKind::Query
    } else if lower.contains("required")
        || lower.contains("must be")
        || lower.contains("cannot")
        || lower.contains("invalid")
        || lower.contains("empty")
        || lower.contains("needs")
    {
        IrodoriErrorKind::Validation
    } else {
        IrodoriErrorKind::Internal
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn error_serializes_as_camel_case() {
        let error = IrodoriError::new(IrodoriErrorKind::NotFound, "no open connection: demo")
            .with_code("db.notFound");

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "kind": "notFound",
                "message": "no open connection: demo",
                "code": "db.notFound",
                "retryable": false
            })
        );
    }

    #[test]
    fn command_result_envelope_serializes_success_and_failure() {
        assert_eq!(
            serde_json::to_value(CommandResult::success(42_u32)).unwrap(),
            json!({
                "ok": true,
                "data": 42
            })
        );

        assert_eq!(
            serde_json::to_value(CommandResult::<u32>::failure(IrodoriError::validation(
                "connection id is required"
            )))
            .unwrap(),
            json!({
                "ok": false,
                "error": {
                    "kind": "validation",
                    "message": "connection id is required",
                    "retryable": false
                }
            })
        );
    }

    #[test]
    fn string_errors_are_classified_for_command_boundaries() {
        assert_eq!(
            IrodoriError::from("query timed out after 5ms").kind,
            IrodoriErrorKind::Timeout
        );
        assert_eq!(
            IrodoriError::from("no open connection: local").kind,
            IrodoriErrorKind::NotFound
        );
        assert_eq!(
            IrodoriError::from("connect failed: refused").kind,
            IrodoriErrorKind::Connection
        );
    }
}
