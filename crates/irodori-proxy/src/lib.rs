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

// ---- Phase 5: Network and Security Resolved Transport Configs ----

#[derive(Debug, Clone)]
pub enum ResolvedSshAuth {
    Agent,
    Password(String),
    PrivateKey {
        private_key: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct ResolvedProxyAuth {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone)]
pub struct ResolvedSshTunnel {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub username: String,
    pub auth: ResolvedSshAuth,
    pub target_host: String,
    pub target_port: u16,
    pub strict_host_key: bool,
    pub host_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedProxy {
    pub host: String,
    pub port: u16,
    pub auth: Option<ResolvedProxyAuth>,
    pub target_host: String,
    pub target_port: u16,
    pub tls: bool,
}

#[derive(Debug, Clone)]
pub enum ResolvedProxyHopConfig {
    Ssh {
        ssh_host: String,
        ssh_port: u16,
        username: String,
        auth: ResolvedSshAuth,
        strict_host_key: bool,
        host_key: Option<String>,
    },
    Socks5 {
        host: String,
        port: u16,
        auth: Option<ResolvedProxyAuth>,
    },
    HttpConnect {
        host: String,
        port: u16,
        auth: Option<ResolvedProxyAuth>,
    },
}

#[derive(Debug, Clone)]
pub struct ResolvedProxyChainHop {
    pub name: String,
    pub config: ResolvedProxyHopConfig,
}

#[derive(Debug, Clone)]
pub struct ResolvedProxyChain {
    pub target_host: String,
    pub target_port: u16,
    pub tls: bool,
    pub hops: Vec<ResolvedProxyChainHop>,
}

#[derive(Debug, Clone)]
pub enum ResolvedTransport {
    SshTunnel(ResolvedSshTunnel),
    Socks5Proxy(ResolvedProxy),
    HttpConnectProxy(ResolvedProxy),
    Chain(ResolvedProxyChain),
}

// ---- Network Primitives and Protocols ----

fn base64_encode(input: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        match chunk.len() {
            3 => {
                let b = ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32);
                result.push(CHARSET[((b >> 18) & 0x3f) as usize] as char);
                result.push(CHARSET[((b >> 12) & 0x3f) as usize] as char);
                result.push(CHARSET[((b >> 6) & 0x3f) as usize] as char);
                result.push(CHARSET[(b & 0x3f) as usize] as char);
            }
            2 => {
                let b = ((chunk[0] as u32) << 10) | ((chunk[1] as u32) << 2);
                result.push(CHARSET[((b >> 12) & 0x3f) as usize] as char);
                result.push(CHARSET[((b >> 6) & 0x3f) as usize] as char);
                result.push(CHARSET[(b & 0x3f) as usize] as char);
                result.push('=');
            }
            1 => {
                let b = (chunk[0] as u32) << 4;
                result.push(CHARSET[((b >> 6) & 0x3f) as usize] as char);
                result.push(CHARSET[(b & 0x3f) as usize] as char);
                result.push('=');
                result.push('=');
            }
            _ => unreachable!(),
        }
    }
    result
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub fn socks5_handshake_sync<S>(
    mut stream: S,
    host: &str,
    port: u16,
    auth: Option<(&str, &str)>,
) -> std::result::Result<S, String>
where
    S: std::io::Read + std::io::Write,
{
    // 1. Greeting
    let mut greeting = vec![0x05];
    if auth.is_some() {
        greeting.push(2);
        greeting.push(0x00); // No authentication
        greeting.push(0x02); // Username/password
    } else {
        greeting.push(1);
        greeting.push(0x00);
    }
    stream
        .write_all(&greeting)
        .map_err(|e| format!("socks5 greeting write failed: {e}"))?;

    let mut resp = [0u8; 2];
    stream
        .read_exact(&mut resp)
        .map_err(|e| format!("socks5 greeting read failed: {e}"))?;
    if resp[0] != 0x05 {
        return Err(format!("invalid socks5 version: {}", resp[0]));
    }

    match resp[1] {
        0x00 => {}
        0x02 => {
            let (user, pass) = auth.ok_or_else(|| "socks5 credentials missing".to_string())?;
            if user.len() > 255 || pass.len() > 255 {
                return Err("socks5 username or password too long".into());
            }
            let mut auth_req = vec![0x01, user.len() as u8];
            auth_req.extend_from_slice(user.as_bytes());
            auth_req.push(pass.len() as u8);
            auth_req.extend_from_slice(pass.as_bytes());
            stream
                .write_all(&auth_req)
                .map_err(|e| format!("socks5 auth write failed: {e}"))?;

            let mut auth_resp = [0u8; 2];
            stream
                .read_exact(&mut auth_resp)
                .map_err(|e| format!("socks5 auth read failed: {e}"))?;
            if auth_resp[0] != 0x01 {
                return Err(format!("invalid socks5 auth subversion: {}", auth_resp[0]));
            }
            if auth_resp[1] != 0x00 {
                return Err(format!("socks5 auth failed: status {}", auth_resp[1]));
            }
        }
        0xFF => return Err("socks5: no acceptable auth methods".into()),
        other => return Err(format!("socks5: unsupported auth method: {other}")),
    }

    // 2. CONNECT request
    let mut conn_req = vec![0x05, 0x01, 0x00];
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(ipv4) => {
                conn_req.push(0x01);
                conn_req.extend_from_slice(&ipv4.octets());
            }
            std::net::IpAddr::V6(ipv6) => {
                conn_req.push(0x04);
                conn_req.extend_from_slice(&ipv6.octets());
            }
        }
    } else {
        if host.len() > 255 {
            return Err("target host too long for socks5".into());
        }
        conn_req.push(0x03);
        conn_req.push(host.len() as u8);
        conn_req.extend_from_slice(host.as_bytes());
    }
    conn_req.extend_from_slice(&port.to_be_bytes());
    stream
        .write_all(&conn_req)
        .map_err(|e| format!("socks5 connect write failed: {e}"))?;

    // 3. Response
    let mut conn_resp_header = [0u8; 4];
    stream
        .read_exact(&mut conn_resp_header)
        .map_err(|e| format!("socks5 connect response read failed: {e}"))?;
    if conn_resp_header[0] != 0x05 {
        return Err(format!(
            "invalid socks5 reply version: {}",
            conn_resp_header[0]
        ));
    }
    if conn_resp_header[1] != 0x00 {
        return Err(format!(
            "socks5 connect failed: status {}",
            conn_resp_header[1]
        ));
    }

    match conn_resp_header[3] {
        0x01 => {
            let mut buf = [0u8; 6];
            stream
                .read_exact(&mut buf)
                .map_err(|e| format!("socks5 bind read failed: {e}"))?;
        }
        0x04 => {
            let mut buf = [0u8; 18];
            stream
                .read_exact(&mut buf)
                .map_err(|e| format!("socks5 bind read failed: {e}"))?;
        }
        0x03 => {
            let mut len_buf = [0u8; 1];
            stream
                .read_exact(&mut len_buf)
                .map_err(|e| format!("socks5 bind read failed: {e}"))?;
            let domain_len = len_buf[0] as usize;
            let mut domain_buf = vec![0u8; domain_len + 2];
            stream
                .read_exact(&mut domain_buf)
                .map_err(|e| format!("socks5 bind read failed: {e}"))?;
        }
        other => return Err(format!("socks5: invalid reply address type: {other}")),
    }

    Ok(stream)
}

