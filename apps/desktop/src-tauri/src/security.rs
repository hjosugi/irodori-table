use std::collections::BTreeMap;

use irodori_core::{
    AuditEventKind, AuditLog, IrodoriError, PrivacyMode, RedactedExport, RedactionReport, Redactor,
    Result as IrodoriResult, SecretRef, TransportConfig,
};
use irodori_proxy::{ConnectionDiagnostics, DialTarget, DirectTcpProbe, TransportPlan};
use irodori_secure_store::{
    OsKeychainStore, SecretPurpose, SecretValue, SecureStore, DEFAULT_SERVICE,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DesktopSecretPurpose {
    Password,
    Token,
    PrivateKey,
    PrivateKeyPassphrase,
    SshPassword,
    ProxyPassword,
}

impl From<DesktopSecretPurpose> for SecretPurpose {
    fn from(value: DesktopSecretPurpose) -> Self {
        match value {
            DesktopSecretPurpose::Password => Self::Password,
            DesktopSecretPurpose::Token => Self::Token,
            DesktopSecretPurpose::PrivateKey => Self::PrivateKey,
            DesktopSecretPurpose::PrivateKeyPassphrase => Self::PrivateKeyPassphrase,
            DesktopSecretPurpose::SshPassword => Self::SshPassword,
            DesktopSecretPurpose::ProxyPassword => Self::ProxyPassword,
        }
    }
}

pub struct SecurityState {
    audit: Mutex<AuditLog>,
    privacy_mode: Mutex<PrivacyMode>,
    store: OsKeychainStore,
}

impl Default for SecurityState {
    fn default() -> Self {
        Self {
            audit: Mutex::new(AuditLog::default()),
            privacy_mode: Mutex::new(PrivacyMode::Normal),
            store: OsKeychainStore::default(),
        }
    }
}

impl SecurityState {
    pub async fn privacy_mode(&self) -> PrivacyMode {
        *self.privacy_mode.lock().await
    }

    pub async fn set_privacy_mode(&self, mode: PrivacyMode) -> PrivacyMode {
        *self.privacy_mode.lock().await = mode;
        mode
    }

    pub async fn record(
        &self,
        kind: AuditEventKind,
        connection_id: Option<String>,
        summary: impl Into<String>,
        fields: BTreeMap<String, String>,
    ) {
        let redactor = Redactor::new(self.privacy_mode().await);
        let summary = redactor.redact(summary.into()).text;
        let fields = fields
            .into_iter()
            .map(|(key, value)| (key, redactor.redact(value).text))
            .collect();
        self.audit
            .lock()
            .await
            .record_with_fields(kind, connection_id, summary, fields);
    }

    async fn export_audit(&self) -> RedactedExport {
        let redactor = Redactor::new(self.privacy_mode().await);
        self.audit.lock().await.export_redacted(&redactor)
    }
}

#[tauri::command]
pub async fn security_get_privacy_mode(
    state: tauri::State<'_, SecurityState>,
) -> IrodoriResult<PrivacyMode> {
    Ok(state.privacy_mode().await)
}

#[tauri::command]
pub async fn security_set_privacy_mode(
    state: tauri::State<'_, SecurityState>,
    mode: PrivacyMode,
) -> IrodoriResult<PrivacyMode> {
    let mode = state.set_privacy_mode(mode).await;
    state
        .record(
            AuditEventKind::Export,
            None,
            format!("privacy mode set to {mode:?}"),
            BTreeMap::new(),
        )
        .await;
    Ok(mode)
}

#[tauri::command]
pub async fn security_redact_text(
    state: tauri::State<'_, SecurityState>,
    text: String,
) -> IrodoriResult<RedactionReport> {
    Ok(Redactor::new(state.privacy_mode().await).redact(text))
}

#[tauri::command]
pub async fn security_export_audit(
    state: tauri::State<'_, SecurityState>,
) -> IrodoriResult<RedactedExport> {
    state
        .record(
            AuditEventKind::Export,
            None,
            "audit log exported",
            BTreeMap::new(),
        )
        .await;
    Ok(state.export_audit().await)
}

#[tauri::command]
pub async fn security_store_secret(
    state: tauri::State<'_, SecurityState>,
    connection_id: String,
    purpose: DesktopSecretPurpose,
    value: String,
) -> IrodoriResult<SecretRef> {
    let secret = SecretValue::new(&value)?;
    let handle = state
        .store
        .put_connection_secret(&connection_id, purpose.into(), secret)?;
    state
        .record(
            AuditEventKind::SecretWrite,
            Some(connection_id),
            format!(
                "stored {} secret in {DEFAULT_SERVICE}",
                purpose_label(purpose)
            ),
            BTreeMap::from([("handle".to_string(), handle.handle.clone())]),
        )
        .await;
    Ok(handle)
}

#[tauri::command]
pub async fn security_delete_secret(
    state: tauri::State<'_, SecurityState>,
    secret: SecretRef,
) -> IrodoriResult<()> {
    state.store.delete(&secret)?;
    state
        .record(
            AuditEventKind::SecretDelete,
            None,
            "deleted stored secret",
            BTreeMap::from([("handle".to_string(), secret.handle)]),
        )
        .await;
    Ok(())
}

#[tauri::command]
pub async fn network_transport_plan(transport: TransportConfig) -> IrodoriResult<TransportPlan> {
    TransportPlan::from_config(&transport)
}

#[tauri::command]
pub async fn network_diagnose_transport(
    state: tauri::State<'_, SecurityState>,
    transport: TransportConfig,
) -> IrodoriResult<ConnectionDiagnostics> {
    let diagnostics = diagnose_transport(&transport)?;
    state
        .record(
            AuditEventKind::DiagnosticsRun,
            None,
            format!("network diagnostics for {}", diagnostics.target.label()),
            BTreeMap::from([(
                "firstFailure".to_string(),
                diagnostics
                    .first_failure
                    .map(|index| index.to_string())
                    .unwrap_or_else(|| "none".to_string()),
            )]),
        )
        .await;
    Ok(diagnostics)
}

pub fn diagnose_transport(transport: &TransportConfig) -> IrodoriResult<ConnectionDiagnostics> {
    let plan = TransportPlan::from_config(transport)?;
    match transport {
        TransportConfig::Direct(_) => Ok(DirectTcpProbe::default().probe(&plan.target)),
        TransportConfig::LocalFile(_) => {
            let mut diagnostics = plan.diagnostics_template();
            for stage in &mut diagnostics.stages {
                stage.status = irodori_proxy::DiagnosticStatus::Succeeded;
                stage.message = Some("local file target does not require network probing".into());
            }
            Ok(diagnostics)
        }
        TransportConfig::SshTunnel(_)
        | TransportConfig::Socks5Proxy(_)
        | TransportConfig::HttpConnectProxy(_)
        | TransportConfig::Chain(_) => {
            let mut diagnostics = plan.diagnostics_template();
            for stage in &mut diagnostics.stages {
                stage.status = irodori_proxy::DiagnosticStatus::Skipped;
                stage.message =
                    Some("runtime dialer integration for SSH/proxy transports is pending".into());
            }
            Ok(diagnostics)
        }
    }
}

fn purpose_label(purpose: DesktopSecretPurpose) -> &'static str {
    match purpose {
        DesktopSecretPurpose::Password => "password",
        DesktopSecretPurpose::Token => "token",
        DesktopSecretPurpose::PrivateKey => "private key",
        DesktopSecretPurpose::PrivateKeyPassphrase => "private key passphrase",
        DesktopSecretPurpose::SshPassword => "ssh password",
        DesktopSecretPurpose::ProxyPassword => "proxy password",
    }
}

