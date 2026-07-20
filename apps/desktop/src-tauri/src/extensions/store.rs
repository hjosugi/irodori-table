use std::fs;
use std::io::{self, Cursor};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use futures_util::StreamExt;
use irodori_error::{IrodoriError, IrodoriErrorKind, Result as IrodoriResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tar::Archive;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::abi::{probe_library, ABI_VERSION};
use super::{ExtensionInstallKind, ExtensionInstallRequest, InstalledExtension};

const REGISTRY_FILE: &str = "installed.json";
const EXTENSIONS_DIR: &str = "extensions";
const MANIFEST_FILE: &str = "irodori.extension.json";
const MAX_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;

#[derive(Default)]
pub struct ExtensionsState {
    install_lock: Mutex<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    id: String,
    name: String,
    version: String,
    runtime: String,
    entry: String,
    #[serde(default)]
    permissions: Vec<String>,
    contributes: ManifestContributions,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestContributions {
    #[serde(default)]
    connectors: Vec<ManifestConnector>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestConnector {
    engine: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledRegistry {
    #[serde(default = "registry_schema_version")]
    schema_version: u16,
    #[serde(default)]
    extensions: Vec<InstalledExtension>,
}

pub(crate) fn list(
    app: &AppHandle,
    _state: &ExtensionsState,
) -> IrodoriResult<Vec<InstalledExtension>> {
    Ok(read_registry(app)?.extensions)
}

pub(crate) async fn install(
    app: &AppHandle,
    state: &ExtensionsState,
    request: ExtensionInstallRequest,
) -> IrodoriResult<InstalledExtension> {
    let _guard = state.install_lock.lock().await;
    // Fail fast on anything but a GitHub release: mishandling another kind as
    // a release download would only surface later as a misleading fetch or
    // manifest-validation error (#160).
    ensure_supported_install_kind(request.kind)?;
    let manifest_file = validated_manifest_path(request.manifest_path.as_deref())?;
    let bytes = download_release_asset(&request).await?;
    let digest = sha256_hex(&bytes);
    let expected = validated_sha256(&request.sha256)?;
    if digest != expected {
        return Err(IrodoriError::validation(format!(
            "extension archive sha256 mismatch: expected {expected}, got {digest}"
        )));
    }

    install_archive(
        app,
        &request.id,
        &request.version,
        &request.permissions,
        &manifest_file,
        bytes,
        digest,
    )
}

/// Only pinned GitHub release archives are installable. A `git` (or any
/// future) source must be rejected up front — implementing a git installer is
/// deliberately out of scope until the registry actually ships such an entry.
fn ensure_supported_install_kind(kind: ExtensionInstallKind) -> IrodoriResult<()> {
    match kind {
        ExtensionInstallKind::GithubRelease => Ok(()),
        ExtensionInstallKind::Git => Err(IrodoriError::new(
            IrodoriErrorKind::Unsupported,
            "extension install kind `git` is not supported yet; only pinned GitHub release archives (`githubRelease`) can be installed",
        )),
    }
}

/// Resolve the archive-relative manifest location from the catalog's
/// `install.manifestPath`, defaulting to `irodori.extension.json` at the
/// archive root, and reject paths that would escape the staging directory.
fn validated_manifest_path(manifest_path: Option<&str>) -> IrodoriResult<PathBuf> {
    let raw = match manifest_path.map(str::trim) {
        None | Some("") => MANIFEST_FILE,
        Some(path) => path,
    };
    safe_archive_path(Path::new(raw)).ok_or_else(|| {
        IrodoriError::validation(format!(
            "extension manifest path must stay inside the archive: {raw}"
        ))
    })
}

pub(crate) fn uninstall(
    app: &AppHandle,
    _state: &ExtensionsState,
    id: &str,
) -> IrodoriResult<bool> {
    let mut registry = read_registry(app)?;
    let before = registry.extensions.len();
    let removed = registry
        .extensions
        .iter()
        .find(|extension| extension.id == id)
        .cloned();
    registry.extensions.retain(|extension| extension.id != id);
    if let Some(extension) = removed {
        if let Some(version_dir) = Path::new(&extension.library_path)
            .parent()
            .and_then(Path::parent)
        {
            let _ = fs::remove_dir_all(version_dir);
        }
        write_registry(app, &registry)?;
    }
    Ok(registry.extensions.len() != before)
}

pub(crate) fn set_enabled(
    app: &AppHandle,
    _state: &ExtensionsState,
    id: &str,
    enabled: bool,
) -> IrodoriResult<InstalledExtension> {
    let mut registry = read_registry(app)?;
    let mut updated = None;
    for extension in &mut registry.extensions {
        if extension.id == id {
            extension.enabled = enabled;
            updated = Some(extension.clone());
            break;
        }
    }
    let updated = updated
        .ok_or_else(|| IrodoriError::validation(format!("extension is not installed: {id}")))?;
    write_registry(app, &registry)?;
    Ok(updated)
}

pub(crate) fn installed_by_id(
    app: &AppHandle,
    id: &str,
) -> IrodoriResult<Option<InstalledExtension>> {
    Ok(read_registry(app)?
        .extensions
        .into_iter()
        .find(|extension| extension.id == id && extension.enabled))
}

fn install_archive(
    app: &AppHandle,
    requested_id: &str,
    requested_version: &str,
    approved_permissions: &[String],
    manifest_file: &Path,
    bytes: Vec<u8>,
    sha256: String,
) -> IrodoriResult<InstalledExtension> {
    let root = extensions_root(app)?;
    fs::create_dir_all(&root).map_err(to_error)?;
    let staging = root.join(format!(
        ".staging-{}-{}",
        std::process::id(),
        unix_timestamp()
    ));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(to_error)?;
    }
    fs::create_dir_all(&staging).map_err(to_error)?;

    let install_result = (|| {
        unpack_archive(&bytes, &staging)?;
        let manifest_path = staging.join(manifest_file);
        let manifest_json = fs::read_to_string(&manifest_path).map_err(to_error)?;
        let manifest: ManifestFile = serde_json::from_str(&manifest_json).map_err(|error| {
            IrodoriError::validation(format!("invalid extension manifest: {error}"))
        })?;
        validate_manifest(
            requested_id,
            requested_version,
            approved_permissions,
            &manifest,
        )?;

        let library_path = find_native_library(&staging, &manifest.entry)?;
        let library_rel = library_path
            .strip_prefix(&staging)
            .map_err(|error| {
                IrodoriError::validation(format!("invalid extension library path: {error}"))
            })?
            .to_path_buf();
        let probe = probe_library(&library_path).map_err(IrodoriError::validation)?;
        if probe.engine != manifest.contributes.connectors[0].engine {
            return Err(IrodoriError::validation(format!(
                "connector engine mismatch: manifest={}, abi={}",
                manifest.contributes.connectors[0].engine, probe.engine
            )));
        }
        if probe.manifest_json.trim() != manifest_json.trim() {
            return Err(IrodoriError::validation(
                "connector ABI manifest does not match archive manifest",
            ));
        }
        let config: Value = serde_json::from_str(&probe.config_json).map_err(|error| {
            IrodoriError::validation(format!("connector ABI config is invalid JSON: {error}"))
        })?;
        if config.get("extensionId").and_then(Value::as_str) != Some(manifest.id.as_str()) {
            return Err(IrodoriError::validation(
                "connector ABI config extensionId does not match archive manifest",
            ));
        }
        if probe.health.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(IrodoriError::validation(
                "connector health check did not return ok=true",
            ));
        }

        let final_dir = root
            .join(safe_component(&manifest.id))
            .join(safe_component(&manifest.version));
        if final_dir.exists() {
            fs::remove_dir_all(&final_dir).map_err(to_error)?;
        }
        if let Some(parent) = final_dir.parent() {
            fs::create_dir_all(parent).map_err(to_error)?;
        }
        fs::rename(&staging, &final_dir).map_err(to_error)?;
        let final_library = final_dir.join(library_rel);

        let installed = InstalledExtension {
            id: manifest.id.clone(),
            name: manifest.name,
            version: manifest.version,
            engine: manifest.contributes.connectors[0].engine.clone(),
            library_path: final_library.to_string_lossy().to_string(),
            sha256,
            enabled: true,
            installed_at: unix_timestamp().to_string(),
            abi_version: ABI_VERSION,
            supported_calls: supported_calls(&probe.describe),
        };
        upsert_installed(app, installed.clone())?;
        Ok(installed)
    })();

    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    install_result
}

fn validate_manifest(
    requested_id: &str,
    requested_version: &str,
    approved_permissions: &[String],
    manifest: &ManifestFile,
) -> IrodoriResult<()> {
    if manifest.id != requested_id {
        return Err(IrodoriError::validation(format!(
            "extension id mismatch: requested {requested_id}, archive contains {}",
            manifest.id
        )));
    }
    if manifest.version != requested_version {
        return Err(IrodoriError::validation(format!(
            "extension version mismatch: catalog {requested_version}, archive contains {}",
            manifest.version
        )));
    }
    let mut approved_permissions = approved_permissions.to_vec();
    let mut manifest_permissions = manifest.permissions.clone();
    approved_permissions.sort();
    approved_permissions.dedup();
    manifest_permissions.sort();
    manifest_permissions.dedup();
    if manifest_permissions != approved_permissions {
        return Err(IrodoriError::validation(
            "extension permissions do not match the permissions approved by the user",
        ));
    }
    if manifest.runtime != "native" {
        return Err(IrodoriError::validation(format!(
            "extension runtime must be native; got {}",
            manifest.runtime
        )));
    }
    if manifest.contributes.connectors.len() != 1 {
        return Err(IrodoriError::validation(
            "native connector extensions must contribute exactly one connector",
        ));
    }
    Ok(())
}

fn upsert_installed(app: &AppHandle, installed: InstalledExtension) -> IrodoriResult<()> {
    let mut registry = read_registry(app)?;
    registry
        .extensions
        .retain(|extension| extension.id != installed.id);
    registry.extensions.push(installed);
    registry
        .extensions
        .sort_by(|left, right| left.id.cmp(&right.id));
    write_registry(app, &registry)
}

async fn download_release_asset(request: &ExtensionInstallRequest) -> IrodoriResult<Vec<u8>> {
    let url = github_release_asset_url(request)?;
    let response = reqwest::get(&url).await.map_err(|error| {
        IrodoriError::transport(format!("failed to download extension archive: {error}"))
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(IrodoriError::transport(format!(
            "failed to download extension archive: HTTP {status} ({url})"
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ARCHIVE_BYTES as u64)
    {
        return Err(IrodoriError::validation(format!(
            "extension archive exceeds {} bytes",
            MAX_ARCHIVE_BYTES
        )));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            IrodoriError::transport(format!("failed to read extension archive: {error}"))
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_ARCHIVE_BYTES {
            return Err(IrodoriError::validation(format!(
                "extension archive exceeds {} bytes",
                MAX_ARCHIVE_BYTES
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn github_release_asset_url(request: &ExtensionInstallRequest) -> IrodoriResult<String> {
    let repo = normalize_github_repo(&request.repository)?;
    let asset = request
        .asset_name
        .replace("{target}", native_target_label().as_str());
    let tag = request.tag.trim();
    if !is_safe_release_component(tag) {
        return Err(IrodoriError::validation("extension release tag is invalid"));
    }
    if !is_safe_release_component(&asset) {
        return Err(IrodoriError::validation(
            "extension release asset name is invalid",
        ));
    }
    Ok(format!(
        "https://github.com/{repo}/releases/download/{tag}/{asset}"
    ))
}

fn normalize_github_repo(repository: &str) -> IrodoriResult<String> {
    let repository = repository.trim().trim_end_matches(".git");
    let repository = repository
        .strip_prefix("https://github.com/")
        .or_else(|| repository.strip_prefix("http://github.com/"))
        .unwrap_or(repository)
        .trim_matches('/');
    let parts: Vec<&str> = repository.split('/').collect();
    if parts.len() == 2 && parts.iter().all(|part| is_safe_release_component(part)) {
        return Ok(format!("{}/{}", parts[0], parts[1]));
    }
    Err(IrodoriError::validation(format!(
        "extension repository must be owner/repo or a GitHub URL: {repository}"
    )))
}

fn unpack_archive(bytes: &[u8], destination: &Path) -> IrodoriResult<()> {
    let decoder = GzDecoder::new(Cursor::new(bytes));
    let mut archive = Archive::new(decoder);
    for entry in archive.entries().map_err(to_error)? {
        let mut entry = entry.map_err(to_error)?;
        let path = entry.path().map_err(to_error)?;
        let Some(relative) = safe_archive_path(&path) else {
            continue;
        };
        let target = destination.join(relative);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&target).map_err(to_error)?;
        } else if entry.header().entry_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(to_error)?;
            }
            entry.unpack(&target).map_err(to_error)?;
        }
    }
    Ok(())
}

fn safe_archive_path(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

fn find_native_library(root: &Path, entry: &str) -> IrodoriResult<PathBuf> {
    let entry_root = root.join(entry);
    let search_root = if entry_root.is_dir() {
        &entry_root
    } else {
        root
    };
    let mut matches = Vec::new();
    collect_native_libraries(search_root, &mut matches).map_err(to_error)?;
    matches.sort_by(|left, right| {
        native_library_priority(left)
            .cmp(&native_library_priority(right))
            .then_with(|| left.cmp(right))
    });
    matches.into_iter().next().ok_or_else(|| {
        IrodoriError::validation(format!(
            "extension archive does not contain a native {} library",
            native_library_extension()
        ))
    })
}

fn native_library_priority(path: &Path) -> u8 {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if name.starts_with("libirodori_extension_") || name.starts_with("irodori_extension_") {
        0
    } else {
        1
    }
}

fn collect_native_libraries(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_native_libraries(&path, out)?;
        } else if path.extension().and_then(|extension| extension.to_str())
            == Some(native_library_extension())
        {
            out.push(path);
        }
    }
    Ok(())
}

fn read_registry(app: &AppHandle) -> IrodoriResult<InstalledRegistry> {
    let path = registry_path(app)?;
    if !path.exists() {
        return Ok(InstalledRegistry {
            schema_version: registry_schema_version(),
            extensions: Vec::new(),
        });
    }
    let text = fs::read_to_string(path).map_err(to_error)?;
    serde_json::from_str(&text)
        .map_err(|error| IrodoriError::validation(format!("invalid extension registry: {error}")))
}

fn write_registry(app: &AppHandle, registry: &InstalledRegistry) -> IrodoriResult<()> {
    let path = registry_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(to_error)?;
    }
    let text = serde_json::to_string_pretty(registry).map_err(|error| {
        IrodoriError::validation(format!("serialize extension registry: {error}"))
    })?;
    fs::write(path, text).map_err(to_error)
}

fn registry_path(app: &AppHandle) -> IrodoriResult<PathBuf> {
    Ok(extensions_root(app)?.join(REGISTRY_FILE))
}

fn extensions_root(app: &AppHandle) -> IrodoriResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|error| {
        IrodoriError::transport(format!("failed to resolve app data directory: {error}"))
    })?;
    Ok(dir.join(EXTENSIONS_DIR))
}

fn supported_calls(describe: &Value) -> Vec<String> {
    let mut calls = vec![
        "health".to_string(),
        "describe".to_string(),
        "connect".to_string(),
        "query".to_string(),
        "metadata".to_string(),
        "close".to_string(),
    ];
    if let Some(extra) = describe.get("supportedCalls").and_then(Value::as_array) {
        for call in extra.iter().filter_map(Value::as_str) {
            if !calls.iter().any(|existing| existing == call) {
                calls.push(call.to_string());
            }
        }
    }
    calls
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn validated_sha256(value: &str) -> IrodoriResult<String> {
    let digest = value
        .trim()
        .strip_prefix("sha256:")
        .unwrap_or(value.trim())
        .to_ascii_lowercase();
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(IrodoriError::validation(
            "extension sha256 must be a 64-character hexadecimal digest",
        ));
    }
    Ok(digest)
}

fn is_safe_release_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.contains("..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
}

fn safe_component(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn native_library_extension() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "dll"
    }
    #[cfg(target_os = "macos")]
    {
        "dylib"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "so"
    }
}

pub(super) fn native_target_label() -> String {
    format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS)
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn registry_schema_version() -> u16 {
    1
}

fn to_error(error: impl std::fmt::Display) -> IrodoriError {
    IrodoriError::transport(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_paths_reject_parent_traversal() {
        assert_eq!(
            safe_archive_path(Path::new("dist/native/libx.so")),
            Some(PathBuf::from("dist/native/libx.so"))
        );
        assert_eq!(safe_archive_path(Path::new("../escape")), None);
        assert_eq!(safe_archive_path(Path::new("/escape")), None);
    }

    #[test]
    fn github_release_url_requires_pinned_tag() {
        let request = ExtensionInstallRequest {
            id: "irodori.memgraph".into(),
            version: "0.1.3".into(),
            kind: ExtensionInstallKind::GithubRelease,
            repository: "https://github.com/hjosugi/irodori-extension-memgraph".into(),
            asset_name: "irodori-extension-memgraph.tar.gz".into(),
            tag: "v0.1.3".into(),
            sha256: "dc6deb44e1ecb1d0a4153917cc809692e37d1a5d814be4752af60649c5595232".into(),
            permissions: vec!["native".into()],
            manifest_path: None,
        };
        assert_eq!(
            github_release_asset_url(&request).unwrap(),
            "https://github.com/hjosugi/irodori-extension-memgraph/releases/download/v0.1.3/irodori-extension-memgraph.tar.gz"
        );

        let invalid = ExtensionInstallRequest {
            tag: "../latest".into(),
            ..request.clone()
        };
        assert!(github_release_asset_url(&invalid).is_err());

        let invalid_asset = ExtensionInstallRequest {
            asset_name: "archive.tar.gz?download=1".into(),
            ..request
        };
        assert!(github_release_asset_url(&invalid_asset).is_err());
    }

    #[test]
    fn extension_library_is_preferred_over_bundled_dependency() {
        assert!(
            native_library_priority(Path::new("libirodori_extension_duckdb.so"))
                < native_library_priority(Path::new("libduckdb.so"))
        );
        assert!(
            native_library_priority(Path::new("irodori_extension_duckdb.dll"))
                < native_library_priority(Path::new("duckdb.dll"))
        );
    }

    #[test]
    fn non_github_release_install_kind_is_rejected_up_front() {
        // #160: a `git` catalog entry must fail with a clear typed error
        // before any download, not be mishandled as a release archive.
        assert!(ensure_supported_install_kind(ExtensionInstallKind::GithubRelease).is_ok());

        let error = ensure_supported_install_kind(ExtensionInstallKind::Git).unwrap_err();
        assert_eq!(error.kind, IrodoriErrorKind::Unsupported);
        assert!(
            error.message.contains("`git`"),
            "message: {}",
            error.message
        );
        assert!(
            error.message.contains("githubRelease"),
            "message: {}",
            error.message
        );
    }

    #[test]
    fn manifest_path_is_threaded_with_default_and_traversal_guard() {
        // #160: the catalog's `install.manifestPath` must reach the installer
        // instead of the hardcoded manifest filename.
        assert_eq!(
            validated_manifest_path(None).unwrap(),
            PathBuf::from(MANIFEST_FILE)
        );
        assert_eq!(
            validated_manifest_path(Some("  ")).unwrap(),
            PathBuf::from(MANIFEST_FILE)
        );
        assert_eq!(
            validated_manifest_path(Some("dist/irodori.extension.json")).unwrap(),
            PathBuf::from("dist/irodori.extension.json")
        );
        assert!(validated_manifest_path(Some("../outside.json")).is_err());
        assert!(validated_manifest_path(Some("/etc/passwd")).is_err());
    }

    #[test]
    fn sha256_is_required_and_normalized() {
        assert_eq!(
            validated_sha256(
                "sha256:DC6DEB44E1ECB1D0A4153917CC809692E37D1A5D814BE4752AF60649C5595232"
            )
            .unwrap(),
            "dc6deb44e1ecb1d0a4153917cc809692e37d1a5d814be4752af60649c5595232"
        );
        assert!(validated_sha256("").is_err());
        assert!(validated_sha256("abc").is_err());
    }
}