pub fn http_connect_handshake_sync<S>(
    mut stream: S,
    host: &str,
    port: u16,
    auth: Option<(&str, &str)>,
) -> std::result::Result<S, String>
where
    S: std::io::Read + std::io::Write,
{
    let mut req_str = format!(
        "CONNECT {host}:{port} HTTP/1.1\r\n\
         Host: {host}:{port}\r\n"
    );
    if let Some((user, pass)) = auth {
        let auth_str = format!("{user}:{pass}");
        let base64_auth = base64_encode(auth_str.as_bytes());
        req_str.push_str(&format!("Proxy-Authorization: Basic {base64_auth}\r\n"));
    }
    req_str.push_str("\r\n");

    stream
        .write_all(req_str.as_bytes())
        .map_err(|e| format!("HTTP CONNECT write failed: {e}"))?;

    let mut header_buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        stream
            .read_exact(&mut byte)
            .map_err(|e| format!("HTTP CONNECT response read failed: {e}"))?;
        header_buf.push(byte[0]);
        if header_buf.len() > 4096 {
            return Err("HTTP CONNECT response header too large (> 4096 bytes)".into());
        }
        if header_buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }

    let resp_str = String::from_utf8_lossy(&header_buf);
    let mut lines = resp_str.lines();
    let status_line = lines
        .next()
        .ok_or_else(|| "empty HTTP CONNECT response".to_string())?;

    let parts: Vec<&str> = status_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(format!("invalid HTTP status line: {status_line}"));
    }
    let code = parts[1];
    if code != "200" {
        return Err(format!("HTTP CONNECT failed: {status_line}"));
    }

    Ok(stream)
}

