use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseRequest {
    pub sql: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResponse {
    pub ok: bool,
    pub diagnostics: Vec<String>,
}

#[no_mangle]
pub extern "C" fn irodori_extension_abi_version() -> u32 {
    0
}

// The host ABI is intentionally not stabilized yet. Keep parser, formatter, and
// completion logic isolated behind small functions so the ABI shim can change.
pub fn parse(request: ParseRequest) -> ParseResponse {
    ParseResponse {
        ok: !request.sql.trim().is_empty(),
        diagnostics: Vec::new(),
    }
}
