use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::plan::DialTarget;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DiagnosticStageKind {
    Resolve,
    Auth,
    DirectTcp,
    Tls,
    LocalFile,
    SshTunnel,
    Socks5Proxy,
    HttpConnectProxy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DiagnosticStatus {
    Pending,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DiagnosticStage {
    pub name: String,
    pub kind: DiagnosticStageKind,
    pub status: DiagnosticStatus,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConnectionDiagnostics {
    pub target: DialTarget,
    pub stages: Vec<DiagnosticStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub first_failure: Option<usize>,
}

impl ConnectionDiagnostics {
    pub fn new(target: DialTarget) -> Self {
        Self {
            target,
            stages: Vec::new(),
            first_failure: None,
        }
    }

    pub fn push(
        &mut self,
        name: impl Into<String>,
        kind: DiagnosticStageKind,
        status: DiagnosticStatus,
        duration_ms: u64,
        message: Option<String>,
    ) {
        let failed = status == DiagnosticStatus::Failed;
        self.stages.push(DiagnosticStage {
            name: name.into(),
            kind,
            status,
            duration_ms,
            message,
        });
        if failed && self.first_failure.is_none() {
            self.first_failure = Some(self.stages.len() - 1);
        }
    }

    pub fn succeeded(&self) -> bool {
        self.first_failure.is_none()
            && self
                .stages
                .iter()
                .all(|stage| stage.status != DiagnosticStatus::Failed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirectTcpProbe {
    timeout: Duration,
}

impl DirectTcpProbe {
    pub fn new(timeout: Duration) -> Self {
        Self { timeout }
    }

    pub fn probe(&self, target: &DialTarget) -> ConnectionDiagnostics {
        let mut diagnostics = ConnectionDiagnostics::new(target.clone());
        let DialTarget::Tcp { host, port, tls } = target else {
            diagnostics.push(
                "local file",
                DiagnosticStageKind::LocalFile,
                DiagnosticStatus::Succeeded,
                0,
                Some("local file target does not require TCP probing".to_string()),
            );
            return diagnostics;
        };

        let resolve_started = Instant::now();
        let addrs = (host.as_str(), *port)
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>());
        let resolve_ms = elapsed_ms(resolve_started);
        let addrs = match addrs {
            Ok(addrs) if !addrs.is_empty() => {
                diagnostics.push(
                    "resolve target",
                    DiagnosticStageKind::Resolve,
                    DiagnosticStatus::Succeeded,
                    resolve_ms,
                    Some(format!("{} address(es)", addrs.len())),
                );
                addrs
            }
            Ok(_) => {
                diagnostics.push(
                    "resolve target",
                    DiagnosticStageKind::Resolve,
                    DiagnosticStatus::Failed,
                    resolve_ms,
                    Some("no addresses returned".to_string()),
                );
                return diagnostics;
            }
            Err(error) => {
                diagnostics.push(
                    "resolve target",
                    DiagnosticStageKind::Resolve,
                    DiagnosticStatus::Failed,
                    resolve_ms,
                    Some(error.to_string()),
                );
                return diagnostics;
            }
        };

        let connect_started = Instant::now();
        let mut last_error = None;
        for addr in addrs {
            match TcpStream::connect_timeout(&addr, self.timeout) {
                Ok(_) => {
                    diagnostics.push(
                        "direct tcp",
                        DiagnosticStageKind::DirectTcp,
                        DiagnosticStatus::Succeeded,
                        elapsed_ms(connect_started),
                        Some(addr.to_string()),
                    );
                    if *tls {
                        diagnostics.push(
                            "tls handshake",
                            DiagnosticStageKind::Tls,
                            DiagnosticStatus::Skipped,
                            0,
                            Some("TLS is negotiated by the database driver".to_string()),
                        );
                    }
                    return diagnostics;
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                }
            }
        }

        diagnostics.push(
            "direct tcp",
            DiagnosticStageKind::DirectTcp,
            DiagnosticStatus::Failed,
            elapsed_ms(connect_started),
            last_error,
        );
        diagnostics
    }
}

impl Default for DirectTcpProbe {
    fn default() -> Self {
        Self::new(Duration::from_secs(3))
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}