pub enum HopStream {
    Tcp(std::net::TcpStream),
    Ssh(ssh2::Channel),
}

impl std::io::Read for HopStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Tcp(s) => s.read(buf),
            Self::Ssh(c) => c.read(buf),
        }
    }
}

impl std::io::Write for HopStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Tcp(s) => s.write(buf),
            Self::Ssh(c) => c.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Tcp(s) => s.flush(),
            Self::Ssh(c) => c.flush(),
        }
    }
}

fn establish_ssh_session(
    stream: std::net::TcpStream,
    username: &str,
    auth: &ResolvedSshAuth,
    strict_host_key: bool,
    expected_host_key: Option<&str>,
) -> std::result::Result<ssh2::Session, String> {
    let mut sess = ssh2::Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(stream);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {e}"))?;

    if strict_host_key {
        let (actual_key, _key_type) = sess
            .host_key()
            .ok_or_else(|| "failed to get SSH host key".to_string())?;
        if let Some(expected) = expected_host_key {
            let actual_hex = hex_encode(actual_key);
            let actual_b64 = base64_encode(actual_key);
            if expected != actual_hex && expected != actual_b64 {
                return Err(format!(
                    "Host key verification failed. Expected: {expected}, Got (hex): {actual_hex} or (b64): {actual_b64}"
                ));
            }
        } else {
            return Err("strictHostKey is enabled but no hostKey was provided".to_string());
        }
    }

    match auth {
        ResolvedSshAuth::Agent => {
            let mut agent = sess
                .agent()
                .map_err(|e| format!("failed to connect to SSH agent: {e}"))?;
            agent
                .connect()
                .map_err(|e| format!("failed to connect to SSH agent: {e}"))?;
            agent
                .list_identities()
                .map_err(|e| format!("failed to list SSH agent identities: {e}"))?;
            let mut authenticated = false;
            for identity in agent
                .identities()
                .map_err(|e| format!("failed to get SSH agent identities: {e}"))?
            {
                if agent.userauth(username, &identity).is_ok() {
                    authenticated = true;
                    break;
                }
            }
            if !authenticated {
                return Err("SSH agent authentication failed: no identity accepted".to_string());
            }
        }
        ResolvedSshAuth::Password(password) => {
            sess.userauth_password(username, password)
                .map_err(|e| format!("SSH password authentication failed: {e}"))?;
        }
        ResolvedSshAuth::PrivateKey {
            private_key,
            passphrase,
        } => {
            sess.userauth_pubkey_memory(username, None, private_key, passphrase.as_deref())
                .map_err(|e| format!("SSH private key authentication failed: {e}"))?;
        }
    }

    if !sess.authenticated() {
        return Err("SSH session authentication failed".to_string());
    }

    Ok(sess)
}

pub struct TunneledStream {
    pub stream: HopStream,
    pub session: Option<ssh2::Session>,
}

impl TunneledStream {
    pub fn set_nonblocking(&self, nonblocking: bool) -> std::result::Result<(), String> {
        match &self.stream {
            HopStream::Tcp(s) => s.set_nonblocking(nonblocking).map_err(|e| e.to_string())?,
            HopStream::Ssh(_) => {
                if let Some(sess) = &self.session {
                    sess.set_blocking(!nonblocking);
                }
            }
        }
        Ok(())
    }
}

