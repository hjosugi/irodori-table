//! Wire types for the local data API. JSON uses `camelCase` to match the rest of
//! Irodori's TS-facing boundary.

use serde::{Deserialize, Serialize};

pub use irodori_core::{JobList, JobRecord, JobSummary};

/// A configured data source the API can serve.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String,
    pub engine: String,
    pub read_only: bool,
}

/// A browsable object (table or view) in a source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectInfo {
    pub name: String,
    pub kind: ObjectKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectKind {
    Table,
    View,
}

/// Result of a read query. `rows` is a row-major matrix of JSON cell values, the
/// same shape the desktop and web result grids consume.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultDto {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

/// `POST /v1/sources/{id}/query` body.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryBody {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
    #[serde(default)]
    pub max_rows: Option<u32>,
}

/// JSON error envelope returned for every non-2xx response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub error: String,
    pub code: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_list_uses_core_shape_for_api_boundaries() {
        let value = serde_json::to_value(JobList::default()).unwrap();
        assert_eq!(value, serde_json::json!({ "active": [], "history": [] }));
    }
}
