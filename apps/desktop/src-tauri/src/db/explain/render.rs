use std::collections::BTreeMap;

use super::super::engine::Wire;
use super::model::{
    QueryPlanAnalysis, QueryPlanCopyFormat, QueryPlanEdge, QueryPlanFinding, QueryPlanFlameFrame,
    QueryPlanMetric, QueryPlanMetricGuide, QueryPlanMode, QueryPlanNode, QueryPlanProperty,
    QueryPlanSeverity, QueryPlanSource,
};
use super::static_analysis::static_analysis;

pub(super) fn native_analysis(
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
    mut nodes: Vec<QueryPlanNode>,
    label: &str,
) -> QueryPlanAnalysis {
    normalize_impact_scores(&mut nodes);
    let edges = nodes
        .iter()
        .filter_map(|node| {
            node.parent_id.as_ref().map(|parent| QueryPlanEdge {
                from: parent.clone(),
                to: node.id.clone(),
                label: "feeds".into(),
            })
        })
        .collect::<Vec<_>>();
    let metrics = native_metrics(&nodes, mode);
    let summary = native_summary(&nodes, mode);
    let mut analysis = QueryPlanAnalysis {
        mode,
        source: QueryPlanSource::Native,
        engine_family: wire_label(wire).into(),
        headline: label.into(),
        summary,
        sql: trim_sql(sql),
        nodes,
        edges,
        flame_graph: Vec::new(),
        metrics,
        findings: Vec::new(),
        metric_guide: metric_guide(mode),
        copy_formats: Vec::new(),
    };
    analysis.flame_graph = flame_from_nodes(&analysis.nodes);
    analysis
}

pub(super) fn merge_static_findings(
    analysis: &mut QueryPlanAnalysis,
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
) {
    let static_plan = static_analysis(wire, sql, mode);
    for finding in static_plan.findings {
        if finding.title != "No obvious structural risk" {
            analysis.findings.push(finding);
        }
    }
    if analysis.findings.is_empty() {
        analysis.findings.push(QueryPlanFinding {
            severity: QueryPlanSeverity::Info,
            title: "Native plan captured".into(),
            detail: "The optimizer plan was normalized successfully.".into(),
            action: "Inspect the highest-impact nodes first, then compare estimated and actual rows when Analyse data is available.".into(),
            node_id: None,
        });
    }
    analysis.source = QueryPlanSource::NativeWithStaticAnalysis;
}

