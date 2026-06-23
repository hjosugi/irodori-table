use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod db;
pub mod security;

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
enum DbObjectKind {
    Table,
    View,
    Procedure,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
enum ConnectionStatus {
    Connected,
    Idle,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
struct DbObject {
    name: String,
    kind: DbObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    rows: Option<String>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
struct Connection {
    id: String,
    name: String,
    engine: String,
    status: ConnectionStatus,
    latency_ms: u16,
    proxy: String,
    objects: Vec<DbObject>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    connections: Vec<Connection>,
    active_connection_id: String,
}

#[tauri::command]
fn workspace_snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        active_connection_id: "local-pg".into(),
        connections: vec![
            Connection {
                id: "local-pg".into(),
                name: "Local Warehouse".into(),
                engine: "PostgreSQL 16".into(),
                status: ConnectionStatus::Connected,
                latency_ms: 3,
                proxy: "direct".into(),
                objects: vec![
                    DbObject {
                        name: "orders".into(),
                        kind: DbObjectKind::Table,
                        rows: Some("1.2M".into()),
                    },
                    DbObject {
                        name: "customers".into(),
                        kind: DbObjectKind::Table,
                        rows: Some("83K".into()),
                    },
                    DbObject {
                        name: "invoice_lines".into(),
                        kind: DbObjectKind::Table,
                        rows: Some("4.8M".into()),
                    },
                    DbObject {
                        name: "recent_revenue".into(),
                        kind: DbObjectKind::View,
                        rows: None,
                    },
                    DbObject {
                        name: "refresh_rollups".into(),
                        kind: DbObjectKind::Procedure,
                        rows: None,
                    },
                ],
            },
            Connection {
                id: "oracle-dev".into(),
                name: "Oracle Dev".into(),
                engine: "Oracle 23ai".into(),
                status: ConnectionStatus::Idle,
                latency_ms: 18,
                proxy: "ssh > socks5".into(),
                objects: vec![
                    DbObject {
                        name: "APP_USERS".into(),
                        kind: DbObjectKind::Table,
                        rows: Some("42K".into()),
                    },
                    DbObject {
                        name: "LEDGER_ENTRY".into(),
                        kind: DbObjectKind::Table,
                        rows: Some("9.1M".into()),
                    },
                    DbObject {
                        name: "PKG_BILLING".into(),
                        kind: DbObjectKind::Procedure,
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
        .plugin(tauri_plugin_dialog::init())
        .manage(db::DbState::default())
        .manage(security::SecurityState::default())
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            db::db_connect,
            db::db_run_query,
            db::db_run_query_stream,
            db::db_cancel,
            db::db_apply_edits,
            db::db_list_objects,
            db::db_disconnect,
            security::security_get_privacy_mode,
            security::security_set_privacy_mode,
            security::security_redact_text,
            security::security_export_audit,
            security::security_store_secret,
            security::security_delete_secret,
            security::network_transport_plan,
            security::network_diagnose_transport
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod typegen {
    use super::*;
    use std::path::Path;
    use typebridge::ir::{Decl, TsType};
    use typebridge::{Arg, Bridge, Command};
    use typebridge_ts_rs::decl;

    const GENERATED: &str = "../src/generated/irodori-api.ts";

    /// The single source of truth for the desktop TypeScript boundary.
    ///
    /// Each Rust type is rendered by ts-rs via [`decl`]; `typebridge` assembles the
    /// module header, the typed Tauri command wrappers, and (in CI) the drift
    /// check. `JsonValue` is a hand-declared alias because `serde_json::Value`
    /// renders to a bare `JsonValue` reference under ts-rs's `serde-json-impl`.
    fn bridge() -> Bridge {
        Bridge::tauri()
            .header("// @generated by cargo test export_typescript_bindings. Do not edit.")
            .decl(&Decl::alias("JsonValue", TsType::unknown()))
            .decl(&decl::<irodori_core::IrodoriErrorKind>())
            .decl(&decl::<irodori_core::IrodoriError>())
            .decl(&decl::<irodori_core::CommandResult<serde_json::Value>>())
            .decl(&decl::<irodori_core::PrivacyMode>())
            .decl(&decl::<irodori_core::RedactionReport>())
            .decl(&decl::<irodori_core::RedactedExport>())
            .decl(&decl::<irodori_core::SecretRef>())
            .decl(&decl::<irodori_core::TransportConfig>())
            .decl(&decl::<irodori_core::DirectTransport>())
            .decl(&decl::<irodori_core::LocalFileTransport>())
            .decl(&decl::<irodori_core::SshTunnelTransport>())
            .decl(&decl::<irodori_core::SshAuthConfig>())
            .decl(&decl::<irodori_core::ProxyTransport>())
            .decl(&decl::<irodori_core::ProxyAuthConfig>())
            .decl(&decl::<irodori_core::ProxyChainTransport>())
            .decl(&decl::<irodori_core::ProxyChainHop>())
            .decl(&decl::<irodori_core::ProxyHopConfig>())
            .decl(&decl::<irodori_core::SshProxyHop>())
            .decl(&decl::<irodori_proxy::DialTarget>())
            .decl(&decl::<irodori_proxy::TransportStepKind>())
            .decl(&decl::<irodori_proxy::TransportStep>())
            .decl(&decl::<irodori_proxy::TransportPlan>())
            .decl(&decl::<irodori_proxy::DiagnosticStageKind>())
            .decl(&decl::<irodori_proxy::DiagnosticStatus>())
            .decl(&decl::<irodori_proxy::DiagnosticStage>())
            .decl(&decl::<irodori_proxy::ConnectionDiagnostics>())
            .decl(&decl::<security::DesktopSecretPurpose>())
            .decl(&decl::<DbObjectKind>())
            .decl(&decl::<ConnectionStatus>())
            .decl(&decl::<DbObject>())
            .decl(&decl::<Connection>())
            .decl(&decl::<WorkspaceSnapshot>())
            .decl(&decl::<db::DbEngine>())
            .decl(&decl::<db::ConnectionProfile>())
            .decl(&decl::<db::ConnectionInfo>())
            .decl(&decl::<db::QueryResult>())
            .decl(&decl::<db::DatabaseMetadata>())
            .decl(&decl::<db::SchemaMetadata>())
            .decl(&decl::<db::ForeignKey>())
            .decl(&decl::<db::DbObjectMetadata>())
            .decl(&decl::<db::DbObjectMetadataKind>())
            .decl(&decl::<db::ColumnMetadata>())
            .decl(&decl::<db::IndexMetadata>())
            .decl(&decl::<db::CellValue>())
            .decl(&decl::<db::RowUpdate>())
            .decl(&decl::<db::RowInsert>())
            .decl(&decl::<db::RowDelete>())
            .decl(&decl::<db::TableEdits>())
            .decl(&decl::<db::AppliedEdits>())
            .command(Command::new("workspace_snapshot", "WorkspaceSnapshot"))
            .command(
                Command::new("db_connect", "ConnectionInfo")
                    .arg(Arg::new("profile", TsType::named("ConnectionProfile"))),
            )
            .command(
                Command::new("db_run_query", "QueryResult")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("sql", TsType::string()))
                    .arg(Arg::rust("max_rows", TsType::number()).optional())
                    .arg(Arg::rust("timeout_ms", TsType::number()).optional())
                    .arg(Arg::rust("query_id", TsType::string()).optional()),
            )
            .command(
                Command::returning("db_cancel", TsType::boolean())
                    .arg(Arg::rust("query_id", TsType::string())),
            )
            .command(
                Command::new("db_apply_edits", "AppliedEdits")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("edits", TsType::named("TableEdits"))),
            )
            .command(
                Command::new("db_list_objects", "DatabaseMetadata")
                    .arg(Arg::rust("connection_id", TsType::string())),
            )
            .command(
                Command::returning("db_disconnect", TsType::void())
                    .arg(Arg::rust("connection_id", TsType::string())),
            )
            .command(Command::new("security_get_privacy_mode", "PrivacyMode"))
            .command(
                Command::new("security_set_privacy_mode", "PrivacyMode")
                    .arg(Arg::new("mode", TsType::named("PrivacyMode"))),
            )
            .command(
                Command::new("security_redact_text", "RedactionReport")
                    .arg(Arg::new("text", TsType::string())),
            )
            .command(Command::new("security_export_audit", "RedactedExport"))
            .command(
                Command::new("security_store_secret", "SecretRef")
                    .arg(Arg::rust("connection_id", TsType::string()))
                    .arg(Arg::new("purpose", TsType::named("DesktopSecretPurpose")))
                    .arg(Arg::new("value", TsType::string())),
            )
            .command(
                Command::returning("security_delete_secret", TsType::void())
                    .arg(Arg::new("secret", TsType::named("SecretRef"))),
            )
            .command(
                Command::new("network_transport_plan", "TransportPlan")
                    .arg(Arg::new("transport", TsType::named("TransportConfig"))),
            )
            .command(
                Command::new("network_diagnose_transport", "ConnectionDiagnostics")
                    .arg(Arg::new("transport", TsType::named("TransportConfig"))),
            )
    }

    /// Locally (and through `npm run typegen`) this regenerates the committed
    /// bindings. Under `CI` it instead asserts they are up to date, turning a Rust
    /// type change without a regenerate into a failing build.
    #[test]
    fn export_typescript_bindings() {
        let rendered = bridge().render();
        let path = Path::new(GENERATED);

        if std::env::var_os("CI").is_some() {
            let outcome = rendered.check(path).expect("read generated bindings");
            assert!(
                outcome.is_up_to_date(),
                "{} — run `npm run typegen` and commit the result",
                outcome.summary()
            );
        } else {
            rendered.write(path).expect("write generated bindings");
        }
    }
}
