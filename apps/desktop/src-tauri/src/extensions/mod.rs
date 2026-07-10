//! Native connector-extension host.
//!
//! Extensions are cdylibs published by the `irodori-extension-*` repos and
//! described by `registry/catalog/index.json`. This module owns the install
//! pipeline (download → integrity check → unpack → manifest validation), the
//! on-disk registry of installed extensions, and the dynamic loading that
//! `db::connection::connect_engine` dispatches to for engines without a
//! built-in driver.

mod abi;
mod connection;
mod store;

pub(crate) use connection::NativeExtensionConnection;
pub use store::ExtensionsState;

use irodori_error::Result as IrodoriResult;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use ts_rs::TS;

/// One installed extension as shown in the manager UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub engine: String,
    /// Absolute path of the loaded cdylib inside the extensions dir.
    pub library_path: String,
    pub sha256: String,
    pub enabled: bool,
    pub installed_at: String,
    pub abi_version: u32,
    /// Calls the connector reports supporting (e.g. connect/query/metadata).
    pub supported_calls: Vec<String>,
}

/// Install request resolved by the frontend from the marketplace catalog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstallRequest {
    pub id: String,
    /// Version advertised by the signed marketplace entry.
    pub version: String,
    /// `owner/repo` or full https URL of the GitHub repository.
    pub repository: String,
    /// Release-asset file name for the current platform, or a template
    /// containing `{target}` (e.g. `connector-{target}.tar.gz`).
    pub asset_name: String,
    /// Immutable release tag selected by the marketplace catalog.
    pub tag: String,
    /// Required SHA-256 of the exact platform asset.
    pub sha256: String,
    /// Permissions shown to and approved by the user before installation.
    pub permissions: Vec<String>,
}

#[tauri::command]
pub fn ext_target() -> String {
    store::native_target_label()
}

#[tauri::command]
pub async fn ext_list(
    app: AppHandle,
    state: State<'_, ExtensionsState>,
) -> IrodoriResult<Vec<InstalledExtension>> {
    store::list(&app, &state)
}

#[tauri::command]
pub async fn ext_install(
    app: AppHandle,
    state: State<'_, ExtensionsState>,
    request: ExtensionInstallRequest,
) -> IrodoriResult<InstalledExtension> {
    store::install(&app, &state, request).await
}

#[tauri::command]
pub async fn ext_uninstall(
    app: AppHandle,
    state: State<'_, ExtensionsState>,
    id: String,
) -> IrodoriResult<bool> {
    store::uninstall(&app, &state, &id)
}

#[tauri::command]
pub async fn ext_set_enabled(
    app: AppHandle,
    state: State<'_, ExtensionsState>,
    id: String,
    enabled: bool,
) -> IrodoriResult<InstalledExtension> {
    store::set_enabled(&app, &state, &id, enabled)
}

pub(crate) fn installed_by_id(
    app: &AppHandle,
    id: &str,
) -> IrodoriResult<Option<InstalledExtension>> {
    store::installed_by_id(app, id)
}