fn native_metrics(nodes: &[QueryPlanNode], mode: QueryPlanMode) -> Vec<QueryPlanMetric> {
    let mut total_cost = 0.0_f64;
    let mut max_estimated_rows = 0.0_f64;
    let mut actual_ms = 0.0_f64;
    let mut scan_count = 0_usize;
    let mut temp_blocks = 0.0_f64;
    let mut max_rows_removed = 0.0_f64;
    let mut max_estimate_error = 0.0_f64;

    for node in nodes {
        if let Some(cost) = node.total_cost {
            total_cost = total_cost.max(cost);
        }
        if let Some(rows) = node.estimated_rows {
            max_estimated_rows = max_estimated_rows.max(rows);
        }
        if let Some(ms) = node.actual_total_ms {
            actual_ms = actual_ms.max(ms);
        }
        if contains_ascii_case(&node.operation, "scan") {
            scan_count += 1;
        }
        if let Some(ratio) = estimate_error_ratio(node.estimated_rows, node.actual_rows) {
            max_estimate_error = max_estimate_error.max(ratio);
        }

        let mut node_temp_blocks = 0.0_f64;
        let mut node_rows_removed = 0.0_f64;
        for property in &node.properties {
            match property.name.as_str() {
                "tempReadBlocks" | "tempWrittenBlocks" => {
                    node_temp_blocks += parse_f64(&property.value).unwrap_or(0.0);
                }
                "rowsRemovedByFilter" | "rowsRemovedByJoinFilter" => {
                    node_rows_removed += parse_f64(&property.value).unwrap_or(0.0);
                }
                _ => {}
            }
        }
        temp_blocks += node_temp_blocks;
        max_rows_removed = max_rows_removed.max(node_rows_removed);
    }

    let mut metrics = vec![
        QueryPlanMetric {
            key: "nodes".into(),
            label: "Plan nodes".into(),
            value: nodes.len().to_string(),
            unit: "nodes".into(),
            severity: QueryPlanSeverity::Info,
            description: "Number of optimizer operations Irodori normalized.".into(),
        },
        QueryPlanMetric {
            key: "scanCount".into(),
            label: "Scan nodes".into(),
            value: scan_count.to_string(),
            unit: "nodes".into(),
            severity: if scan_count >= 3 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "How many plan nodes read base data.".into(),
        },
    ];
    if total_cost > 0.0 {
        metrics.push(QueryPlanMetric {
            key: "totalCost".into(),
            label: "Max total cost".into(),
            value: format_number(total_cost),
            unit: "cost".into(),
            severity: QueryPlanSeverity::Info,
            description:
                "Optimizer-relative cost. Compare within the same database, not across engines."
                    .into(),
        });
    }
    if max_estimated_rows > 0.0 {
        metrics.push(QueryPlanMetric {
            key: "estimatedRows".into(),
            label: "Largest row estimate".into(),
            value: format_number(max_estimated_rows),
            unit: "rows".into(),
            severity: if max_estimated_rows >= 100_000.0 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "Largest row count estimate on any node.".into(),
        });
    }
    if mode == QueryPlanMode::Analyze && actual_ms > 0.0 {
        metrics.push(QueryPlanMetric {
            key: "actualTime".into(),
            label: "Actual total time".into(),
            value: format_number(actual_ms),
            unit: "ms".into(),
            severity: if actual_ms >= 1000.0 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "Runtime reported by the database for the slowest/root operation.".into(),
        });
    }
    if max_estimate_error >= 1.0 {
        metrics.push(QueryPlanMetric {
            key: "estimateError".into(),
            label: "Worst row error".into(),
            value: format_number(max_estimate_error),
            unit: "x".into(),
            severity: if max_estimate_error >= 10.0 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "Largest gap between estimated and actual rows on any node.".into(),
        });
    }
    if max_rows_removed > 0.0 {
        metrics.push(QueryPlanMetric {
            key: "rowsRemoved".into(),
            label: "Rows removed".into(),
            value: format_number(max_rows_removed),
            unit: "rows".into(),
            severity: if max_rows_removed >= 10_000.0 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "Largest number of rows rejected after scan/join processing.".into(),
        });
    }
    if temp_blocks > 0.0 {
        metrics.push(QueryPlanMetric {
            key: "tempBlocks".into(),
            label: "Temp blocks".into(),
            value: format_number(temp_blocks),
            unit: "blocks".into(),
            severity: QueryPlanSeverity::Warning,
            description: "Temporary blocks read/written by sort, hash, or materialization work."
                .into(),
        });
    }
    metrics
}

pub(super) fn static_metrics(
    tables: &[String],
    join_count: usize,
    has_where: bool,
    has_order: bool,
) -> Vec<QueryPlanMetric> {
    vec![
        QueryPlanMetric {
            key: "objects".into(),
            label: "Referenced objects".into(),
            value: tables.len().to_string(),
            unit: "objects".into(),
            severity: QueryPlanSeverity::Info,
            description: "Objects Irodori detected from FROM/JOIN/UPDATE/INSERT clauses.".into(),
        },
        QueryPlanMetric {
            key: "joins".into(),
            label: "Join clauses".into(),
            value: join_count.to_string(),
            unit: "joins".into(),
            severity: if join_count >= 3 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "More joins increase the importance of good cardinality estimates and join-key indexes.".into(),
        },
        QueryPlanMetric {
            key: "predicate".into(),
            label: "Predicate".into(),
            value: if has_where { "present" } else { "missing" }.into(),
            unit: "shape".into(),
            severity: if has_where {
                QueryPlanSeverity::Info
            } else {
                QueryPlanSeverity::Warning
            },
            description: "Whether the query has a WHERE clause that can reduce scanned rows.".into(),
        },
        QueryPlanMetric {
            key: "sort".into(),
            label: "Sort".into(),
            value: if has_order { "present" } else { "none" }.into(),
            unit: "shape".into(),
            severity: QueryPlanSeverity::Info,
            description: "ORDER BY can be cheap with a matching index and expensive without one.".into(),
        },
    ]
}

