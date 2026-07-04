use std::path::Path;

use libloading::Library;
use serde_json::{json, Value};

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

pub(crate) struct NativeConnector {
    _library: Library,
    engine: String,
    call_json: CallJsonFn,
    free_buffer: FreeBufferFn,
}

impl NativeConnector {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let library = unsafe { Library::new(path) }
            .map_err(|error| format!("failed to load native connector library: {error}"))?;
        unsafe { Self::from_library(library) }
    }

    unsafe fn from_library(library: Library) -> Result<Self, String> {
        let abi_version = *library
            .get::<AbiVersionFn>(b"irodori_extension_abi_version\0")
            .map_err(|error| {
                format!("connector is missing irodori_extension_abi_version: {error}")
            })?;
        let engine_json = *library
            .get::<BufferFn>(b"irodori_connector_engine_json\0")
            .map_err(|error| {
                format!("connector is missing irodori_connector_engine_json: {error}")
            })?;
        let call_json = *library
            .get::<CallJsonFn>(b"irodori_connector_call_json\0")
            .map_err(|error| {
                format!("connector is missing irodori_connector_call_json: {error}")
            })?;
        let free_buffer = *library
            .get::<FreeBufferFn>(b"irodori_connector_free_buffer\0")
            .map_err(|error| {
                format!("connector is missing irodori_connector_free_buffer: {error}")
            })?;

        let version = abi_version();
        if version != ABI_VERSION {
            return Err(format!(
                "unsupported connector ABI version {version}; expected {ABI_VERSION}"
            ));
        }

        let engine = read_owned_buffer(engine_json(), free_buffer)?;
        Ok(Self {
            _library: library,
            engine,
            call_json,
            free_buffer,
        })
    }

    pub(crate) fn engine(&self) -> &str {
        &self.engine
    }

    pub(crate) fn call(&self, request: Value) -> Result<Value, String> {
        let request = request.to_string();
        call_owned_json(self.call_json, self.free_buffer, &request)
    }

    pub(crate) fn call_ok(&self, request: Value) -> Result<Value, String> {
        let response = self.call(request)?;
        if response.get("ok").and_then(Value::as_bool) == Some(false) {
            return Err(connector_error_message(&response));
        }
        Ok(response)
    }
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

pub(crate) fn connector_error_message(response: &Value) -> String {
    let message = response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| response.get("message").and_then(Value::as_str))
        .unwrap_or("connector call failed");
    let Some(code) = response
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
    else {
        return message.to_string();
    };
    format!("{code}: {message}")
}

pub(crate) fn connector_request(method: &str, connection_id: &str) -> Value {
    json!({
        "method": method,
        "connectionId": connection_id,
    })
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
