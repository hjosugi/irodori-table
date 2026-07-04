mod model;
mod mysql;
mod postgres;
mod render;
mod sqlite;
mod static_analysis;

pub use model::{
    QueryPlanAnalysis, QueryPlanCopyFormat, QueryPlanEdge, QueryPlanFinding, QueryPlanFlameFrame,
    QueryPlanMetric, QueryPlanMetricGuide, QueryPlanMode, QueryPlanNode, QueryPlanProperty,
    QueryPlanSeverity, QueryPlanSource,
};
pub(crate) use mysql::{analysis_from_mysql_json, analysis_from_row_table};
pub(crate) use postgres::analysis_from_postgres_json;
pub(crate) use sqlite::analysis_from_sqlite_rows;
pub(crate) use static_analysis::static_analysis;

#[cfg(test)]
mod tests;