pub(super) fn metric_guide(mode: QueryPlanMode) -> Vec<QueryPlanMetricGuide> {
    let mut guides = vec![
        QueryPlanMetricGuide {
            key: "totalCost".into(),
            label: "Cost".into(),
            meaning: "Optimizer-relative work estimate. It is useful for comparing two plans on the same engine.".into(),
            good: "Lower than the alternative plan and concentrated near selective index access.".into(),
            warning: "High cost on scans, sorts, or joins often points to missing predicates, stale statistics, or missing indexes.".into(),
        },
        QueryPlanMetricGuide {
            key: "estimatedRows".into(),
            label: "Estimated rows".into(),
            meaning: "How many rows the optimizer thinks a node will produce or inspect.".into(),
            good: "Close to actual rows when Analyse data is available.".into(),
            warning: "Large estimates or big estimate/actual gaps can lead to poor join order and memory choices.".into(),
        },
        QueryPlanMetricGuide {
            key: "loops".into(),
            label: "Loops".into(),
            meaning: "How many times a node ran. Nested-loop inner nodes can run once per outer row.".into(),
            good: "Small loop counts on expensive inner operations.".into(),
            warning: "High loops multiplied by scans or remote reads usually dominate runtime.".into(),
        },
        QueryPlanMetricGuide {
            key: "width".into(),
            label: "Row width".into(),
            meaning: "Estimated bytes per row flowing through a node.".into(),
            good: "Only required columns are projected before joins/sorts.".into(),
            warning: "Wide rows make sorting, hashing, network transfer, and temporary storage more expensive.".into(),
        },
        QueryPlanMetricGuide {
            key: "estimateError".into(),
            label: "Row estimate error".into(),
            meaning: "Largest ratio between estimated and actual rows on a node.".into(),
            good: "Close to 1x. The optimizer understood the data distribution.".into(),
            warning: "10x or more can produce bad join order, bad memory sizing, and wrong access paths.".into(),
        },
        QueryPlanMetricGuide {
            key: "rowsRemoved".into(),
            label: "Rows removed".into(),
            meaning: "Rows read by a node and then rejected by a filter or join filter.".into(),
            good: "Small compared with rows returned by the node.".into(),
            warning: "Large values usually mean predicates are being applied late or are not indexable.".into(),
        },
        QueryPlanMetricGuide {
            key: "tempBlocks".into(),
            label: "Temp blocks".into(),
            meaning: "Temporary disk blocks used by sort, hash, materialize, or aggregate work.".into(),
            good: "Zero for interactive queries unless a large report intentionally spills.".into(),
            warning: "Any temp I/O is a bottleneck candidate; check memory, sort inputs, hash inputs, and indexes.".into(),
        },
        QueryPlanMetricGuide {
            key: "planningTime".into(),
            label: "Planning time".into(),
            meaning: "Time the database spent choosing the execution plan.".into(),
            good: "Small compared with execution time for repeated application queries.".into(),
            warning: "High planning time can come from complex joins, partitions, statistics, or prepared statement choices.".into(),
        },
        QueryPlanMetricGuide {
            key: "executionTime".into(),
            label: "Execution time".into(),
            meaning: "End-to-end statement runtime reported by the database.".into(),
            good: "Matches the expected latency budget for the workflow.".into(),
            warning: "Use the hot node, temp blocks, row estimate error, and rows removed to locate the likely cause.".into(),
        },
    ];
    if mode == QueryPlanMode::Analyze {
        guides.insert(
            0,
            QueryPlanMetricGuide {
                key: "actualTime".into(),
                label: "Actual time".into(),
                meaning: "Measured execution time from Explain Analyse.".into(),
                good: "Most time is in expected scan or join nodes and aligns with row counts.".into(),
                warning: "A small-looking node with high actual time, loops, or row mismatch is a bottleneck candidate.".into(),
            },
        );
    }
    guides
}

fn native_summary(nodes: &[QueryPlanNode], mode: QueryPlanMode) -> String {
    let top = nodes
        .iter()
        .max_by(|left, right| left.impact_score.total_cmp(&right.impact_score));
    match top {
        Some(node) => format!(
            "{} normalized {} plan nodes. Start with \"{}\" because it has the highest relative impact.",
            mode.label(),
            nodes.len(),
            node.label
        ),
        None => "No plan nodes were returned.".into(),
    }
}