pub fn dial_resolved_transport(
    config: &ResolvedTransport,
) -> std::result::Result<TunneledStream, String> {
    match config {
        ResolvedTransport::Socks5Proxy(proxy) => {
            let stream = std::net::TcpStream::connect((proxy.host.as_str(), proxy.port))
                .map_err(|e| format!("failed to connect to SOCKS5 proxy: {e}"))?;
            let auth = proxy
                .auth
                .as_ref()
                .map(|a| (a.username.as_str(), a.password.as_str()));
            let stream =
                socks5_handshake_sync(stream, &proxy.target_host, proxy.target_port, auth)?;
            Ok(TunneledStream {
                stream: HopStream::Tcp(stream),
                session: None,
            })
        }
        ResolvedTransport::HttpConnectProxy(proxy) => {
            let stream = std::net::TcpStream::connect((proxy.host.as_str(), proxy.port))
                .map_err(|e| format!("failed to connect to HTTP proxy: {e}"))?;
            let auth = proxy
                .auth
                .as_ref()
                .map(|a| (a.username.as_str(), a.password.as_str()));
            let stream =
                http_connect_handshake_sync(stream, &proxy.target_host, proxy.target_port, auth)?;
            Ok(TunneledStream {
                stream: HopStream::Tcp(stream),
                session: None,
            })
        }
        ResolvedTransport::SshTunnel(tunnel) => {
            let stream = std::net::TcpStream::connect((tunnel.ssh_host.as_str(), tunnel.ssh_port))
                .map_err(|e| format!("failed to connect to SSH host: {e}"))?;
            let sess = establish_ssh_session(
                stream,
                &tunnel.username,
                &tunnel.auth,
                tunnel.strict_host_key,
                tunnel.host_key.as_deref(),
            )?;
            let channel = sess
                .channel_direct_tcpip(&tunnel.target_host, tunnel.target_port, None)
                .map_err(|e| format!("failed to open SSH direct-tcpip channel: {e}"))?;
            Ok(TunneledStream {
                stream: HopStream::Ssh(channel),
                session: Some(sess),
            })
        }
        ResolvedTransport::Chain(chain) => {
            if chain.hops.is_empty() {
                return Err("proxy chain has no hops".to_string());
            }

            let mut final_session = None;

            // Connect to first hop
            let mut current_stream = match &chain.hops[0].config {
                ResolvedProxyHopConfig::Socks5 { host, port, auth } => {
                    let stream = std::net::TcpStream::connect((host.as_str(), *port))
                        .map_err(|e| format!("chain hop 0 (SOCKS5) connection failed: {e}"))?;
                    let auth_creds = auth
                        .as_ref()
                        .map(|a| (a.username.as_str(), a.password.as_str()));
                    let next_hop = chain
                        .hops
                        .get(1)
                        .ok_or_else(|| "chain hop 0 needs subsequent hop".to_string())?;
                    let (next_host, next_port) = match &next_hop.config {
                        ResolvedProxyHopConfig::Socks5 { host, port, .. } => (host.as_str(), *port),
                        ResolvedProxyHopConfig::HttpConnect { host, port, .. } => {
                            (host.as_str(), *port)
                        }
                        ResolvedProxyHopConfig::Ssh {
                            ssh_host, ssh_port, ..
                        } => (ssh_host.as_str(), *ssh_port),
                    };
                    let stream = socks5_handshake_sync(stream, next_host, next_port, auth_creds)
                        .map_err(|e| format!("chain hop 0 (SOCKS5) handshake failed: {e}"))?;
                    HopStream::Tcp(stream)
                }
                ResolvedProxyHopConfig::HttpConnect { host, port, auth } => {
                    let stream = std::net::TcpStream::connect((host.as_str(), *port))
                        .map_err(|e| format!("chain hop 0 (HTTP) connection failed: {e}"))?;
                    let auth_creds = auth
                        .as_ref()
                        .map(|a| (a.username.as_str(), a.password.as_str()));
                    let next_hop = chain
                        .hops
                        .get(1)
                        .ok_or_else(|| "chain hop 0 needs subsequent hop".to_string())?;
                    let (next_host, next_port) = match &next_hop.config {
                        ResolvedProxyHopConfig::Socks5 { host, port, .. } => (host.as_str(), *port),
                        ResolvedProxyHopConfig::HttpConnect { host, port, .. } => {
                            (host.as_str(), *port)
                        }
                        ResolvedProxyHopConfig::Ssh {
                            ssh_host, ssh_port, ..
                        } => (ssh_host.as_str(), *ssh_port),
                    };
                    let stream =
                        http_connect_handshake_sync(stream, next_host, next_port, auth_creds)
                            .map_err(|e| format!("chain hop 0 (HTTP) CONNECT failed: {e}"))?;
                    HopStream::Tcp(stream)
                }
                ResolvedProxyHopConfig::Ssh {
                    ssh_host,
                    ssh_port,
                    username,
                    auth,
                    strict_host_key,
                    host_key,
                } => {
                    let stream = std::net::TcpStream::connect((ssh_host.as_str(), *ssh_port))
                        .map_err(|e| format!("chain hop 0 (SSH) connection failed: {e}"))?;
                    let sess = establish_ssh_session(
                        stream,
                        username,
                        auth,
                        *strict_host_key,
                        host_key.as_deref(),
                    )?;
                    let next_hop = chain
                        .hops
                        .get(1)
                        .ok_or_else(|| "chain hop 0 needs subsequent hop".to_string())?;
                    let (next_host, next_port) = match &next_hop.config {
                        ResolvedProxyHopConfig::Socks5 { host, port, .. } => (host.as_str(), *port),
                        ResolvedProxyHopConfig::HttpConnect { host, port, .. } => {
                            (host.as_str(), *port)
                        }
                        ResolvedProxyHopConfig::Ssh {
                            ssh_host, ssh_port, ..
                        } => (ssh_host.as_str(), *ssh_port),
                    };
                    let channel = sess
                        .channel_direct_tcpip(next_host, next_port, None)
                        .map_err(|e| format!("failed to open SSH channel for next hop: {e}"))?;
                    final_session = Some(sess);
                    HopStream::Ssh(channel)
                }
            };

            // Loop remaining hops
            for i in 1..chain.hops.len() {
                let hop = &chain.hops[i];
                let is_last = i == chain.hops.len() - 1;

                let (target_host, target_port) = if is_last {
                    (chain.target_host.as_str(), chain.target_port)
                } else {
                    match &chain.hops[i + 1].config {
                        ResolvedProxyHopConfig::Socks5 { host, port, .. } => (host.as_str(), *port),
                        ResolvedProxyHopConfig::HttpConnect { host, port, .. } => {
                            (host.as_str(), *port)
                        }
                        ResolvedProxyHopConfig::Ssh {
                            ssh_host, ssh_port, ..
                        } => (ssh_host.as_str(), *ssh_port),
                    }
                };

                match &hop.config {
                    ResolvedProxyHopConfig::Socks5 { auth, .. } => {
                        let auth_creds = auth
                            .as_ref()
                            .map(|a| (a.username.as_str(), a.password.as_str()));
                        current_stream = socks5_handshake_sync(
                            current_stream,
                            target_host,
                            target_port,
                            auth_creds,
                        )
                        .map_err(|e| format!("chain hop {i} (SOCKS5) handshake failed: {e}"))?;
                    }
                    ResolvedProxyHopConfig::HttpConnect { auth, .. } => {
                        let auth_creds = auth
                            .as_ref()
                            .map(|a| (a.username.as_str(), a.password.as_str()));
                        current_stream = http_connect_handshake_sync(
                            current_stream,
                            target_host,
                            target_port,
                            auth_creds,
                        )
                        .map_err(|e| format!("chain hop {i} (HTTP) CONNECT failed: {e}"))?;
                    }
                    ResolvedProxyHopConfig::Ssh {
                        username,
                        auth,
                        strict_host_key,
                        host_key,
                        ..
                    } => {
                        let tcp_stream = match current_stream {
                            HopStream::Tcp(s) => s,
                            HopStream::Ssh(_) => {
                                return Err(format!("chain hop {i} (SSH) cannot be nested inside another SSH channel (not supported by libssh2 Rust bindings)"));
                            }
                        };
                        let sess = establish_ssh_session(
                            tcp_stream,
                            username,
                            auth,
                            *strict_host_key,
                            host_key.as_deref(),
                        )?;
                        let channel = sess
                            .channel_direct_tcpip(target_host, target_port, None)
                            .map_err(|e| format!("failed to open SSH channel for hop {i}: {e}"))?;
                        final_session = Some(sess);
                        current_stream = HopStream::Ssh(channel);
                    }
                }
            }

            Ok(TunneledStream {
                stream: current_stream,
                session: final_session,
            })
        }
    }
}

