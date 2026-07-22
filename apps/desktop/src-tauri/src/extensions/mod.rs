//! Verified connector and declarative feature-extension host.
//!
//! Extensions are published by the `irodori-extension-*` repos and described
//! by `registry/catalog/index.json`. Native connector extensions are cdylibs;
//! declarative feature extensions activate trusted features compiled into the
//! desktop host and never execute downloaded code in the application webview.

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
    #[serde(default = "default_extension_runtime")]
    pub runtime: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub engine: Option<String>,
    /// Absolute path of the loaded cdylib inside the extensions dir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub library_path: Option<String>,
    /// Trusted host features activated by this extension.
    #[serde(default)]
    pub host_features: Vec<String>,
    pub sha256: String,
    pub enabled: bool,
    pub installed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub abi_version: Option<u32>,
    /// Calls the connector reports supporting (e.g. connect/query/metadata).
    #[serde(default)]
    pub supported_calls: Vec<String>,
}

fn default_extension_runtime() -> String {
    "native".to_string()
}

/// How a catalog entry's payload is delivered (the catalog's `install.kind`).
///
/// Only pinned GitHub release archives are installable today. Other kinds are
/// rejected up front with a typed `Unsupported` error instead of being
/// mishandled as a release download and failing later with a misleading
/// fetch/validation message (#160).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ExtensionInstallKind {
    #[default]
    GithubRelease,
    Git,
}

/// Install request resolved by the frontend from the marketplace catalog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstallRequest {
    pub id: String,
    /// Version advertised by the signed marketplace entry.
    pub version: String,
    /// Delivery mechanism declared by the catalog entry (`install.kind`).
    /// Anything other than `githubRelease` is rejected before any download.
    #[serde(default)]
    pub kind: ExtensionInstallKind,
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
    /// Archive-relative path of the extension manifest declared by the catalog
    /// (`install.manifestPath`); defaults to `irodori.extension.json` at the
    /// archive root when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub manifest_path: Option<String>,
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
