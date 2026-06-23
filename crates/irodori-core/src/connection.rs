use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{IrodoriError, Result};

const MAX_PROFILE_ID_LEN: usize = 128;
const MAX_SOURCE_ID_LEN: usize = 128;
pub const CONNECTION_PROFILE_SCHEMA_VERSION: u16 = 1;

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
pub struct ConnectionProfileExport {
    pub schema_version: u16,
    pub profiles: Vec<PortableConnectionProfile>,
}

impl ConnectionProfileExport {
    pub fn from_profiles<'a>(
        profiles: impl IntoIterator<Item = &'a ConnectionProfile>,
    ) -> Result<Self> {
        let mut portable_profiles = Vec::new();
        for profile in profiles {
            profile.validate()?;
            portable_profiles.push(PortableConnectionProfile::from_profile(profile));
        }

        Ok(Self {
            schema_version: CONNECTION_PROFILE_SCHEMA_VERSION,
            profiles: portable_profiles,
        })
    }

    pub fn validate_schema_version(&self) -> Result<()> {
        if self.schema_version == CONNECTION_PROFILE_SCHEMA_VERSION {
            Ok(())
        } else {
            Err(IrodoriError::validation(format!(
                "connection profile schema version {} is not supported",
                self.schema_version
            )))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableConnectionProfile {
    pub id: String,
    pub display_name: String,
    pub source: SourceKind,
    pub transport: PortableTransportConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub database: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub user: Option<String>,
    #[serde(default)]
    pub auth: PortableAuthConfig,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, String>,
}

impl PortableConnectionProfile {
    pub fn from_profile(profile: &ConnectionProfile) -> Self {
        Self {
            id: profile.id.clone(),
            display_name: profile.display_name.clone(),
            source: profile.source.clone(),
            transport: PortableTransportConfig::from_transport(&profile.transport),
            database: profile.database.clone(),
            user: profile.user.clone(),
            auth: PortableAuthConfig::from_auth(&profile.auth),
            options: profile.options.clone(),
        }
    }

    pub fn required_secret_slots(&self) -> Vec<SecretSlot> {
        let mut slots = Vec::new();
        self.auth.append_secret_slots(&self.id, "auth", &mut slots);
        self.transport.append_secret_slots(&self.id, &mut slots);
        slots
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PortableTransportConfig {
    Direct(DirectTransport),
    LocalFile(LocalFileTransport),
    SshTunnel(PortableSshTunnelTransport),
    Socks5Proxy(PortableProxyTransport),
    HttpConnectProxy(PortableProxyTransport),
    Chain(PortableProxyChainTransport),
}

impl PortableTransportConfig {
    fn from_transport(transport: &TransportConfig) -> Self {
        match transport {
            TransportConfig::Direct(config) => Self::Direct(config.clone()),
            TransportConfig::LocalFile(config) => Self::LocalFile(config.clone()),
            TransportConfig::SshTunnel(config) => {
                Self::SshTunnel(PortableSshTunnelTransport::from_transport(config))
            }
            TransportConfig::Socks5Proxy(config) => {
                Self::Socks5Proxy(PortableProxyTransport::from_transport(config))
            }
            TransportConfig::HttpConnectProxy(config) => {
                Self::HttpConnectProxy(PortableProxyTransport::from_transport(config))
            }
            TransportConfig::Chain(config) => {
                Self::Chain(PortableProxyChainTransport::from_transport(config))
            }
        }
    }

    fn append_secret_slots(&self, profile_id: &str, slots: &mut Vec<SecretSlot>) {
        match self {
            Self::Direct(_) | Self::LocalFile(_) => {}
            Self::SshTunnel(config) => config.append_secret_slots(profile_id, slots),
            Self::Socks5Proxy(config) | Self::HttpConnectProxy(config) => {
                config.append_secret_slots(profile_id, "transport.proxy", slots);
            }
            Self::Chain(config) => config.append_secret_slots(profile_id, slots),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableSshTunnelTransport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub username: String,
    #[serde(default)]
    pub auth: PortableSshAuthConfig,
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub strict_host_key: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_key: Option<String>,
}

impl PortableSshTunnelTransport {
    fn from_transport(transport: &SshTunnelTransport) -> Self {
        Self {
            name: transport.name.clone(),
            ssh_host: transport.ssh_host.clone(),
            ssh_port: transport.ssh_port,
            username: transport.username.clone(),
            auth: PortableSshAuthConfig::from_ssh_auth(&transport.auth),
            target_host: transport.target_host.clone(),
            target_port: transport.target_port,
            strict_host_key: transport.strict_host_key,
            host_key: transport.host_key.clone(),
        }
    }

    fn append_secret_slots(&self, profile_id: &str, slots: &mut Vec<SecretSlot>) {
        self.auth
            .append_secret_slots(profile_id, "transport.ssh", slots);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableProxyTransport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub auth: Option<PortableProxyAuthConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_port: Option<u16>,
    #[serde(default)]
    pub tls: bool,
}

impl PortableProxyTransport {
    fn from_transport(transport: &ProxyTransport) -> Self {
        Self {
            name: transport.name.clone(),
            host: transport.host.clone(),
            port: transport.port,
            auth: transport
                .auth
                .as_ref()
                .map(PortableProxyAuthConfig::from_auth),
            target_host: transport.target_host.clone(),
            target_port: transport.target_port,
            tls: transport.tls,
        }
    }

    fn append_secret_slots(&self, profile_id: &str, path: &str, slots: &mut Vec<SecretSlot>) {
        if self.auth.is_some() {
            slots.push(SecretSlot::new(
                profile_id,
                format!("{path}.password"),
                SecretSlotPurpose::ProxyPassword,
            ));
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableProxyAuthConfig {
    pub username: String,
    pub password_required: bool,
}

impl PortableProxyAuthConfig {
    fn from_auth(auth: &ProxyAuthConfig) -> Self {
        Self {
            username: auth.username.clone(),
            password_required: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableProxyChainTransport {
    pub target_host: String,
    pub target_port: u16,
    #[serde(default)]
    pub tls: bool,
    pub hops: Vec<PortableProxyChainHop>,
}

impl PortableProxyChainTransport {
    fn from_transport(transport: &ProxyChainTransport) -> Self {
        Self {
            target_host: transport.target_host.clone(),
            target_port: transport.target_port,
            tls: transport.tls,
            hops: transport
                .hops
                .iter()
                .map(PortableProxyChainHop::from_hop)
                .collect(),
        }
    }

    fn append_secret_slots(&self, profile_id: &str, slots: &mut Vec<SecretSlot>) {
        for hop in &self.hops {
            hop.append_secret_slots(profile_id, slots);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableProxyChainHop {
    pub name: String,
    pub config: PortableProxyHopConfig,
}

impl PortableProxyChainHop {
    fn from_hop(hop: &ProxyChainHop) -> Self {
        Self {
            name: hop.name.clone(),
            config: PortableProxyHopConfig::from_hop_config(&hop.config),
        }
    }

    fn append_secret_slots(&self, profile_id: &str, slots: &mut Vec<SecretSlot>) {
        self.config.append_secret_slots(
            profile_id,
            &format!("transport.chain.{}", self.name),
            slots,
        );
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PortableProxyHopConfig {
    Ssh(PortableSshProxyHop),
    Socks5(PortableProxyTransport),
    HttpConnect(PortableProxyTransport),
}

impl PortableProxyHopConfig {
    fn from_hop_config(config: &ProxyHopConfig) -> Self {
        match config {
            ProxyHopConfig::Ssh(config) => Self::Ssh(PortableSshProxyHop::from_hop(config)),
            ProxyHopConfig::Socks5(config) => {
                Self::Socks5(PortableProxyTransport::from_transport(config))
            }
            ProxyHopConfig::HttpConnect(config) => {
                Self::HttpConnect(PortableProxyTransport::from_transport(config))
            }
        }
    }

    fn append_secret_slots(&self, profile_id: &str, path: &str, slots: &mut Vec<SecretSlot>) {
        match self {
            Self::Ssh(config) => config.append_secret_slots(profile_id, path, slots),
            Self::Socks5(config) | Self::HttpConnect(config) => {
                config.append_secret_slots(profile_id, path, slots);
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct PortableSshProxyHop {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub username: String,
    #[serde(default)]
    pub auth: PortableSshAuthConfig,
    #[serde(default)]
    pub strict_host_key: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_key: Option<String>,
}

impl PortableSshProxyHop {
    fn from_hop(hop: &SshProxyHop) -> Self {
        Self {
            ssh_host: hop.ssh_host.clone(),
            ssh_port: hop.ssh_port,
            username: hop.username.clone(),
            auth: PortableSshAuthConfig::from_ssh_auth(&hop.auth),
            strict_host_key: hop.strict_host_key,
            host_key: hop.host_key.clone(),
        }
    }

    fn append_secret_slots(&self, profile_id: &str, path: &str, slots: &mut Vec<SecretSlot>) {
        self.auth
            .append_secret_slots(profile_id, &format!("{path}.ssh"), slots);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PortableSshAuthConfig {
    Agent,
    PasswordRequired,
    PrivateKeyRequired { passphrase_required: bool },
}

impl Default for PortableSshAuthConfig {
    fn default() -> Self {
        Self::Agent
    }
}

impl PortableSshAuthConfig {
    fn from_ssh_auth(auth: &SshAuthConfig) -> Self {
        match auth {
            SshAuthConfig::Agent => Self::Agent,
            SshAuthConfig::Password { .. } => Self::PasswordRequired,
            SshAuthConfig::PrivateKey { passphrase, .. } => Self::PrivateKeyRequired {
                passphrase_required: passphrase.is_some(),
            },
        }
    }

    fn append_secret_slots(&self, profile_id: &str, path: &str, slots: &mut Vec<SecretSlot>) {
        match self {
            Self::Agent => {}
            Self::PasswordRequired => slots.push(SecretSlot::new(
                profile_id,
                format!("{path}.password"),
                SecretSlotPurpose::SshPassword,
            )),
            Self::PrivateKeyRequired {
                passphrase_required,
            } => {
                slots.push(SecretSlot::new(
                    profile_id,
                    format!("{path}.privateKey"),
                    SecretSlotPurpose::PrivateKey,
                ));
                if *passphrase_required {
                    slots.push(SecretSlot::new(
                        profile_id,
                        format!("{path}.passphrase"),
                        SecretSlotPurpose::Passphrase,
                    ));
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PortableAuthConfig {
    None,
    SecretRequired,
    TokenRequired,
    KeyPairRequired { passphrase_required: bool },
}

impl Default for PortableAuthConfig {
    fn default() -> Self {
        Self::None
    }
}

impl PortableAuthConfig {
    fn from_auth(auth: &AuthConfig) -> Self {
        match auth {
            AuthConfig::None => Self::None,
            AuthConfig::Secret { .. } => Self::SecretRequired,
            AuthConfig::Token { .. } => Self::TokenRequired,
            AuthConfig::KeyPair { passphrase, .. } => Self::KeyPairRequired {
                passphrase_required: passphrase.is_some(),
            },
        }
    }

    fn append_secret_slots(&self, profile_id: &str, path: &str, slots: &mut Vec<SecretSlot>) {
        match self {
            Self::None => {}
            Self::SecretRequired => slots.push(SecretSlot::new(
                profile_id,
                format!("{path}.secret"),
                SecretSlotPurpose::Password,
            )),
            Self::TokenRequired => slots.push(SecretSlot::new(
                profile_id,
                format!("{path}.token"),
                SecretSlotPurpose::Token,
            )),
            Self::KeyPairRequired {
                passphrase_required,
            } => {
                slots.push(SecretSlot::new(
                    profile_id,
                    format!("{path}.privateKey"),
                    SecretSlotPurpose::PrivateKey,
                ));
                if *passphrase_required {
                    slots.push(SecretSlot::new(
                        profile_id,
                        format!("{path}.passphrase"),
                        SecretSlotPurpose::Passphrase,
                    ));
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SecretSlot {
    pub profile_id: String,
    pub path: String,
    pub purpose: SecretSlotPurpose,
}

impl SecretSlot {
    fn new(
        profile_id: impl Into<String>,
        path: impl Into<String>,
        purpose: SecretSlotPurpose,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            path: path.into(),
            purpose,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum SecretSlotPurpose {
    Password,
    Token,
    PrivateKey,
    Passphrase,
    SshPassword,
    ProxyPassword,
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
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_profile() -> ConnectionProfile {
        ConnectionProfile {
            id: "local-postgres".to_string(),
            display_name: "Local Postgres".to_string(),
            source: SourceKind::postgresql(),
            transport: TransportConfig::Direct(DirectTransport {
                host: "localhost".to_string(),
                port: Some(5432),
                tls: true,
            }),
            database: Some("app".to_string()),
            user: Some("irodori".to_string()),
            auth: AuthConfig::Secret {
                secret: SecretRef::new("keychain:local-postgres/password"),
            },
            options: BTreeMap::from([("applicationName".to_string(), "irodori".to_string())]),
        }
    }

    #[test]
    fn valid_connection_profile_passes_validation() {
        assert!(valid_profile().validate().is_ok());
    }

    #[test]
    fn invalid_required_fields_fail_validation() {
        let mut profile = valid_profile();
        profile.id = " ".to_string();
        assert!(profile.validate().is_err());

        let mut profile = valid_profile();
        profile.display_name = " ".to_string();
        assert!(profile.validate().is_err());

        let mut profile = valid_profile();
        profile.source.id.clear();
        assert!(profile.validate().is_err());

        let mut profile = valid_profile();
        profile.transport = TransportConfig::Direct(DirectTransport::new(" ", Some(5432)));
        assert!(profile.validate().is_err());

        let mut profile = valid_profile();
        profile.transport = TransportConfig::Direct(DirectTransport::new("localhost", Some(0)));
        assert!(profile.validate().is_err());
    }

    #[test]
    fn connection_profile_serializes_with_camel_case_fields() {
        assert_eq!(
            serde_json::to_value(valid_profile()).unwrap(),
            json!({
                "id": "local-postgres",
                "displayName": "Local Postgres",
                "source": {
                    "id": "postgresql",
                    "family": "sql"
                },
                "transport": {
                    "kind": "direct",
                    "host": "localhost",
                    "port": 5432,
                    "tls": true
                },
                "database": "app",
                "user": "irodori",
                "auth": {
                    "kind": "secret",
                    "secret": {
                        "handle": "keychain:local-postgres/password"
                    }
                },
                "options": {
                    "applicationName": "irodori"
                }
            })
        );
    }

    #[test]
    fn secret_material_is_not_part_of_the_profile_shape() {
        let mut profile = valid_profile();
        profile
            .options
            .insert("password".to_string(), "supersecret".to_string());

        assert!(profile.validate().is_err());

        let serialized = serde_json::to_string(&valid_profile()).unwrap();
        assert!(!serialized.contains("supersecret"));
        assert!(!serialized.contains("\"password\""));
    }

    #[test]
    fn connection_profile_export_has_schema_version_and_excludes_secret_handles() {
        let mut profile = valid_profile();
        profile.transport = TransportConfig::SshTunnel(SshTunnelTransport {
            auth: SshAuthConfig::Password {
                password: SecretRef::new("keychain:ssh/supersecret"),
            },
            ..SshTunnelTransport::new("bastion.internal", "deploy", "db.internal", 5432)
        });

        let export = ConnectionProfileExport::from_profiles([&profile]).unwrap();
        assert_eq!(export.schema_version, CONNECTION_PROFILE_SCHEMA_VERSION);
        assert_eq!(export.profiles[0].auth, PortableAuthConfig::SecretRequired);

        let serialized = serde_json::to_string(&export).unwrap();
        assert!(serialized.contains("\"schemaVersion\":1"));
        assert!(serialized.contains("\"secretRequired\""));
        assert!(serialized.contains("\"passwordRequired\""));
        assert!(!serialized.contains("keychain:"));
        assert!(!serialized.contains("supersecret"));
        assert!(!serialized.contains("local-postgres/password"));
    }

    #[test]
    fn portable_profile_reports_secret_slots_for_import_relinking() {
        let mut profile = valid_profile();
        profile.transport = TransportConfig::SshTunnel(SshTunnelTransport {
            auth: SshAuthConfig::Password {
                password: SecretRef::new("keychain:ssh/password"),
            },
            ..SshTunnelTransport::new("bastion.internal", "deploy", "db.internal", 5432)
        });

        let portable = PortableConnectionProfile::from_profile(&profile);
        assert_eq!(
            portable.required_secret_slots(),
            vec![
                SecretSlot {
                    profile_id: "local-postgres".to_string(),
                    path: "auth.secret".to_string(),
                    purpose: SecretSlotPurpose::Password,
                },
                SecretSlot {
                    profile_id: "local-postgres".to_string(),
                    path: "transport.ssh.password".to_string(),
                    purpose: SecretSlotPurpose::SshPassword,
                },
            ]
        );
    }

    #[test]
    fn connection_profile_export_rejects_unsupported_schema_versions() {
        let export = ConnectionProfileExport {
            schema_version: CONNECTION_PROFILE_SCHEMA_VERSION + 1,
            profiles: Vec::new(),
        };

        let error = export.validate_schema_version().unwrap_err();
        assert_eq!(error.kind, crate::IrodoriErrorKind::Validation);
        assert!(error.message.contains("schema version"));
    }

    #[test]
    fn unknown_password_field_is_rejected_on_deserialize() {
        let value = json!({
            "id": "local-postgres",
            "displayName": "Local Postgres",
            "source": {
                "id": "postgresql",
                "family": "sql"
            },
            "transport": {
                "kind": "direct",
                "host": "localhost",
                "port": 5432,
                "tls": true
            },
            "auth": {
                "kind": "none"
            },
            "options": {},
            "password": "supersecret"
        });

        assert!(serde_json::from_value::<ConnectionProfile>(value).is_err());
    }

    #[test]
    fn ssh_tunnel_supports_agent_password_and_key_auth_refs() {
        let agent = TransportConfig::SshTunnel(SshTunnelTransport::new(
            "bastion.internal",
            "deploy",
            "db.internal",
            5432,
        ));
        assert!(agent.validate().is_ok());

        let password = TransportConfig::SshTunnel(SshTunnelTransport {
            auth: SshAuthConfig::Password {
                password: SecretRef::new("keychain:conn/ssh-password"),
            },
            ..SshTunnelTransport::new("bastion.internal", "deploy", "db.internal", 5432)
        });
        assert!(password.validate().is_ok());

        let private_key = TransportConfig::SshTunnel(SshTunnelTransport {
            auth: SshAuthConfig::PrivateKey {
                private_key: SecretRef::new("keychain:conn/private-key"),
                passphrase: Some(SecretRef::new("keychain:conn/private-key-passphrase")),
            },
            ..SshTunnelTransport::new("bastion.internal", "deploy", "db.internal", 5432)
        });
        assert!(private_key.validate().is_ok());
    }

    #[test]
    fn proxy_chain_requires_named_unique_valid_hops() {
        let chain = TransportConfig::Chain(ProxyChainTransport::new(
            "db.internal",
            5432,
            vec![
                ProxyChainHop::new(
                    "corp-bastion",
                    ProxyHopConfig::Ssh(SshProxyHop::new("bastion.internal", "deploy")),
                ),
                ProxyChainHop::new(
                    "region-socks",
                    ProxyHopConfig::Socks5(ProxyTransport {
                        auth: Some(ProxyAuthConfig {
                            username: "proxy-user".to_string(),
                            password: SecretRef::new("keychain:proxy/password"),
                        }),
                        ..ProxyTransport::new("socks.internal", 1080)
                    }),
                ),
            ],
        ));
        assert!(chain.validate().is_ok());

        let duplicate = TransportConfig::Chain(ProxyChainTransport::new(
            "db.internal",
            5432,
            vec![
                ProxyChainHop::new(
                    "same",
                    ProxyHopConfig::HttpConnect(ProxyTransport::new("proxy-a.internal", 8080)),
                ),
                ProxyChainHop::new(
                    "same",
                    ProxyHopConfig::HttpConnect(ProxyTransport::new("proxy-b.internal", 8080)),
                ),
            ],
        ));
        let error = duplicate.validate().unwrap_err();
        assert!(error.message.contains("duplicated"));

        let too_short = TransportConfig::Chain(ProxyChainTransport::new(
            "db.internal",
            5432,
            vec![ProxyChainHop::new(
                "only-hop",
                ProxyHopConfig::Socks5(ProxyTransport::new("socks.internal", 1080)),
            )],
        ));
        let error = too_short.validate().unwrap_err();
        assert!(error.message.contains("at least two"));
    }
}
