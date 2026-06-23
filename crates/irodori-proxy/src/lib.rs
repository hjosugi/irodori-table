//! Direct, SSH, SOCKS, HTTP CONNECT, and multi-hop transport primitives.

use std::collections::BTreeMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use irodori_core::{
    DirectTransport, IrodoriError, IrodoriErrorKind, LocalFileTransport, ProxyChainHop,
    ProxyChainTransport, ProxyHopConfig, ProxyTransport, Result, SshTunnelTransport,
    TransportConfig,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const CRATE_NAME: &str = "irodori-proxy";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DialTarget {
    Tcp { host: String, port: u16, tls: bool },
    LocalFile { path: String },
}

impl DialTarget {
    fn tcp(host: impl Into<String>, port: u16, tls: bool) -> Self {
        Self::Tcp {
            host: host.into(),
            port,
            tls,
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Tcp { host, port, tls } => {
                let scheme = if *tls { "tcp+tls" } else { "tcp" };
                format!("{scheme}://{host}:{port}")
            }
            Self::LocalFile { path } => format!("file://{path}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum TransportStepKind {
    Resolve,
    Auth,
    DirectTcp,
    Tls,
    LocalFile,
    SshTunnel,
    Socks5Proxy,
    HttpConnectProxy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TransportStep {
    pub name: String,
    pub kind: TransportStepKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TransportPlan {
    pub target: DialTarget,
    pub steps: Vec<TransportStep>,
}

impl TransportPlan {
    pub fn from_config(config: &TransportConfig) -> Result<Self> {
        config.validate()?;
        match config {
            TransportConfig::Direct(config) => plan_direct(config),
            TransportConfig::LocalFile(config) => Ok(plan_local_file(config)),
            TransportConfig::SshTunnel(config) => Ok(plan_ssh_tunnel(config)),
            TransportConfig::Socks5Proxy(config) => {
                plan_single_proxy(TransportStepKind::Socks5Proxy, "socks5 proxy", config)
            }
            TransportConfig::HttpConnectProxy(config) => plan_single_proxy(
                TransportStepKind::HttpConnectProxy,
                "http connect proxy",
                config,
            ),
            TransportConfig::Chain(config) => Ok(plan_chain(config)),
        }
    }

    pub fn diagnostics_template(&self) -> ConnectionDiagnostics {
        ConnectionDiagnostics {
            target: self.target.clone(),
            stages: self
                .steps
                .iter()
                .map(|step| DiagnosticStage {
                    name: step.name.clone(),
                    kind: stage_kind(step.kind),
                    status: DiagnosticStatus::Pending,
                    duration_ms: 0,
                    message: step.endpoint.clone(),
                })
                .collect(),
            first_failure: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct HopRegistry {
    hops: BTreeMap<String, ProxyHopConfig>,
}

impl HopRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, name: impl Into<String>, config: ProxyHopConfig) -> Result<()> {
        let name = name.into();
        ProxyChainHop::new(name.clone(), config.clone()).validate()?;
        self.hops.insert(name, config);
        Ok(())
    }

    pub fn resolve_chain(
        &self,
        target_host: impl Into<String>,
        target_port: u16,
        tls: bool,
        hop_names: &[String],
    ) -> Result<ProxyChainTransport> {
        let hops = hop_names
            .iter()
            .map(|name| {
                let config = self.hops.get(name).cloned().ok_or_else(|| {
                    IrodoriError::new(
                        IrodoriErrorKind::NotFound,
                        format!("proxy hop `{name}` is not registered"),
                    )
                })?;
                Ok(ProxyChainHop::new(name.clone(), config))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut chain = ProxyChainTransport::new(target_host, target_port, hops);
        chain.tls = tls;
        chain.validate()?;
        Ok(chain)
    }
}

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

fn plan_direct(config: &DirectTransport) -> Result<TransportPlan> {
    let port = config
        .port
        .ok_or_else(|| IrodoriError::validation("direct transport port is required"))?;
    let target = DialTarget::tcp(config.host.clone(), port, config.tls);
    let mut steps = vec![
        step(
            "resolve target",
            TransportStepKind::Resolve,
            endpoint(&config.host, port),
        ),
        step(
            "direct tcp",
            TransportStepKind::DirectTcp,
            endpoint(&config.host, port),
        ),
    ];
    if config.tls {
        steps.push(step("tls handshake", TransportStepKind::Tls, None));
    }
    Ok(TransportPlan { target, steps })
}

fn plan_local_file(config: &LocalFileTransport) -> TransportPlan {
    TransportPlan {
        target: DialTarget::LocalFile {
            path: config.path.clone(),
        },
        steps: vec![step(
            "open local file",
            TransportStepKind::LocalFile,
            Some(config.path.clone()),
        )],
    }
}

fn plan_ssh_tunnel(config: &SshTunnelTransport) -> TransportPlan {
    let mut steps = vec![
        step(
            "resolve ssh host",
            TransportStepKind::Resolve,
            endpoint(&config.ssh_host, config.ssh_port),
        ),
        step("ssh auth", TransportStepKind::Auth, None),
        step(
            config.name.as_deref().unwrap_or("ssh tunnel"),
            TransportStepKind::SshTunnel,
            endpoint(&config.ssh_host, config.ssh_port),
        ),
        step(
            "forward target",
            TransportStepKind::DirectTcp,
            endpoint(&config.target_host, config.target_port),
        ),
    ];
    if config.strict_host_key {
        steps.push(step("ssh host key", TransportStepKind::Auth, None));
    }
    TransportPlan {
        target: DialTarget::tcp(config.target_host.clone(), config.target_port, false),
        steps,
    }
}

fn plan_single_proxy(
    kind: TransportStepKind,
    label: &str,
    config: &ProxyTransport,
) -> Result<TransportPlan> {
    let target_host = config
        .target_host
        .as_ref()
        .ok_or_else(|| IrodoriError::validation("proxy target host is required"))?;
    let target_port = config
        .target_port
        .ok_or_else(|| IrodoriError::validation("proxy target port is required"))?;
    let mut steps = vec![step(
        "resolve proxy",
        TransportStepKind::Resolve,
        endpoint(&config.host, config.port),
    )];
    if config.auth.is_some() {
        steps.push(step("proxy auth", TransportStepKind::Auth, None));
    }
    steps.push(step(
        config.name.as_deref().unwrap_or(label),
        kind,
        endpoint(&config.host, config.port),
    ));
    steps.push(step(
        "forward target",
        TransportStepKind::DirectTcp,
        endpoint(target_host, target_port),
    ));
    if config.tls {
        steps.push(step("tls handshake", TransportStepKind::Tls, None));
    }
    Ok(TransportPlan {
        target: DialTarget::tcp(target_host.clone(), target_port, config.tls),
        steps,
    })
}

fn plan_chain(config: &ProxyChainTransport) -> TransportPlan {
    let mut steps = Vec::new();
    for hop in &config.hops {
        match &hop.config {
            ProxyHopConfig::Ssh(config) => {
                steps.push(step(
                    format!("resolve {}", hop.name),
                    TransportStepKind::Resolve,
                    endpoint(&config.ssh_host, config.ssh_port),
                ));
                steps.push(step(
                    format!("auth {}", hop.name),
                    TransportStepKind::Auth,
                    None,
                ));
                steps.push(step(
                    hop.name.clone(),
                    TransportStepKind::SshTunnel,
                    endpoint(&config.ssh_host, config.ssh_port),
                ));
            }
            ProxyHopConfig::Socks5(config) => push_proxy_hop_steps(
                &mut steps,
                &hop.name,
                TransportStepKind::Socks5Proxy,
                config,
            ),
            ProxyHopConfig::HttpConnect(config) => push_proxy_hop_steps(
                &mut steps,
                &hop.name,
                TransportStepKind::HttpConnectProxy,
                config,
            ),
        }
    }
    steps.push(step(
        "forward target",
        TransportStepKind::DirectTcp,
        endpoint(&config.target_host, config.target_port),
    ));
    if config.tls {
        steps.push(step("tls handshake", TransportStepKind::Tls, None));
    }

    TransportPlan {
        target: DialTarget::tcp(config.target_host.clone(), config.target_port, config.tls),
        steps,
    }
}

fn push_proxy_hop_steps(
    steps: &mut Vec<TransportStep>,
    name: &str,
    kind: TransportStepKind,
    config: &ProxyTransport,
) {
    steps.push(step(
        format!("resolve {name}"),
        TransportStepKind::Resolve,
        endpoint(&config.host, config.port),
    ));
    if config.auth.is_some() {
        steps.push(step(format!("auth {name}"), TransportStepKind::Auth, None));
    }
    steps.push(step(name, kind, endpoint(&config.host, config.port)));
}

fn step(
    name: impl Into<String>,
    kind: TransportStepKind,
    endpoint: Option<String>,
) -> TransportStep {
    TransportStep {
        name: name.into(),
        kind,
        endpoint,
    }
}

fn endpoint(host: &str, port: u16) -> Option<String> {
    Some(format!("{host}:{port}"))
}

fn stage_kind(kind: TransportStepKind) -> DiagnosticStageKind {
    match kind {
        TransportStepKind::Resolve => DiagnosticStageKind::Resolve,
        TransportStepKind::Auth => DiagnosticStageKind::Auth,
        TransportStepKind::DirectTcp => DiagnosticStageKind::DirectTcp,
        TransportStepKind::Tls => DiagnosticStageKind::Tls,
        TransportStepKind::LocalFile => DiagnosticStageKind::LocalFile,
        TransportStepKind::SshTunnel => DiagnosticStageKind::SshTunnel,
        TransportStepKind::Socks5Proxy => DiagnosticStageKind::Socks5Proxy,
        TransportStepKind::HttpConnectProxy => DiagnosticStageKind::HttpConnectProxy,
    }
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use irodori_core::{ProxyAuthConfig, SecretRef, SshAuthConfig, SshProxyHop};
    use std::net::TcpListener;

    #[test]
    fn transport_plan_includes_ssh_auth_and_forwarding_steps() {
        let config = TransportConfig::SshTunnel(SshTunnelTransport {
            auth: SshAuthConfig::PrivateKey {
                private_key: SecretRef::new("keychain:prod/private-key"),
                passphrase: Some(SecretRef::new("keychain:prod/passphrase")),
            },
            ..SshTunnelTransport::new("bastion.internal", "deploy", "db.internal", 5432)
        });

        let plan = TransportPlan::from_config(&config).unwrap();
        assert_eq!(plan.target, DialTarget::tcp("db.internal", 5432, false));
        assert!(plan
            .steps
            .iter()
            .any(|step| step.kind == TransportStepKind::SshTunnel));
        assert!(plan
            .steps
            .iter()
            .any(|step| step.kind == TransportStepKind::Auth));
    }

    #[test]
    fn single_proxy_plan_requires_target_and_marks_proxy_auth() {
        let config = TransportConfig::HttpConnectProxy(ProxyTransport {
            auth: Some(ProxyAuthConfig {
                username: "u".to_string(),
                password: SecretRef::new("keychain:proxy/password"),
            }),
            tls: true,
            ..ProxyTransport::new("proxy.internal", 8080).with_target("db.internal", 5432)
        });

        let plan = TransportPlan::from_config(&config).unwrap();
        assert_eq!(plan.target, DialTarget::tcp("db.internal", 5432, true));
        assert!(plan
            .steps
            .iter()
            .any(|step| step.kind == TransportStepKind::HttpConnectProxy));
        assert!(plan.steps.iter().any(|step| step.name == "proxy auth"));
    }

    #[test]
    fn registry_resolves_reusable_named_hops() {
        let mut registry = HopRegistry::new();
        registry
            .insert(
                "bastion",
                ProxyHopConfig::Ssh(SshProxyHop::new("bastion.internal", "deploy")),
            )
            .unwrap();
        registry
            .insert(
                "socks",
                ProxyHopConfig::Socks5(ProxyTransport::new("socks.internal", 1080)),
            )
            .unwrap();

        let chain = registry
            .resolve_chain(
                "db.internal",
                5432,
                false,
                &["bastion".to_string(), "socks".to_string()],
            )
            .unwrap();
        assert_eq!(chain.hops.len(), 2);

        let error = registry
            .resolve_chain("db.internal", 5432, false, &["missing".to_string()])
            .unwrap_err();
        assert_eq!(error.kind, IrodoriErrorKind::NotFound);
    }

    #[test]
    fn diagnostics_track_first_failure() {
        let mut diagnostics = ConnectionDiagnostics::new(DialTarget::tcp("localhost", 1, false));
        diagnostics.push(
            "resolve target",
            DiagnosticStageKind::Resolve,
            DiagnosticStatus::Succeeded,
            1,
            None,
        );
        diagnostics.push(
            "direct tcp",
            DiagnosticStageKind::DirectTcp,
            DiagnosticStatus::Failed,
            2,
            Some("refused".to_string()),
        );
        diagnostics.push(
            "tls",
            DiagnosticStageKind::Tls,
            DiagnosticStatus::Skipped,
            0,
            None,
        );

        assert_eq!(diagnostics.first_failure, Some(1));
        assert!(!diagnostics.succeeded());
    }

    #[test]
    fn direct_tcp_probe_succeeds_against_local_listener() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let diagnostics = DirectTcpProbe::new(Duration::from_millis(250)).probe(&DialTarget::tcp(
            "127.0.0.1",
            port,
            false,
        ));

        assert!(diagnostics.succeeded(), "{diagnostics:?}");
        assert!(diagnostics
            .stages
            .iter()
            .any(|stage| stage.kind == DiagnosticStageKind::DirectTcp));
    }
}
