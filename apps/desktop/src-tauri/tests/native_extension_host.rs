use std::collections::BTreeMap;

use desktop_lib::db::{self, ConnectionProfile, DbEngine};
use desktop_lib::extensions::{self, ExtensionInstallRequest};
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
    }
}

#[tokio::test]
#[ignore = "requires a Memgraph server on 127.0.0.1:17687 and network access to GitHub Releases"]
async fn memgraph_release_installs_connects_queries_metadata_and_uninstalls() {
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
    assert_eq!(installed.engine, "memgraph");
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
