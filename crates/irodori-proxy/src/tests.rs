use super::*;
use irodori_core::{
    IrodoriErrorKind, ProxyAuthConfig, ProxyHopConfig, ProxyTransport, SecretRef, SshAuthConfig,
    SshProxyHop, SshTunnelTransport, TransportConfig,
};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
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
        http_connect_handshake_sync(client, "example.com", 80, Some(("admin", "secret"))).unwrap();

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