pub(super) fn static_summary(
    tables: &[String],
    join_count: usize,
    has_where: bool,
    has_order: bool,
    has_group: bool,
) -> String {
    let objects = if tables.is_empty() {
        "no base objects detected".into()
    } else {
        format!("{} object(s): {}", tables.len(), tables.join(", "))
    };
    format!(
        "Static scan found {objects}, {join_count} join(s), {} predicate, {} sort, and {} aggregation.",
        if has_where { "a" } else { "no" },
        if has_order { "an ORDER BY" } else { "no ORDER BY" },
        if has_group { "a GROUP BY" } else { "no GROUP BY" },
    )
}

pub(super) fn flame_from_nodes(nodes: &[QueryPlanNode]) -> Vec<QueryPlanFlameFrame> {
    let total = nodes
        .iter()
        .map(|node| node.impact_score.max(0.0))
        .sum::<f64>()
        .max(1.0);
    nodes
        .iter()
        .map(|node| QueryPlanFlameFrame {
            id: node.id.clone(),
            parent_id: node.parent_id.clone(),
            label: node.label.clone(),
            depth: node.depth,
            value: node.impact_score.max(0.01),
            unit: "relative".into(),
            ratio: (node.impact_score.max(0.0) / total).clamp(0.0, 1.0),
        })
        .collect()
}

pub(super) fn copy_formats(
    analysis: &QueryPlanAnalysis,
    native: Option<QueryPlanCopyFormat>,
) -> Vec<QueryPlanCopyFormat> {
    let mut formats = Vec::new();
    if let Some(native) = native {
        formats.push(native);
    }
    formats.push(QueryPlanCopyFormat {
        label: "Analysis Markdown".into(),
        mime_type: "text/markdown".into(),
        content: analysis_markdown(analysis),
    });
    formats.push(QueryPlanCopyFormat {
        label: "Plan Table TSV".into(),
        mime_type: "text/tab-separated-values".into(),
        content: normalized_nodes_tsv(&analysis.nodes),
    });
    formats
}

fn analysis_markdown(analysis: &QueryPlanAnalysis) -> String {
    let mut out = vec![
        format!("# {}", analysis.headline),
        String::new(),
        analysis.summary.clone(),
        String::new(),
        "## Findings".into(),
    ];
    for finding in &analysis.findings {
        out.push(format!(
            "- {:?}: {} — {} Action: {}",
            finding.severity, finding.title, finding.detail, finding.action
        ));
    }
    out.push(String::new());
    out.push("## Metrics".into());
    for metric in &analysis.metrics {
        out.push(format!(
            "- {}: {} {} — {}",
            metric.label, metric.value, metric.unit, metric.description
        ));
    }
    out.join("\n")
}

fn normalized_nodes_tsv(nodes: &[QueryPlanNode]) -> String {
    let mut lines = vec![
        "id\tparent\tdepth\toperation\tobject\testimatedRows\tactualRows\ttotalCost\tactualTotalMs\timpact"
            .into(),
    ];
    for node in nodes {
        lines.push(format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            node.id,
            node.parent_id.clone().unwrap_or_default(),
            node.depth,
            node.operation,
            node.object.clone().unwrap_or_default(),
            node.estimated_rows.map(format_number).unwrap_or_default(),
            node.actual_rows.map(format_number).unwrap_or_default(),
            node.total_cost.map(format_number).unwrap_or_default(),
            node.actual_total_ms.map(format_number).unwrap_or_default(),
            format_number(node.impact_score),
        ));
    }
    lines.join("\n")
}

pub(super) fn plan_rows_tsv(columns: &[String], rows: &[Vec<serde_json::Value>]) -> String {
    let mut lines = vec![columns.join("\t")];
    for row in rows {
        lines.push(row.iter().map(json_cell).collect::<Vec<_>>().join("\t"));
    }
    lines.join("\n")
}

fn normalize_impact_scores(nodes: &mut [QueryPlanNode]) {
    let max_score = nodes
        .iter()
        .map(|node| node.impact_score)
        .fold(0.0_f64, f64::max)
        .max(1.0);
    for node in nodes {
        node.impact_score = (node.impact_score / max_score).clamp(0.05, 1.0);
    }
}

pub(super) fn property(name: impl Into<String>, value: impl ToString) -> QueryPlanProperty {
    QueryPlanProperty {
        name: name.into(),
        value: value.to_string(),
    }
}

pub(super) fn push_number_property(
    props: &mut Vec<QueryPlanProperty>,
    name: &str,
    value: Option<f64>,
) {
    if let Some(value) = value {
        props.push(property(name, format_number(value)));
    }
}

