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
