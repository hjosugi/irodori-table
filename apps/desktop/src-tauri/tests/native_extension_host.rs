use std::collections::BTreeMap;

use desktop_lib::db::{self, ConnectionProfile, DbEngine};
use desktop_lib::extensions::{self, ExtensionInstallKind, ExtensionInstallRequest};
use desktop_lib::security::SecurityState;
use tauri::Manager;

fn memgraph_profile() -> ConnectionProfile {
    ConnectionProfile {
        id: "memgraph-extension-smoke".into(),
        engine: DbEngine::Memgraph,
        host: Some("127.0.0.1".into()),
        port: Some(17687),
        user: None,
        password: None,
        database: Some("memgraph".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: BTreeMap::new(),
    }
}

fn memgraph_release_request() -> ExtensionInstallRequest {
    ExtensionInstallRequest {
        id: "irodori.memgraph".into(),
        version: "0.1.3".into(),
        kind: ExtensionInstallKind::GithubRelease,
        repository: "hjosugi/irodori-extension-memgraph".into(),
        asset_name: "irodori-extension-memgraph.tar.gz".into(),
        tag: "v0.1.3".into(),
        sha256: "sha256:dc6deb44e1ecb1d0a4153917cc809692e37d1a5d814be4752af60649c5595232".into(),
        permissions: vec![
            "connections:read".into(),
            "connections:write".into(),
            "queries:run".into(),
            "metadata:read".into(),
            "native".into(),
            "connectors".into(),
        ],
        manifest_path: None,
    }
}

fn knowledge_release_request() -> ExtensionInstallRequest {
    ExtensionInstallRequest {
        id: "irodori.knowledge".into(),
        version: "0.1.0".into(),
        kind: ExtensionInstallKind::GithubRelease,
        repository: "hjosugi/irodori-extension-knowledge".into(),
        asset_name: "irodori-extension-knowledge.tar.gz".into(),
        tag: "v0.1.0".into(),
        sha256: "sha256:0c06dde38713d8548d2b7d50988442924b3405608e7c4381ed9be86474fa1308".into(),
        permissions: vec!["hostFeatures".into()],
        manifest_path: None,
    }
}

fn datalake_release_request() -> ExtensionInstallRequest {
    ExtensionInstallRequest {
        id: "irodori.datalake".into(),
        version: "0.1.0".into(),
        kind: ExtensionInstallKind::GithubRelease,
        repository: "hjosugi/irodori-extension-datalake".into(),
        asset_name: "irodori-extension-datalake.tar.gz".into(),
        tag: "v0.1.0".into(),
        sha256: "sha256:16fd46dae9e49597067c89ec116274c2b595fd5c6da7857aae9c97af242e1bde".into(),
        permissions: vec!["hostFeatures".into()],
        manifest_path: None,
    }
}

#[tokio::test]
#[ignore = "downloads pinned public feature releases; run with an isolated XDG_DATA_HOME"]
async fn feature_releases_install_toggle_and_uninstall() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(extensions::ExtensionsState::default())
        .build(tauri::generate_context!())
        .expect("build tauri test app");
    let handle = app.handle().clone();
    let extension_state = app.state::<extensions::ExtensionsState>();

    let installed = extensions::ext_install(
        handle.clone(),
        extension_state.clone(),
        knowledge_release_request(),
    )
    .await
    .expect("install knowledge extension");
    assert_eq!(installed.runtime, "declarative");
    assert_eq!(installed.host_features, vec!["knowledge"]);
    assert!(installed.engine.is_none());
    assert!(installed.library_path.is_none());

    let disabled = extensions::ext_set_enabled(
        handle.clone(),
        extension_state.clone(),
        installed.id.clone(),
        false,
    )
    .await
    .expect("disable knowledge extension");
    assert!(!disabled.enabled);

    let enabled = extensions::ext_set_enabled(
        handle.clone(),
        extension_state.clone(),
        installed.id.clone(),
        true,
    )
    .await
    .expect("enable knowledge extension");
    assert!(enabled.enabled);

    assert!(
        extensions::ext_uninstall(handle.clone(), extension_state.clone(), installed.id)
            .await
            .expect("uninstall knowledge extension")
    );

    let datalake = extensions::ext_install(
        handle.clone(),
        extension_state.clone(),
        datalake_release_request(),
    )
    .await
    .expect("install datalake extension");
    assert_eq!(datalake.runtime, "declarative");
    assert_eq!(datalake.host_features, vec!["datalake"]);
    assert!(datalake.engine.is_none());
    assert!(datalake.library_path.is_none());

    let disabled = extensions::ext_set_enabled(
        handle.clone(),
        extension_state.clone(),
        datalake.id.clone(),
        false,
    )
    .await
    .expect("disable datalake extension");
    assert!(!disabled.enabled);

    let enabled = extensions::ext_set_enabled(
        handle.clone(),
        extension_state.clone(),
        datalake.id.clone(),
        true,
    )
    .await
    .expect("enable datalake extension");
    assert!(enabled.enabled);

    assert!(
        extensions::ext_uninstall(handle.clone(), extension_state.clone(), datalake.id)
            .await
            .expect("uninstall datalake extension")
    );

    assert!(extensions::ext_list(handle, extension_state)
        .await
        .expect("list extensions")
        .is_empty());
}

#[tokio::test]
#[ignore = "requires a Memgraph server on 127.0.0.1:17687 and network access to GitHub Releases"]
async fn memgraph_release_installs_connects_queries_metadata_and_uninstalls() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(extensions::ExtensionsState::default())
        .build(tauri::generate_context!())
        .expect("build tauri test app");
    let handle = app.handle().clone();
    let extension_state = app.state::<extensions::ExtensionsState>();

    let installed = extensions::ext_install(
        handle.clone(),
        extension_state.clone(),
        memgraph_release_request(),
    )
    .await
    .expect("install memgraph extension");
    assert_eq!(installed.id, "irodori.memgraph");
    assert_eq!(installed.engine.as_deref(), Some("memgraph"));
    assert!(installed.supported_calls.iter().any(|call| call == "query"));

    let db_state = db::DbState::default();
    let security = SecurityState::default();
    let info = db::connect_impl(&db_state, &security, Some(&handle), memgraph_profile())
        .await
        .expect("connect through native extension host");
    assert_eq!(info.engine, DbEngine::Memgraph);

    let result = db::run_query_impl(
        &db_state,
        "memgraph-extension-smoke".into(),
        "CREATE (p) SET p.name = 'Irodori' RETURN p.name AS name".into(),
        Some(10),
    )
    .await
    .expect("query through native extension host");
    assert_eq!(result.columns, vec!["name"]);
    assert_eq!(result.rows[0][0], "Irodori");

    let metadata = db::list_objects_impl(&db_state, "memgraph-extension-smoke".into())
        .await
        .expect("metadata through native extension host");
    assert!(!metadata.schemas.is_empty());

    db::disconnect_impl(&db_state, "memgraph-extension-smoke".into())
        .await
        .expect("disconnect native extension connection");
    assert!(
        extensions::ext_uninstall(handle, extension_state, "irodori.memgraph".into())
            .await
            .expect("uninstall memgraph extension")
    );
}