#[allow(dead_code)]
fn unsupported_transport_error(target: &DialTarget) -> IrodoriError {
    IrodoriError::transport(format!(
        "{} cannot be probed without a runtime dialer",
        target.label()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use irodori_core::{DirectTransport, ProxyChainHop, ProxyChainTransport, ProxyHopConfig};
    use irodori_proxy::DiagnosticStatus;

    #[tokio::test]
    async fn audit_export_redacts_under_private_mode() {
        let state = SecurityState::default();
        state.set_privacy_mode(PrivacyMode::Private).await;
        state
            .record(
                AuditEventKind::QueryRun,
                Some("prod".to_string()),
                "select * from users where email = 'person@example.com'",
                BTreeMap::new(),
            )
            .await;

        let export = state.export_audit().await;
        assert!(!export.content.contains("person@example.com"));
        assert!(export.content.contains("[redacted]"));
    }

    #[test]
    fn non_direct_diagnostics_are_explicitly_skipped() {
        let diagnostics = diagnose_transport(&TransportConfig::Chain(ProxyChainTransport::new(
            "db.internal",
            5432,
            vec![
                ProxyChainHop::new(
                    "a",
                    ProxyHopConfig::Socks5(irodori_core::ProxyTransport::new(
                        "proxy-a.internal",
                        1080,
                    )),
                ),
                ProxyChainHop::new(
                    "b",
                    ProxyHopConfig::HttpConnect(irodori_core::ProxyTransport::new(
                        "proxy-b.internal",
                        8080,
                    )),
                ),
            ],
        )))
        .unwrap();

        assert!(diagnostics
            .stages
            .iter()
            .all(|stage| stage.status == DiagnosticStatus::Skipped));
    }

    #[test]
    fn direct_diagnostics_requires_a_port() {
        let error = diagnose_transport(&TransportConfig::Direct(DirectTransport::new(
            "localhost",
            None,
        )))
        .unwrap_err();
        assert_eq!(error.kind, irodori_core::IrodoriErrorKind::Validation);
    }
}
