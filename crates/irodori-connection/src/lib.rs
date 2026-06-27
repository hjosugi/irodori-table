//! Connection profiles, transports, and their portable (exportable) forms.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use irodori_error::{IrodoriError, Result};

const MAX_PROFILE_ID_LEN: usize = 128;
const MAX_SOURCE_ID_LEN: usize = 128;
pub const CONNECTION_PROFILE_SCHEMA_VERSION: u16 = 1;

mod portable;

pub use portable::{
    ConnectionProfileExport, PortableAuthConfig, PortableConnectionProfile,
    PortableProxyAuthConfig, PortableProxyChainHop, PortableProxyChainTransport,
    PortableProxyHopConfig, PortableProxyTransport, PortableSshAuthConfig, PortableSshProxyHop,
    PortableSshTunnelTransport, PortableTransportConfig, SecretSlot, SecretSlotPurpose,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub display_name: String,
    pub source: SourceKind,
    pub transport: TransportConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user: Option<String>,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, String>,
}

impl ConnectionProfile {
    pub fn validate(&self) -> Result<()> {
        validate_id("profile id", &self.id, MAX_PROFILE_ID_LEN)?;
        validate_required("display name", &self.display_name)?;
        self.source.validate()?;
        self.transport.validate()?;
        self.auth.validate()?;

        validate_optional_non_empty("database", self.database.as_deref())?;
        validate_optional_non_empty("user", self.user.as_deref())?;
        validate_options(&self.options)?;

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SourceKind {
    pub id: String,
    pub family: SourceFamily,
}

impl SourceKind {
    pub fn new(id: impl Into<String>, family: SourceFamily) -> Self {
        Self {
            id: id.into(),
            family,
        }
    }

    pub fn postgresql() -> Self {
        Self::new("postgresql", SourceFamily::Sql)
    }

    pub fn sqlite() -> Self {
        Self::new("sqlite", SourceFamily::Sql)
    }

    pub fn validate(&self) -> Result<()> {
        validate_id("source id", &self.id, MAX_SOURCE_ID_LEN)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum SourceFamily {
    Sql,
    Document,
    KeyValue,
    Graph,
    TimeSeries,
    Search,
    Warehouse,
    Lakehouse,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum TransportConfig {
    Direct(DirectTransport),
    LocalFile(LocalFileTransport),
    SshTunnel(SshTunnelTransport),
    Socks5Proxy(ProxyTransport),
    HttpConnectProxy(ProxyTransport),
    Chain(ProxyChainTransport),
}

impl TransportConfig {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Direct(config) => config.validate(),
            Self::LocalFile(config) => config.validate(),
            Self::SshTunnel(config) => config.validate(),
            Self::Socks5Proxy(config) | Self::HttpConnectProxy(config) => config.validate_route(),
            Self::Chain(config) => config.validate(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct DirectTransport {
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub port: Option<u16>,
    #[serde(default)]
    pub tls: bool,
}

impl DirectTransport {
    pub fn new(host: impl Into<String>, port: Option<u16>) -> Self {
        Self {
            host: host.into(),
            port,
            tls: false,
        }
    }

    pub fn validate(&self) -> Result<()> {
        validate_required("host", &self.host)?;
        if self.port == Some(0) {
            return Err(IrodoriError::validation("port must be between 1 and 65535"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct LocalFileTransport {
    pub path: String,
}

impl LocalFileTransport {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub fn validate(&self) -> Result<()> {
        validate_required("path", &self.path)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SshTunnelTransport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    pub ssh_host: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    pub username: String,
    #[serde(default)]
    pub auth: SshAuthConfig,
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub strict_host_key: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_key: Option<String>,
}

impl SshTunnelTransport {
    pub fn new(
        ssh_host: impl Into<String>,
        username: impl Into<String>,
        target_host: impl Into<String>,
        target_port: u16,
    ) -> Self {
        Self {
            name: None,
            ssh_host: ssh_host.into(),
            ssh_port: default_ssh_port(),
            username: username.into(),
            auth: SshAuthConfig::Agent,
            target_host: target_host.into(),
            target_port,
            strict_host_key: true,
            host_key: None,
        }
    }

    pub fn validate(&self) -> Result<()> {
        validate_optional_id("tunnel name", self.name.as_deref())?;
        validate_required("ssh host", &self.ssh_host)?;
        validate_port("ssh port", self.ssh_port)?;
        validate_required("ssh username", &self.username)?;
        self.auth.validate()?;
        validate_required("target host", &self.target_host)?;
        validate_port("target port", self.target_port)?;
        validate_optional_non_empty("host key", self.host_key.as_deref())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ProxyTransport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub auth: Option<ProxyAuthConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_port: Option<u16>,
    #[serde(default)]
    pub tls: bool,
}

impl ProxyTransport {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            name: None,
            host: host.into(),
            port,
            auth: None,
            target_host: None,
            target_port: None,
            tls: false,
        }
    }

    pub fn with_target(mut self, target_host: impl Into<String>, target_port: u16) -> Self {
        self.target_host = Some(target_host.into());
        self.target_port = Some(target_port);
        self
    }

    fn validate_server(&self) -> Result<()> {
        validate_optional_id("proxy name", self.name.as_deref())?;
        validate_required("proxy host", &self.host)?;
        validate_port("proxy port", self.port)?;
        if let Some(auth) = &self.auth {
            auth.validate()?;
        }
        Ok(())
    }

    fn validate_route(&self) -> Result<()> {
        self.validate_server()?;
        validate_required(
            "proxy target host",
            self.target_host.as_deref().unwrap_or(""),
        )?;
        let target_port = self
            .target_port
            .ok_or_else(|| IrodoriError::validation("proxy target port is required"))?;
        validate_port("proxy target port", target_port)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ProxyAuthConfig {
    pub username: String,
    pub password: SecretRef,
}

impl ProxyAuthConfig {
    fn validate(&self) -> Result<()> {
        validate_required("proxy username", &self.username)?;
        self.password.validate("proxy password handle")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ProxyChainTransport {
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub tls: bool,
    pub hops: Vec<ProxyChainHop>,
}

impl ProxyChainTransport {
    pub fn new(target_host: impl Into<String>, target_port: u16, hops: Vec<ProxyChainHop>) -> Self {
        Self {
            target_host: target_host.into(),
            target_port,
            tls: false,
            hops,
        }
    }

    pub fn validate(&self) -> Result<()> {
        validate_required("chain target host", &self.target_host)?;
        validate_port("chain target port", self.target_port)?;
        if self.hops.len() < 2 {
            return Err(IrodoriError::validation(
                "proxy chain must contain at least two named hops",
            ));
        }

        let mut names = BTreeSet::new();
        for hop in &self.hops {
            hop.validate()?;
            if !names.insert(hop.name.as_str()) {
                return Err(IrodoriError::validation(format!(
                    "proxy chain hop `{}` is duplicated",
                    hop.name
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ProxyChainHop {
    pub name: String,
    pub config: ProxyHopConfig,
}

impl ProxyChainHop {
    pub fn new(name: impl Into<String>, config: ProxyHopConfig) -> Self {
        Self {
            name: name.into(),
            config,
        }
    }

    pub fn validate(&self) -> Result<()> {
        validate_id("proxy hop name", &self.name, MAX_PROFILE_ID_LEN)?;
        self.config.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ProxyHopConfig {
    Ssh(SshProxyHop),
    Socks5(ProxyTransport),
    HttpConnect(ProxyTransport),
}

impl ProxyHopConfig {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Ssh(config) => config.validate(),
            Self::Socks5(config) | Self::HttpConnect(config) => config.validate_server(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SshProxyHop {
    pub ssh_host: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    pub username: String,
    #[serde(default)]
    pub auth: SshAuthConfig,
    #[serde(default)]
    pub strict_host_key: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_key: Option<String>,
}

impl SshProxyHop {
    pub fn new(ssh_host: impl Into<String>, username: impl Into<String>) -> Self {
        Self {
            ssh_host: ssh_host.into(),
            ssh_port: default_ssh_port(),
            username: username.into(),
            auth: SshAuthConfig::Agent,
            strict_host_key: true,
            host_key: None,
        }
    }

    fn validate(&self) -> Result<()> {
        validate_required("ssh host", &self.ssh_host)?;
        validate_port("ssh port", self.ssh_port)?;
        validate_required("ssh username", &self.username)?;
        self.auth.validate()?;
        validate_optional_non_empty("host key", self.host_key.as_deref())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum SshAuthConfig {
    Agent,
    Password {
        password: SecretRef,
    },
    PrivateKey {
        private_key: SecretRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        passphrase: Option<SecretRef>,
    },
}

impl Default for SshAuthConfig {
    fn default() -> Self {
        Self::Agent
    }
}

impl SshAuthConfig {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Agent => Ok(()),
            Self::Password { password } => password.validate("ssh password handle"),
            Self::PrivateKey {
                private_key,
                passphrase,
            } => {
                private_key.validate("ssh private key handle")?;
                if let Some(passphrase) = passphrase {
                    passphrase.validate("ssh private key passphrase handle")?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum AuthConfig {
    None,
    Secret {
        secret: SecretRef,
    },
    Token {
        token: SecretRef,
    },
    KeyPair {
        private_key: SecretRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        passphrase: Option<SecretRef>,
    },
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self::None
    }
}

impl AuthConfig {
    fn validate(&self) -> Result<()> {
        match self {
            Self::None => Ok(()),
            Self::Secret { secret } => secret.validate("secret handle"),
            Self::Token { token } => token.validate("token handle"),
            Self::KeyPair {
                private_key,
                passphrase,
            } => {
                private_key.validate("private key handle")?;
                if let Some(passphrase) = passphrase {
                    passphrase.validate("passphrase handle")?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SecretRef {
    pub handle: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub service: Option<String>,
}

impl SecretRef {
    pub fn new(handle: impl Into<String>) -> Self {
        Self {
            handle: handle.into(),
            service: None,
        }
    }

    fn validate(&self, label: &str) -> Result<()> {
        validate_required(label, &self.handle)?;
        validate_optional_non_empty("secret service", self.service.as_deref())
    }
}

fn validate_id(label: &str, value: &str, max_len: usize) -> Result<()> {
    validate_required(label, value)?;
    if value.len() > max_len {
        return Err(IrodoriError::validation(format!(
            "{label} must be {max_len} characters or fewer"
        )));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(IrodoriError::validation(format!(
            "{label} cannot contain whitespace"
        )));
    }
    Ok(())
}

fn validate_optional_id(label: &str, value: Option<&str>) -> Result<()> {
    if let Some(value) = value {
        validate_id(label, value, MAX_PROFILE_ID_LEN)?;
    }
    Ok(())
}

fn validate_required(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(IrodoriError::validation(format!("{label} is required")));
    }
    Ok(())
}

fn validate_port(label: &str, port: u16) -> Result<()> {
    if port == 0 {
        return Err(IrodoriError::validation(format!(
            "{label} must be between 1 and 65535"
        )));
    }
    Ok(())
}

fn validate_optional_non_empty(label: &str, value: Option<&str>) -> Result<()> {
    if matches!(value, Some(value) if value.trim().is_empty()) {
        return Err(IrodoriError::validation(format!(
            "{label} cannot be empty when set"
        )));
    }
    Ok(())
}

fn default_ssh_port() -> u16 {
    22
}

fn validate_options(options: &BTreeMap<String, String>) -> Result<()> {
    for key in options.keys() {
        validate_required("option key", key)?;
        let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
        if matches!(
            normalized.as_str(),
            "password" | "passwd" | "pwd" | "secret" | "token" | "privatekey" | "passphrase"
        ) {
            return Err(IrodoriError::validation(format!(
                "option `{key}` must be stored as a secret handle"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
