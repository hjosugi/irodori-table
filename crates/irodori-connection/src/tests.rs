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
    assert_eq!(error.kind, irodori_error::IrodoriErrorKind::Validation);
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