struct Buffer {
    data: Vec<u8>,
    read_pos: usize,
    write_pos: usize,
}

impl Buffer {
    fn new(capacity: usize) -> Self {
        Self {
            data: vec![0; capacity],
            read_pos: 0,
            write_pos: 0,
        }
    }

    fn is_empty(&self) -> bool {
        self.read_pos == self.write_pos
    }

    fn available_write(&self) -> usize {
        self.data.len() - self.write_pos
    }

    fn write_slice(&mut self) -> &mut [u8] {
        &mut self.data[self.write_pos..]
    }

    fn read_slice(&self) -> &[u8] {
        &self.data[self.read_pos..self.write_pos]
    }

    fn did_write(&mut self, n: usize) {
        self.write_pos += n;
    }

    fn did_read(&mut self, n: usize) {
        self.read_pos += n;
        if self.read_pos == self.write_pos {
            self.read_pos = 0;
            self.write_pos = 0;
        }
    }

    fn compact(&mut self) {
        if self.read_pos > 0 {
            let len = self.write_pos - self.read_pos;
            self.data.copy_within(self.read_pos..self.write_pos, 0);
            self.read_pos = 0;
            self.write_pos = len;
        }
    }
}

async fn forward_connection<T>(
    client_stream: tokio::net::TcpStream,
    mut remote_stream: T,
) -> std::result::Result<(), String>
where
    T: std::io::Read + std::io::Write + Unpin,
{
    let mut client_to_remote = Buffer::new(32768);
    let mut remote_to_client = Buffer::new(32768);

    loop {
        let mut made_progress = false;

        // 1. Write to remote
        if !client_to_remote.is_empty() {
            match remote_stream.write(client_to_remote.read_slice()) {
                Ok(n) if n > 0 => {
                    client_to_remote.did_read(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("remote write failed: {e}")),
            }
        }

        // 2. Read from client
        if client_to_remote.available_write() > 0 {
            match client_stream.try_read(client_to_remote.write_slice()) {
                Ok(0) => {
                    if client_to_remote.is_empty() {
                        break;
                    }
                }
                Ok(n) if n > 0 => {
                    client_to_remote.did_write(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("client read failed: {e}")),
            }
        } else {
            client_to_remote.compact();
        }

        // 3. Write to client
        if !remote_to_client.is_empty() {
            match client_stream.try_write(remote_to_client.read_slice()) {
                Ok(n) if n > 0 => {
                    remote_to_client.did_read(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("client write failed: {e}")),
            }
        }

        // 4. Read from remote
        if remote_to_client.available_write() > 0 {
            match remote_stream.read(remote_to_client.write_slice()) {
                Ok(0) => {
                    if remote_to_client.is_empty() {
                        break;
                    }
                }
                Ok(n) if n > 0 => {
                    remote_to_client.did_write(n);
                    made_progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("remote read failed: {e}")),
            }
        } else {
            remote_to_client.compact();
        }

        if !made_progress {
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    }
    Ok(())
}

async fn forward_connection_stream(
    client_stream: tokio::net::TcpStream,
    tunneled: TunneledStream,
) -> std::result::Result<(), String> {
    match tunneled.stream {
        HopStream::Tcp(s) => forward_connection(client_stream, s).await,
        HopStream::Ssh(c) => forward_connection(client_stream, c).await,
    }
}

pub async fn start_forwarder(
    resolved: ResolvedTransport,
) -> std::result::Result<(u16, tokio_util::sync::CancellationToken), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("failed to bind local forwarder listener: {e}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("failed to get listener address: {e}"))?
        .port();

    let cancellation_token = tokio_util::sync::CancellationToken::new();
    let token_clone = cancellation_token.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = token_clone.cancelled() => {
                    break;
                }
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((client_stream, _)) => {
                            let resolved_clone = resolved.clone();
                            let token = token_clone.clone();
                            tokio::spawn(async move {
                                let dial_res = tokio::task::spawn_blocking(move || {
                                    dial_resolved_transport(&resolved_clone)
                                }).await;

                                let tunneled = match dial_res {
                                    Ok(Ok(t)) => t,
                                    Ok(Err(e)) => {
                                        eprintln!("failed to dial target for forwarded connection: {e}");
                                        return;
                                    }
                                    Err(e) => {
                                        eprintln!("spawn_blocking failed during dial: {e}");
                                        return;
                                    }
                                };

                                if let Err(e) = tunneled.set_nonblocking(true) {
                                    eprintln!("failed to set nonblocking on tunneled stream: {e}");
                                    return;
                                }

                                tokio::select! {
                                    _ = token.cancelled() => {}
                                    res = forward_connection_stream(client_stream, tunneled) => {
                                        if let Err(e) = res {
                                            eprintln!("forwarding connection error: {e}");
                                        }
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            eprintln!("failed to accept forwarded connection: {e}");
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
            }
        }
    });

    Ok((local_port, cancellation_token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use irodori_core::{ProxyAuthConfig, SecretRef, SshAuthConfig, SshProxyHop};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

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

    #[tokio::test]
    async fn test_socks5_handshake_success_no_auth() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();

            // Read greeting: [0x05, 1, 0x00]
            let mut greeting = [0u8; 3];
            conn.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting[0], 0x05);
            assert_eq!(greeting[1], 1);
            assert_eq!(greeting[2], 0x00);

            // Write greeting response: [0x05, 0x00]
            conn.write_all(&[0x05, 0x00]).unwrap();

            // Read connect request
            let mut req_header = [0u8; 4];
            conn.read_exact(&mut req_header).unwrap();
            assert_eq!(req_header[0], 0x05);
            assert_eq!(req_header[1], 0x01); // CONNECT
            assert_eq!(req_header[2], 0x00);
            assert_eq!(req_header[3], 0x03); // Domain type

            let mut len_buf = [0u8; 1];
            conn.read_exact(&mut len_buf).unwrap();
            let domain_len = len_buf[0] as usize;
            let mut domain = vec![0u8; domain_len + 2]; // domain + port
            conn.read_exact(&mut domain).unwrap();

            // Write connect response
            conn.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .unwrap();

            // Verify data passing
            let mut data = [0u8; 4];
            conn.read_exact(&mut data).unwrap();
            assert_eq!(&data, b"ping");
            conn.write_all(b"pong").unwrap();
        });

        let client = std::net::TcpStream::connect(addr).unwrap();
        let mut client = socks5_handshake_sync(client, "example.com", 80, None).unwrap();

        client.write_all(b"ping").unwrap();
        let mut resp = [0u8; 4];
        client.read_exact(&mut resp).unwrap();
        assert_eq!(&resp, b"pong");

        handle.join().unwrap();
    }

    #[tokio::test]
    async fn test_socks5_handshake_success_auth() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();

            // Read greeting: [0x05, 2, 0x00, 0x02]
            let mut greeting = [0u8; 4];
            conn.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting[0], 0x05);
            assert_eq!(greeting[1], 2);

            // Write greeting response: [0x05, 0x02]
            conn.write_all(&[0x05, 0x02]).unwrap();

            // Read auth request
            let mut auth_head = [0u8; 2];
            conn.read_exact(&mut auth_head).unwrap();
            assert_eq!(auth_head[0], 0x01);
            let user_len = auth_head[1] as usize;
            let mut user = vec![0u8; user_len];
            conn.read_exact(&mut user).unwrap();
            assert_eq!(&user, b"admin");

            let mut pass_len_buf = [0u8; 1];
            conn.read_exact(&mut pass_len_buf).unwrap();
            let pass_len = pass_len_buf[0] as usize;
            let mut pass = vec![0u8; pass_len];
            conn.read_exact(&mut pass).unwrap();
            assert_eq!(&pass, b"secret");

            // Write auth response: [0x01, 0x00]
            conn.write_all(&[0x01, 0x00]).unwrap();

            // Read connect request
            let mut req_header = [0u8; 4];
            conn.read_exact(&mut req_header).unwrap();
            assert_eq!(req_header[3], 0x03);

            let mut len_buf = [0u8; 1];
            conn.read_exact(&mut len_buf).unwrap();
            let domain_len = len_buf[0] as usize;
            let mut domain = vec![0u8; domain_len + 2];
            conn.read_exact(&mut domain).unwrap();

            // Write connect response
            conn.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .unwrap();
        });

        let client = std::net::TcpStream::connect(addr).unwrap();
        let _client =
            socks5_handshake_sync(client, "example.com", 80, Some(("admin", "secret"))).unwrap();

        handle.join().unwrap();
    }

    #[tokio::test]
    async fn test_http_connect_handshake_success() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();

            // Read request up to \r\n\r\n
            let mut req = Vec::new();
            let mut byte = [0u8; 1];
            loop {
                conn.read_exact(&mut byte).unwrap();
                req.push(byte[0]);
                if req.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let req_str = String::from_utf8_lossy(&req);
            assert!(req_str.starts_with("CONNECT example.com:80 HTTP/1.1"));
            assert!(req_str.contains("Proxy-Authorization: Basic YWRtaW46c2VjcmV0"));

            // Write 200 response
            conn.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .unwrap();
        });

        let client = std::net::TcpStream::connect(addr).unwrap();
        let _client =
            http_connect_handshake_sync(client, "example.com", 80, Some(("admin", "secret")))
                .unwrap();

        handle.join().unwrap();
    }

    #[tokio::test]
    async fn test_local_tcp_forwarder_loop() {
        let target_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let target_port = target_listener.local_addr().unwrap().port();

        let target_handle = std::thread::spawn(move || {
            let (mut conn, _) = target_listener.accept().unwrap();
            let mut data = [0u8; 4];
            conn.read_exact(&mut data).unwrap();
            assert_eq!(&data, b"ping");
            conn.write_all(b"pong").unwrap();
        });

        let proxy_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy_port = proxy_listener.local_addr().unwrap().port();

        let proxy_handle = std::thread::spawn(move || {
            let (mut conn, _) = proxy_listener.accept().unwrap();
            // Read greeting
            let mut greeting = [0u8; 3];
            conn.read_exact(&mut greeting).unwrap();
            conn.write_all(&[0x05, 0x00]).unwrap();

            // Read CONNECT
            let mut req = [0u8; 4];
            conn.read_exact(&mut req).unwrap();
            let mut len = [0u8; 1];
            conn.read_exact(&mut len).unwrap();
            let domain_len = len[0] as usize;
            let mut domain = vec![0u8; domain_len + 2];
            conn.read_exact(&mut domain).unwrap();

            // Response
            conn.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .unwrap();

            let mut target = std::net::TcpStream::connect(("127.0.0.1", target_port)).unwrap();
            let mut conn_clone = conn.try_clone().unwrap();
            let mut target_clone = target.try_clone().unwrap();
            std::thread::spawn(move || {
                std::io::copy(&mut conn_clone, &mut target_clone).unwrap();
            });
            std::io::copy(&mut target, &mut conn).unwrap();
        });

        let resolved = ResolvedTransport::Socks5Proxy(ResolvedProxy {
            host: "127.0.0.1".to_string(),
            port: proxy_port,
            auth: None,
            target_host: "localhost".to_string(),
            target_port,
            tls: false,
        });

        let (local_port, cancel_token) = start_forwarder(resolved).await.unwrap();

        let mut client = tokio::net::TcpStream::connect(("127.0.0.1", local_port))
            .await
            .unwrap();
        client.write_all(b"ping").await.unwrap();

        let mut resp = [0u8; 4];
        client.read_exact(&mut resp).await.unwrap();
        assert_eq!(&resp, b"pong");

        cancel_token.cancel();
        target_handle.join().unwrap();
        proxy_handle.join().unwrap();
    }
}
