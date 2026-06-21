#[derive(serde::Serialize)]
struct DbObject {
    name: &'static str,
    kind: &'static str,
    rows: Option<&'static str>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    id: &'static str,
    name: &'static str,
    engine: &'static str,
    status: &'static str,
    latency_ms: u16,
    proxy: &'static str,
    objects: Vec<DbObject>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    connections: Vec<Connection>,
    active_connection_id: &'static str,
}

#[tauri::command]
fn workspace_snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        active_connection_id: "local-pg",
        connections: vec![
            Connection {
                id: "local-pg",
                name: "Local Warehouse",
                engine: "PostgreSQL 16",
                status: "connected",
                latency_ms: 3,
                proxy: "direct",
                objects: vec![
                    DbObject {
                        name: "orders",
                        kind: "table",
                        rows: Some("1.2M"),
                    },
                    DbObject {
                        name: "customers",
                        kind: "table",
                        rows: Some("83K"),
                    },
                    DbObject {
                        name: "invoice_lines",
                        kind: "table",
                        rows: Some("4.8M"),
                    },
                    DbObject {
                        name: "recent_revenue",
                        kind: "view",
                        rows: None,
                    },
                    DbObject {
                        name: "refresh_rollups",
                        kind: "procedure",
                        rows: None,
                    },
                ],
            },
            Connection {
                id: "oracle-dev",
                name: "Oracle Dev",
                engine: "Oracle 23ai",
                status: "idle",
                latency_ms: 18,
                proxy: "ssh > socks5",
                objects: vec![
                    DbObject {
                        name: "APP_USERS",
                        kind: "table",
                        rows: Some("42K"),
                    },
                    DbObject {
                        name: "LEDGER_ENTRY",
                        kind: "table",
                        rows: Some("9.1M"),
                    },
                    DbObject {
                        name: "PKG_BILLING",
                        kind: "procedure",
                        rows: None,
                    },
                ],
            },
        ],
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![workspace_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
