use irodori_core::{ProxyAuthConfig, ProxyHopConfig, ProxyTransport, SecretRef, SshAuthConfig};
use irodori_proxy::{
    ResolvedProxy, ResolvedProxyAuth, ResolvedProxyChain, ResolvedProxyChainHop,
    ResolvedProxyHopConfig, ResolvedSshAuth, ResolvedSshTunnel, ResolvedTransport,
};

async fn resolve_secret_ref(
    store: &irodori_secure_store::OsKeychainStore,
    secret_ref: &SecretRef,
) -> Result<String, String> {
    use irodori_secure_store::SecureStore;
    store
        .get(secret_ref)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("secret not found for handle: {}", secret_ref.handle))
}

async fn resolve_ssh_auth(
    store: &irodori_secure_store::OsKeychainStore,
    auth: &SshAuthConfig,
) -> Result<ResolvedSshAuth, String> {
    match auth {
        SshAuthConfig::Agent => Ok(ResolvedSshAuth::Agent),
        SshAuthConfig::Password { password } => {
            let pass = resolve_secret_ref(store, password).await?;
            Ok(ResolvedSshAuth::Password(pass))
        }
        SshAuthConfig::PrivateKey {
            private_key,
            passphrase,
        } => {
            let key = resolve_secret_ref(store, private_key).await?;
            let pass = match passphrase {
                Some(handle) => Some(resolve_secret_ref(store, handle).await?),
                None => None,
            };
            Ok(ResolvedSshAuth::PrivateKey {
                private_key: key,
                passphrase: pass,
            })
        }
    }
}

async fn resolve_proxy_auth(
    store: &irodori_secure_store::OsKeychainStore,
    auth: Option<&ProxyAuthConfig>,
) -> Result<Option<ResolvedProxyAuth>, String> {
    let Some(auth) = auth else {
        return Ok(None);
    };
    Ok(Some(ResolvedProxyAuth {
        username: auth.username.clone(),
        password: resolve_secret_ref(store, &auth.password).await?,
    }))
}

fn proxy_target(proxy: &ProxyTransport) -> Result<(String, u16), String> {
    let target_host = proxy
        .target_host
        .clone()
        .ok_or("proxy target host is missing")?;
    let target_port = proxy.target_port.ok_or("proxy target port is missing")?;
    Ok((target_host, target_port))
}

async fn resolve_proxy_transport(
    store: &irodori_secure_store::OsKeychainStore,
    proxy: &ProxyTransport,
) -> Result<ResolvedProxy, String> {
    let auth = resolve_proxy_auth(store, proxy.auth.as_ref()).await?;
    let (target_host, target_port) = proxy_target(proxy)?;
    Ok(ResolvedProxy {
        host: proxy.host.clone(),
        port: proxy.port,
        auth,
        target_host,
        target_port,
        tls: proxy.tls,
    })
}

async fn resolve_proxy_hop_config(
    store: &irodori_secure_store::OsKeychainStore,
    config: &ProxyHopConfig,
) -> Result<ResolvedProxyHopConfig, String> {
    match config {
        ProxyHopConfig::Ssh(ssh_hop) => Ok(ResolvedProxyHopConfig::Ssh {
            ssh_host: ssh_hop.ssh_host.clone(),
            ssh_port: ssh_hop.ssh_port,
            username: ssh_hop.username.clone(),
            auth: resolve_ssh_auth(store, &ssh_hop.auth).await?,
            strict_host_key: ssh_hop.strict_host_key,
            host_key: ssh_hop.host_key.clone(),
        }),
        ProxyHopConfig::Socks5(proxy) => Ok(ResolvedProxyHopConfig::Socks5 {
            host: proxy.host.clone(),
            port: proxy.port,
            auth: resolve_proxy_auth(store, proxy.auth.as_ref()).await?,
        }),
        ProxyHopConfig::HttpConnect(proxy) => Ok(ResolvedProxyHopConfig::HttpConnect {
            host: proxy.host.clone(),
            port: proxy.port,
            auth: resolve_proxy_auth(store, proxy.auth.as_ref()).await?,
        }),
    }
}

pub(super) async fn resolve_transport(
    store: &irodori_secure_store::OsKeychainStore,
    transport: &irodori_core::TransportConfig,
) -> Result<ResolvedTransport, String> {
    match transport {
        irodori_core::TransportConfig::Direct(_) | irodori_core::TransportConfig::LocalFile(_) => {
            Err("direct and local file transports do not require resolution".to_string())
        }
        irodori_core::TransportConfig::SshTunnel(tunnel) => {
            Ok(ResolvedTransport::SshTunnel(ResolvedSshTunnel {
                ssh_host: tunnel.ssh_host.clone(),
                ssh_port: tunnel.ssh_port,
                username: tunnel.username.clone(),
                auth: resolve_ssh_auth(store, &tunnel.auth).await?,
                target_host: tunnel.target_host.clone(),
                target_port: tunnel.target_port,
                strict_host_key: tunnel.strict_host_key,
                host_key: tunnel.host_key.clone(),
            }))
        }
        irodori_core::TransportConfig::Socks5Proxy(proxy) => {
            let proxy = resolve_proxy_transport(store, proxy).await?;
            Ok(ResolvedTransport::Socks5Proxy(proxy))
        }
        irodori_core::TransportConfig::HttpConnectProxy(proxy) => {
            let proxy = resolve_proxy_transport(store, proxy).await?;
            Ok(ResolvedTransport::HttpConnectProxy(proxy))
        }
        irodori_core::TransportConfig::Chain(chain) => {
            let mut resolved_hops = Vec::new();
            for hop in &chain.hops {
                resolved_hops.push(ResolvedProxyChainHop {
                    name: hop.name.clone(),
                    config: resolve_proxy_hop_config(store, &hop.config).await?,
                });
            }
            Ok(ResolvedTransport::Chain(ResolvedProxyChain {
                target_host: chain.target_host.clone(),
                target_port: chain.target_port,
                tls: chain.tls,
                hops: resolved_hops,
            }))
        }
    }
}
