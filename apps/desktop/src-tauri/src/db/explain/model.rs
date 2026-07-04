use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::render::copy_formats;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum QueryPlanMode {
    Plan,
    Analyze,
}

impl QueryPlanMode {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Plan => "Explain Plan",
            Self::Analyze => "Explain Analyse",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum QueryPlanSource {
    Native,
    NativeWithStaticAnalysis,
    StaticAnalysis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum QueryPlanSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanProperty {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanNode {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parent_id: Option<String>,
    pub depth: u32,
    pub label: String,
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub object: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub estimated_rows: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub actual_rows: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub startup_cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub total_cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub actual_startup_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub actual_total_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub loops: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub width: Option<f64>,
    pub impact_score: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<QueryPlanProperty>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanEdge {
    pub from: String,
    pub to: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanFlameFrame {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parent_id: Option<String>,
    pub label: String,
    pub depth: u32,
    pub value: f64,
    pub unit: String,
    pub ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanMetric {
    pub key: String,
    pub label: String,
    pub value: String,
    pub unit: String,
    pub severity: QueryPlanSeverity,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanFinding {
    pub severity: QueryPlanSeverity,
    pub title: String,
    pub detail: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanMetricGuide {
    pub key: String,
    pub label: String,
    pub meaning: String,
    pub good: String,
    pub warning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanCopyFormat {
    pub label: String,
    pub mime_type: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QueryPlanAnalysis {
    pub mode: QueryPlanMode,
    pub source: QueryPlanSource,
    pub engine_family: String,
    pub headline: String,
    pub summary: String,
    pub sql: String,
    pub nodes: Vec<QueryPlanNode>,
    pub edges: Vec<QueryPlanEdge>,
    pub flame_graph: Vec<QueryPlanFlameFrame>,
    pub metrics: Vec<QueryPlanMetric>,
    pub findings: Vec<QueryPlanFinding>,
    pub metric_guide: Vec<QueryPlanMetricGuide>,
    pub copy_formats: Vec<QueryPlanCopyFormat>,
}

impl QueryPlanAnalysis {
    pub(crate) fn with_native_error(mut self, error: String) -> Self {
        self.source = QueryPlanSource::StaticAnalysis;
        self.findings.insert(
            0,
            QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Native plan unavailable".into(),
                detail: error,
                action: "Irodori fell back to cross-database static analysis. Native metrics are not available for this run.".into(),
                node_id: None,
            },
        );
        self.headline = "Static analysis fallback".into();
        self.copy_formats = copy_formats(&self, None);
        self
    }
}
