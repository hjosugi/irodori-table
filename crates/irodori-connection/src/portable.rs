use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use irodori_error::{IrodoriError, Result};

use super::{
    AuthConfig, ConnectionProfile, DirectTransport, LocalFileTransport, ProxyAuthConfig,
    ProxyChainHop, ProxyChainTransport, ProxyHopConfig, ProxyTransport, SourceKind, SshAuthConfig,
    SshProxyHop, SshTunnelTransport, TransportConfig, CONNECTION_PROFILE_SCHEMA_VERSION,
};

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
