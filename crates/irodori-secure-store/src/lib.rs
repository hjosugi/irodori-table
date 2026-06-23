//! Secret handle and secure storage abstractions for connection credentials.

use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use irodori_core::{IrodoriError, Result, SecretRef};

pub const CRATE_NAME: &str = "irodori-secure-store";
pub const DEFAULT_SERVICE: &str = "irodori-table";

pub trait SecureStore: Send + Sync {
    fn put(&self, handle: &SecretRef, value: SecretValue<'_>) -> Result<()>;
    fn get(&self, handle: &SecretRef) -> Result<Option<String>>;
    fn delete(&self, handle: &SecretRef) -> Result<()>;

    fn put_connection_secret(
        &self,
        connection_id: &str,
        purpose: SecretPurpose,
        value: SecretValue<'_>,
    ) -> Result<SecretRef> {
        let handle = connection_secret_ref(connection_id, purpose)?;
        self.put(&handle, value)?;
        Ok(handle)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SecretValue<'a>(&'a str);

impl<'a> SecretValue<'a> {
    pub fn new(value: &'a str) -> Result<Self> {
        if value.is_empty() {
            return Err(IrodoriError::validation("secret value cannot be empty"));
        }
        Ok(Self(value))
    }

    fn as_str(self) -> &'a str {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretPurpose {
    Password,
    Token,
    PrivateKey,
    PrivateKeyPassphrase,
    SshPassword,
    ProxyPassword,
}

impl SecretPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Token => "token",
            Self::PrivateKey => "private-key",
            Self::PrivateKeyPassphrase => "private-key-passphrase",
            Self::SshPassword => "ssh-password",
            Self::ProxyPassword => "proxy-password",
        }
    }
}

pub fn connection_secret_ref(connection_id: &str, purpose: SecretPurpose) -> Result<SecretRef> {
    validate_handle_part("connection id", connection_id)?;
    Ok(SecretRef {
        handle: format!("connections/{connection_id}/{}", purpose.as_str()),
        service: Some(DEFAULT_SERVICE.to_string()),
    })
}

#[derive(Debug, Default)]
pub struct MemorySecureStore {
    secrets: Mutex<HashMap<String, String>>,
}

impl MemorySecureStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecureStore for MemorySecureStore {
    fn put(&self, handle: &SecretRef, value: SecretValue<'_>) -> Result<()> {
        validate_secret_ref(handle)?;
        self.secrets
            .lock()
            .map_err(|_| {
                IrodoriError::new(
                    irodori_core::IrodoriErrorKind::Internal,
                    "secret store lock poisoned",
                )
            })?
            .insert(account_name(handle), value.as_str().to_string());
        Ok(())
    }

    fn get(&self, handle: &SecretRef) -> Result<Option<String>> {
        validate_secret_ref(handle)?;
        Ok(self
            .secrets
            .lock()
            .map_err(|_| {
                IrodoriError::new(
                    irodori_core::IrodoriErrorKind::Internal,
                    "secret store lock poisoned",
                )
            })?
            .get(&account_name(handle))
            .cloned())
    }

    fn delete(&self, handle: &SecretRef) -> Result<()> {
        validate_secret_ref(handle)?;
        self.secrets
            .lock()
            .map_err(|_| {
                IrodoriError::new(
                    irodori_core::IrodoriErrorKind::Internal,
                    "secret store lock poisoned",
                )
            })?
            .remove(&account_name(handle));
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsKeychainStore {
    service: String,
}

impl OsKeychainStore {
    pub fn new(service: impl Into<String>) -> Result<Self> {
        let service = service.into();
        validate_handle_part("secret service", &service)?;
        Ok(Self { service })
    }

    pub fn default_service() -> Self {
        Self {
            service: DEFAULT_SERVICE.to_string(),
        }
    }
}

impl Default for OsKeychainStore {
    fn default() -> Self {
        Self::default_service()
    }
}

impl SecureStore for OsKeychainStore {
    fn put(&self, handle: &SecretRef, value: SecretValue<'_>) -> Result<()> {
        validate_secret_ref(handle)?;
        platform_put(
            &self.service_name(handle),
            &account_name(handle),
            value.as_str(),
        )
    }

    fn get(&self, handle: &SecretRef) -> Result<Option<String>> {
        validate_secret_ref(handle)?;
        platform_get(&self.service_name(handle), &account_name(handle))
    }

    fn delete(&self, handle: &SecretRef) -> Result<()> {
        validate_secret_ref(handle)?;
        platform_delete(&self.service_name(handle), &account_name(handle))
    }
}

impl OsKeychainStore {
    fn service_name(&self, handle: &SecretRef) -> String {
        handle
            .service
            .clone()
            .unwrap_or_else(|| self.service.clone())
    }
}

fn validate_secret_ref(handle: &SecretRef) -> Result<()> {
    validate_handle_part("secret handle", &handle.handle)?;
    if let Some(service) = &handle.service {
        validate_handle_part("secret service", service)?;
    }
    Ok(())
}

fn validate_handle_part(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(IrodoriError::validation(format!("{label} is required")));
    }
    if value.chars().any(char::is_control) {
        return Err(IrodoriError::validation(format!(
            "{label} cannot contain control characters"
        )));
    }
    Ok(())
}

fn account_name(handle: &SecretRef) -> String {
    handle.handle.clone()
}

#[cfg(target_os = "macos")]
fn platform_put(service: &str, account: &str, value: &str) -> Result<()> {
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-s",
            service,
            "-a",
            account,
            "-w",
            value,
            "-U",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(os_keychain_unavailable)?;
    command_ok(output.status.success(), "store secret in macOS keychain")
}

#[cfg(target_os = "macos")]
fn platform_get(service: &str, account: &str) -> Result<Option<String>> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(os_keychain_unavailable)?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(trim_trailing_newline(
        String::from_utf8_lossy(&output.stdout).into_owned(),
    )))
}

