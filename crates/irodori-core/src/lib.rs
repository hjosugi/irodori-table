//! Core workspace, command, and shared domain types for Irodori Table.
//!
//! The error vocabulary now lives in `irodori-error` and the job/batch runtime
//! in `irodori-jobs`; both are re-exported here so existing
//! `irodori_core::{IrodoriError, JobKind, ...}` paths keep working.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use irodori_connection::{
    AuthConfig, ConnectionProfile, ConnectionProfileExport, DirectTransport, LocalFileTransport,
    PortableAuthConfig, PortableConnectionProfile, PortableProxyAuthConfig, PortableProxyChainHop,
    PortableProxyChainTransport, PortableProxyHopConfig, PortableProxyTransport,
    PortableSshAuthConfig, PortableSshProxyHop, PortableSshTunnelTransport,
    PortableTransportConfig, ProxyAuthConfig, ProxyChainHop, ProxyChainTransport, ProxyHopConfig,
    ProxyTransport, SecretRef, SecretSlot, SecretSlotPurpose, SourceFamily, SourceKind,
    SshAuthConfig, SshProxyHop, SshTunnelTransport, TransportConfig,
    CONNECTION_PROFILE_SCHEMA_VERSION,
};
pub use irodori_error::{IrodoriError, IrodoriErrorKind, Result};
pub use irodori_jobs::{
    run_job, BatchOutcome, BatchResult, JobArtifact, JobCheckpoint, JobConcurrencyPolicy,
    JobContext, JobKind, JobList, JobLogEntry, JobLogLevel, JobProgress, JobRecord,
    JobResourceBudget, JobRetryPolicy, JobRuntime, JobRuntimeConfig, JobSpec, JobStatus,
    JobSummary,
};
pub use irodori_security::{
    AuditEvent, AuditEventKind, AuditLog, PrivacyMode, RedactedExport, RedactionReport, Redactor,
};

pub const CRATE_NAME: &str = "irodori-core";

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
}