pub(super) fn push_string_property(
    props: &mut Vec<QueryPlanProperty>,
    name: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        props.push(property(name, value));
    }
}

pub(super) fn node_property_text<'a>(node: &'a QueryPlanNode, name: &str) -> Option<&'a str> {
    node.properties
        .iter()
        .find(|property| property.name == name)
        .map(|property| property.value.as_str())
}

pub(super) fn node_property_f64(node: &QueryPlanNode, name: &str) -> Option<f64> {
    node_property_text(node, name).and_then(parse_f64)
}

pub(super) fn node_property_bool(node: &QueryPlanNode, name: &str) -> bool {
    node_property_text(node, name)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "1" | "yes"))
        .unwrap_or(false)
}

fn estimate_error_ratio(estimated: Option<f64>, actual: Option<f64>) -> Option<f64> {
    let (Some(estimated), Some(actual)) = (estimated, actual) else {
        return None;
    };
    if estimated <= 0.0 || actual <= 0.0 {
        return None;
    }
    Some((actual / estimated).max(estimated / actual))
}

pub(super) fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| match value {
            serde_json::Value::String(text) => Some(text.clone()),
            serde_json::Value::Number(number) => Some(number.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

pub(super) fn number_field(value: &serde_json::Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|value| match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => parse_f64(text),
        _ => None,
    })
}

pub(super) fn bool_field(value: &serde_json::Value, key: &str) -> Option<bool> {
    value.get(key).and_then(|value| match value {
        serde_json::Value::Bool(value) => Some(*value),
        serde_json::Value::Number(number) => number.as_i64().map(|value| value != 0),
        serde_json::Value::String(text) => {
            let normalized = text.to_ascii_lowercase();
            match normalized.as_str() {
                "true" | "1" | "yes" => Some(true),
                "false" | "0" | "no" => Some(false),
                _ => None,
            }
        }
        _ => None,
    })
}

pub(super) fn compact_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|value| match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        other => serde_json::to_string(other).ok(),
    })
}

pub(super) fn table_value(
    columns: &[String],
    row: &[serde_json::Value],
    names: &[&str],
) -> Option<String> {
    let by_name = columns
        .iter()
        .enumerate()
        .map(|(index, column)| (column.to_ascii_lowercase(), index))
        .collect::<BTreeMap<_, _>>();
    for name in names {
        if let Some(index) = by_name.get(*name) {
            return row
                .get(*index)
                .map(json_cell)
                .filter(|value| !value.is_empty());
        }
    }
    None
}

pub(super) fn json_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

pub(super) fn parse_f64(value: &str) -> Option<f64> {
    value.replace(',', "").parse::<f64>().ok()
}

fn contains_ascii_case(haystack: &str, needle: &str) -> bool {
    let needle = needle.as_bytes();
    !needle.is_empty()
        && haystack
            .as_bytes()
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
}

pub(super) fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else if value.abs() >= 1000.0 {
        format!("{value:.1}")
    } else {
        format!("{value:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

pub(super) fn wire_label(wire: Wire) -> &'static str {
    match wire {
        Wire::Postgres => "Postgres-wire",
        Wire::Mysql => "MySQL-wire",
        Wire::Sqlite => "SQLite",
        Wire::SqlServer => "SQL Server",
        Wire::DuckDb => "DuckDB",
        Wire::Mongo => "MongoDB",
        Wire::Oracle => "Oracle",
        Wire::ClickHouse => "ClickHouse",
        Wire::Neo4j => "Neo4j",
        Wire::Memgraph => "Memgraph",
        Wire::InfluxDb => "InfluxDB",
        Wire::Qdrant => "Qdrant",
        Wire::Milvus => "Milvus",
        Wire::Pinecone => "Pinecone",
        Wire::Snowflake => "Snowflake",
        Wire::BigQuery => "BigQuery",
        Wire::Redis => "Redis",
        Wire::Cassandra => "Cassandra",
        Wire::Bigtable => "Bigtable",
        Wire::CloudSpanner => "Cloud Spanner",
        Wire::Jdbc => "JDBC",
        Wire::Search => "Search",
        Wire::Document => "Document",
        Wire::KeyValue => "Key-value",
        Wire::Graph => "Graph",
        Wire::TimeSeries => "Time-series",
        Wire::Lakehouse => "Lakehouse",
    }
}

pub(super) fn trim_sql(sql: &str) -> String {
    sql.trim().trim_end_matches(';').trim().to_string()
}