#[cfg(target_os = "macos")]
fn platform_delete(service: &str, account: &str) -> Result<()> {
    let output = Command::new("security")
        .args(["delete-generic-password", "-s", service, "-a", account])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(os_keychain_unavailable)?;
    if output.status.success() {
        Ok(())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn platform_put(service: &str, account: &str, value: &str) -> Result<()> {
    let mut child = Command::new("secret-tool")
        .args([
            "store",
            "--label",
            "Irodori Table secret",
            "service",
            service,
            "account",
            account,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(os_keychain_unavailable)?;
    if let Some(stdin) = &mut child.stdin {
        use std::io::Write;
        stdin
            .write_all(value.as_bytes())
            .map_err(|_| IrodoriError::transport("failed to send secret to keychain"))?;
    }
    let status = child
        .wait()
        .map_err(|_| IrodoriError::transport("failed to wait for keychain command"))?;
    command_ok(status.success(), "store secret in Linux keyring")
}

#[cfg(target_os = "linux")]
fn platform_get(service: &str, account: &str) -> Result<Option<String>> {
    let output = Command::new("secret-tool")
        .args(["lookup", "service", service, "account", account])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(os_keychain_unavailable)?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(trim_trailing_newline(
        String::from_utf8_lossy(&output.stdout).into_owned(),
    )))
}

#[cfg(target_os = "linux")]
fn platform_delete(service: &str, account: &str) -> Result<()> {
    let output = Command::new("secret-tool")
        .args(["clear", "service", service, "account", account])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(os_keychain_unavailable)?;
    if output.status.success() {
        Ok(())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn platform_put(_service: &str, _account: &str, _value: &str) -> Result<()> {
    Err(unsupported_keychain())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn platform_get(_service: &str, _account: &str) -> Result<Option<String>> {
    Err(unsupported_keychain())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn platform_delete(_service: &str, _account: &str) -> Result<()> {
    Err(unsupported_keychain())
}

fn os_keychain_unavailable(error: std::io::Error) -> IrodoriError {
    IrodoriError::new(
        irodori_core::IrodoriErrorKind::Unsupported,
        format!("OS keychain command is unavailable: {error}"),
    )
}

fn command_ok(ok: bool, action: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(IrodoriError::transport(format!("failed to {action}")))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn unsupported_keychain() -> IrodoriError {
    IrodoriError::new(
        irodori_core::IrodoriErrorKind::Unsupported,
        "OS keychain integration is not available on this platform yet",
    )
}

fn trim_trailing_newline(mut value: String) -> String {
    while value.ends_with(['\n', '\r']) {
        value.pop();
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_connection_secret_refs_are_stable_and_secret_free() {
        let reference = connection_secret_ref("prod", SecretPurpose::Password).unwrap();

        assert_eq!(reference.service.as_deref(), Some(DEFAULT_SERVICE));
        assert_eq!(reference.handle, "connections/prod/password");
        assert!(!reference.handle.contains("supersecret"));
    }

    #[test]
    fn memory_secure_store_round_trips_and_deletes() {
        let store = MemorySecureStore::new();
        let handle = store
            .put_connection_secret(
                "prod",
                SecretPurpose::Password,
                SecretValue::new("supersecret").unwrap(),
            )
            .unwrap();

        assert_eq!(store.get(&handle).unwrap().as_deref(), Some("supersecret"));
        store.delete(&handle).unwrap();
        assert_eq!(store.get(&handle).unwrap(), None);
    }

    #[test]
    fn empty_secret_values_are_rejected() {
        let error = SecretValue::new("").unwrap_err();
        assert_eq!(error.kind, irodori_core::IrodoriErrorKind::Validation);
    }

    #[test]
    fn os_keychain_store_has_a_valid_default_service() {
        let store = OsKeychainStore::default();
        assert_eq!(store.service, DEFAULT_SERVICE);
    }
}
