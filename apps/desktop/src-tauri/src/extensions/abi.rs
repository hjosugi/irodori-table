use std::path::Path;

use libloading::Library;
use serde_json::Value;

pub(crate) const ABI_VERSION: u32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct IrodoriConnectorBuffer {
    pub(crate) ptr: *const u8,
    pub(crate) len: usize,
}

type AbiVersionFn = unsafe extern "C" fn() -> u32;
type BufferFn = unsafe extern "C" fn() -> IrodoriConnectorBuffer;
type CallJsonFn = unsafe extern "C" fn(IrodoriConnectorBuffer) -> IrodoriConnectorBuffer;
type FreeBufferFn = unsafe extern "C" fn(IrodoriConnectorBuffer);

#[derive(Debug, Clone)]
pub(crate) struct NativeConnectorProbe {
    pub(crate) engine: String,
    pub(crate) manifest_json: String,
    pub(crate) config_json: String,
    pub(crate) health: Value,
    pub(crate) describe: Value,
}

pub(crate) fn probe_library(path: &Path) -> Result<NativeConnectorProbe, String> {
    let library = unsafe { Library::new(path) }
        .map_err(|error| format!("failed to load native connector library: {error}"))?;
    unsafe { probe_loaded_library(&library) }
}

unsafe fn probe_loaded_library(library: &Library) -> Result<NativeConnectorProbe, String> {
    let abi_version = *library
        .get::<AbiVersionFn>(b"irodori_extension_abi_version\0")
        .map_err(|error| format!("connector is missing irodori_extension_abi_version: {error}"))?;
    let engine_json = *library
        .get::<BufferFn>(b"irodori_connector_engine_json\0")
        .map_err(|error| format!("connector is missing irodori_connector_engine_json: {error}"))?;
    let manifest_json = *library
        .get::<BufferFn>(b"irodori_extension_manifest_json\0")
        .map_err(|error| {
            format!("connector is missing irodori_extension_manifest_json: {error}")
        })?;
    let config_json = *library
        .get::<BufferFn>(b"irodori_connector_config_json\0")
        .map_err(|error| format!("connector is missing irodori_connector_config_json: {error}"))?;
    let call_json = *library
        .get::<CallJsonFn>(b"irodori_connector_call_json\0")
        .map_err(|error| format!("connector is missing irodori_connector_call_json: {error}"))?;
    let free_buffer = *library
        .get::<FreeBufferFn>(b"irodori_connector_free_buffer\0")
        .map_err(|error| format!("connector is missing irodori_connector_free_buffer: {error}"))?;

    let version = abi_version();
    if version != ABI_VERSION {
        return Err(format!(
            "unsupported connector ABI version {version}; expected {ABI_VERSION}"
        ));
    }

    let engine = read_owned_buffer(engine_json(), free_buffer)?;
    let manifest_json = read_owned_buffer(manifest_json(), free_buffer)?;
    let config_json = read_owned_buffer(config_json(), free_buffer)?;
    let health = call_owned_json(call_json, free_buffer, r#"{"method":"health"}"#)?;
    let describe = call_owned_json(call_json, free_buffer, r#"{"method":"describe"}"#)?;

    Ok(NativeConnectorProbe {
        engine,
        manifest_json,
        config_json,
        health,
        describe,
    })
}

fn call_owned_json(
    call_json: CallJsonFn,
    free_buffer: FreeBufferFn,
    request: &str,
) -> Result<Value, String> {
    let buffer = IrodoriConnectorBuffer {
        ptr: request.as_ptr(),
        len: request.len(),
    };
    let response = unsafe { call_json(buffer) };
    let response = read_owned_buffer(response, free_buffer)?;
    serde_json::from_str(&response)
        .map_err(|error| format!("connector returned non-JSON response to health check: {error}"))
}

fn read_owned_buffer(
    buffer: IrodoriConnectorBuffer,
    free_buffer: FreeBufferFn,
) -> Result<String, String> {
    if buffer.ptr.is_null() {
        return if buffer.len == 0 {
            Ok(String::new())
        } else {
            Err("connector returned a null buffer with non-zero length".to_string())
        };
    }

    let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len).to_vec() };
    unsafe { free_buffer(buffer) };
    String::from_utf8(bytes).map_err(|error| format!("connector returned invalid UTF-8: {error}"))
}
