use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::engine::Wire;

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

pub(crate) fn static_analysis(wire: Wire, sql: &str, mode: QueryPlanMode) -> QueryPlanAnalysis {
    let normalized_sql = trim_sql(sql);
    let tokens = sql_words(&normalized_sql);
    let tables = collect_table_mentions(&tokens);
    let has_select = tokens.iter().any(|token| token == "select");
    let has_where = tokens.iter().any(|token| token == "where");
    let has_order = tokens.iter().any(|token| token == "order");
    let has_limit = tokens
        .iter()
        .any(|token| matches!(token.as_str(), "limit" | "top" | "fetch"));
    let has_group = tokens.iter().any(|token| token == "group");
    let has_distinct = tokens.iter().any(|token| token == "distinct");
    let has_select_star = normalized_sql.contains('*');
    let join_count = tokens
        .iter()
        .filter(|token| token.as_str() == "join")
        .count();

    let mut nodes = Vec::new();
    nodes.push(QueryPlanNode {
        id: "static-root".into(),
        parent_id: None,
        depth: 0,
        label: "Query".into(),
        operation: mode.label().into(),
        object: None,
        estimated_rows: None,
        actual_rows: None,
        startup_cost: None,
        total_cost: None,
        actual_startup_ms: None,
        actual_total_ms: None,
        loops: None,
        width: None,
        impact_score: 1.0,
        properties: vec![
            property("analysis", "static"),
            property(
                "statements",
                super::split_sql_statements(&normalized_sql).len(),
            ),
        ],
        notes: vec![
            "Native optimizer metrics are unavailable, so this is a structural risk scan.".into(),
        ],
    });

    for (index, table) in tables.iter().enumerate() {
        nodes.push(QueryPlanNode {
            id: format!("static-scan-{index}"),
            parent_id: Some("static-root".into()),
            depth: 1,
            label: format!("Read {table}"),
            operation: "Read object".into(),
            object: Some(table.clone()),
            estimated_rows: None,
            actual_rows: None,
            startup_cost: None,
            total_cost: None,
            actual_startup_ms: None,
            actual_total_ms: None,
            loops: None,
            width: None,
            impact_score: 0.45,
            properties: vec![property("source", table)],
            notes: Vec::new(),
        });
    }

    if join_count > 0 {
        nodes.push(static_operation_node(
            "static-join",
            "Join",
            format!("{join_count} join clause(s)"),
            0.72,
        ));
    }
    if has_where {
        nodes.push(static_operation_node(
            "static-filter",
            "Filter",
            "WHERE predicate".into(),
            0.35,
        ));
    }
    if has_group || has_distinct {
        nodes.push(static_operation_node(
            "static-aggregate",
            "Aggregate / distinct",
            "Grouping or duplicate elimination".into(),
            0.62,
        ));
    }
    if has_order {
        nodes.push(static_operation_node(
            "static-sort",
            "Sort",
            "ORDER BY".into(),
            0.58,
        ));
    }

    let edges = nodes
        .iter()
        .filter_map(|node| {
            node.parent_id.as_ref().map(|parent| QueryPlanEdge {
                from: parent.clone(),
                to: node.id.clone(),
                label: "feeds".into(),
            })
        })
        .collect();

    let mut findings = Vec::new();
    if has_select && !tables.is_empty() && !has_where {
        findings.push(QueryPlanFinding {
            severity: QueryPlanSeverity::Warning,
            title: "Broad read candidate".into(),
            detail: "The query reads table data without a WHERE predicate.".into(),
            action: "Add a selective predicate, partition filter, or LIMIT before running against large production tables.".into(),
            node_id: Some("static-root".into()),
        });
    }
    if has_select_star {
        findings.push(QueryPlanFinding {
            severity: QueryPlanSeverity::Info,
            title: "Wide projection".into(),
            detail: "SELECT * can move more data than needed and can hide expensive large columns."
                .into(),
            action: "Select only the columns needed for this task.".into(),
            node_id: Some("static-root".into()),
        });
    }
    if join_count >= 3 {
        findings.push(QueryPlanFinding {
            severity: QueryPlanSeverity::Warning,
            title: "Join-heavy query".into(),
            detail: format!("The query contains {join_count} JOIN clauses."),
            action: "Check join predicates and indexes on both sides of each join key.".into(),
            node_id: Some("static-join".into()),
        });
    }
    if has_order && !has_limit {
        findings.push(QueryPlanFinding {
            severity: QueryPlanSeverity::Warning,
            title: "Unbounded sort".into(),
            detail: "ORDER BY without LIMIT can require sorting the full result set.".into(),
            action: "Add LIMIT/TOP/FETCH for previews, or ensure the ORDER BY columns are indexed."
                .into(),
            node_id: Some("static-sort".into()),
        });
    }
    if findings.is_empty() {
        findings.push(QueryPlanFinding {
            severity: QueryPlanSeverity::Info,
            title: "No obvious structural risk".into(),
            detail:
                "The static scan did not find broad reads, unbounded sorts, or join-heavy shape."
                    .into(),
            action:
                "Use native Explain Analyse for actual timing, row estimates, buffers, and loops."
                    .into(),
            node_id: None,
        });
    }

    let mut analysis = QueryPlanAnalysis {
        mode,
        source: QueryPlanSource::StaticAnalysis,
        engine_family: wire_label(wire).into(),
        headline: "Static query-shape analysis".into(),
        summary: static_summary(&tables, join_count, has_where, has_order, has_group),
        sql: normalized_sql,
        nodes,
        edges,
        flame_graph: Vec::new(),
        metrics: static_metrics(&tables, join_count, has_where, has_order),
        findings,
        metric_guide: metric_guide(mode),
        copy_formats: Vec::new(),
    };
    analysis.flame_graph = flame_from_nodes(&analysis.nodes);
    analysis.copy_formats = copy_formats(&analysis, None);
    analysis
}

pub(crate) fn analysis_from_postgres_json(
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
    json: serde_json::Value,
    raw: String,
) -> QueryPlanAnalysis {
    let mut nodes = Vec::new();
    let root_plan = json
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item.get("Plan"))
        .or_else(|| json.get("Plan"));
    if let Some(plan) = root_plan {
        collect_postgres_plan_nodes(plan, None, 0, &mut nodes);
    }
    if nodes.is_empty() {
        return static_analysis(wire, sql, mode).with_native_error(
            "PostgreSQL returned a plan shape Irodori could not normalize.".into(),
        );
    }

    let mut analysis = native_analysis(wire, sql, mode, nodes, "PostgreSQL JSON plan");
    analysis.findings.extend(postgres_findings(&analysis.nodes));
    merge_static_findings(&mut analysis, wire, sql, mode);
    analysis.copy_formats = copy_formats(
        &analysis,
        Some(QueryPlanCopyFormat {
            label: "PostgreSQL JSON".into(),
            mime_type: "application/json".into(),
            content: raw,
        }),
    );
    analysis
}

pub(crate) fn analysis_from_mysql_json(
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
    json: serde_json::Value,
    raw: String,
) -> QueryPlanAnalysis {
    let mut nodes = Vec::new();
    collect_mysql_plan_nodes(&json, None, 0, "query", &mut nodes);
    if nodes.is_empty() {
        return static_analysis(wire, sql, mode)
            .with_native_error("MySQL returned an empty JSON plan.".into());
    }

    let mut analysis = native_analysis(wire, sql, mode, nodes, "MySQL JSON plan");
    analysis.findings.extend(mysql_findings(&analysis.nodes));
    merge_static_findings(&mut analysis, wire, sql, mode);
    analysis.copy_formats = copy_formats(
        &analysis,
        Some(QueryPlanCopyFormat {
            label: "MySQL JSON".into(),
            mime_type: "application/json".into(),
            content: raw,
        }),
    );
    analysis
}

pub(crate) fn analysis_from_row_table(
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    label: &str,
) -> QueryPlanAnalysis {
    let mut nodes = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let props = columns
            .iter()
            .enumerate()
            .map(|(column_index, column)| {
                property(
                    column,
                    row.get(column_index)
                        .map(json_cell)
                        .unwrap_or_else(|| "".into()),
                )
            })
            .collect::<Vec<_>>();
        let operation = table_value(&columns, row, &["type", "select_type", "detail"])
            .unwrap_or_else(|| "Plan row".into());
        let object = table_value(&columns, row, &["table", "tbl_name", "detail"]);
        nodes.push(QueryPlanNode {
            id: format!("native-row-{index}"),
            parent_id: (index > 0).then(|| format!("native-row-{}", index - 1)),
            depth: index as u32,
            label: object.clone().unwrap_or_else(|| operation.clone()),
            operation,
            object,
            estimated_rows: table_value(&columns, row, &["rows"]).and_then(|v| parse_f64(&v)),
            actual_rows: None,
            startup_cost: None,
            total_cost: None,
            actual_startup_ms: None,
            actual_total_ms: None,
            loops: None,
            width: None,
            impact_score: 0.5,
            properties: props,
            notes: Vec::new(),
        });
    }
    if nodes.is_empty() {
        return static_analysis(wire, sql, mode)
            .with_native_error(format!("{label} returned no plan rows."));
    }
    let mut analysis = native_analysis(wire, sql, mode, nodes, label);
    merge_static_findings(&mut analysis, wire, sql, mode);
    analysis.copy_formats = copy_formats(
        &analysis,
        Some(QueryPlanCopyFormat {
            label: label.into(),
            mime_type: "text/tab-separated-values".into(),
            content: plan_rows_tsv(&columns, &rows),
        }),
    );
    analysis
}

pub(crate) fn analysis_from_sqlite_rows(
    wire: Wire,
    sql: &str,
    mode: QueryPlanMode,
    rows: Vec<(i64, i64, String)>,
) -> QueryPlanAnalysis {
    let ids = rows.iter().map(|(id, _, _)| *id).collect::<BTreeSet<_>>();
    let mut nodes = Vec::new();
    for (index, (id, parent, detail)) in rows.iter().enumerate() {
        let parent_id = ids
            .contains(parent)
            .then(|| format!("sqlite-{parent}"))
            .or_else(|| (index > 0).then(|| "sqlite-root".to_string()));
        let operation = sqlite_operation(detail);
        nodes.push(QueryPlanNode {
            id: format!("sqlite-{id}"),
            parent_id,
            depth: if *parent <= 0 { 1 } else { 2 },
            label: detail.clone(),
            operation,
            object: sqlite_object(detail),
            estimated_rows: None,
            actual_rows: None,
            startup_cost: None,
            total_cost: None,
            actual_startup_ms: None,
            actual_total_ms: None,
            loops: None,
            width: None,
            impact_score: if detail.to_ascii_uppercase().contains("SCAN") {
                0.78
            } else {
                0.42
            },
            properties: vec![
                property("id", id),
                property("parent", parent),
                property("detail", detail),
            ],
            notes: Vec::new(),
        });
    }
    nodes.insert(
        0,
        QueryPlanNode {
            id: "sqlite-root".into(),
            parent_id: None,
            depth: 0,
            label: "SQLite query plan".into(),
            operation: "EXPLAIN QUERY PLAN".into(),
            object: None,
            estimated_rows: None,
            actual_rows: None,
            startup_cost: None,
            total_cost: None,
            actual_startup_ms: None,
            actual_total_ms: None,
            loops: None,
            width: None,
            impact_score: 1.0,
            properties: Vec::new(),
            notes: vec!["SQLite reports access strategy text rather than optimizer cost.".into()],
        },
    );

    let mut analysis = native_analysis(wire, sql, mode, nodes, "SQLite query plan");
    analysis.findings.extend(sqlite_findings(&analysis.nodes));
    merge_static_findings(&mut analysis, wire, sql, mode);
    analysis.copy_formats = copy_formats(
        &analysis,
        Some(QueryPlanCopyFormat {
            label: "SQLite detail".into(),
            mime_type: "text/plain".into(),
            content: rows
                .iter()
                .map(|(id, parent, detail)| format!("{id}\t{parent}\t{detail}"))
                .collect::<Vec<_>>()
                .join("\n"),
        }),
    );
    analysis
}

fn native_analysis(
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

fn collect_postgres_plan_nodes(
    plan: &serde_json::Value,
    parent_id: Option<String>,
    depth: u32,
    nodes: &mut Vec<QueryPlanNode>,
) {
    let index = nodes.len();
    let id = format!("pg-{index}");
    let operation = string_field(plan, "Node Type").unwrap_or_else(|| "Plan node".into());
    let relation = string_field(plan, "Relation Name");
    let alias = string_field(plan, "Alias");
    let label = relation
        .as_ref()
        .map(|relation| format!("{operation} on {relation}"))
        .unwrap_or_else(|| operation.clone());
    let mut properties = Vec::new();
    push_number_property(
        &mut properties,
        "startupCost",
        number_field(plan, "Startup Cost"),
    );
    push_number_property(
        &mut properties,
        "totalCost",
        number_field(plan, "Total Cost"),
    );
    push_number_property(&mut properties, "planRows", number_field(plan, "Plan Rows"));
    push_number_property(
        &mut properties,
        "actualRows",
        number_field(plan, "Actual Rows"),
    );
    push_number_property(
        &mut properties,
        "actualTotalTime",
        number_field(plan, "Actual Total Time"),
    );
    if let Some(alias) = alias {
        properties.push(property("alias", alias));
    }
    if let Some(index_name) = string_field(plan, "Index Name") {
        properties.push(property("index", index_name));
    }
    if let Some(filter) = string_field(plan, "Filter") {
        properties.push(property("filter", filter));
    }
    if let Some(cond) = string_field(plan, "Index Cond").or_else(|| string_field(plan, "Hash Cond"))
    {
        properties.push(property("condition", cond));
    }

    let actual_total_ms = number_field(plan, "Actual Total Time");
    let total_cost = number_field(plan, "Total Cost");
    let estimated_rows = number_field(plan, "Plan Rows");
    nodes.push(QueryPlanNode {
        id: id.clone(),
        parent_id,
        depth,
        label,
        operation,
        object: relation,
        estimated_rows,
        actual_rows: number_field(plan, "Actual Rows"),
        startup_cost: number_field(plan, "Startup Cost"),
        total_cost,
        actual_startup_ms: number_field(plan, "Actual Startup Time"),
        actual_total_ms,
        loops: number_field(plan, "Actual Loops"),
        width: number_field(plan, "Plan Width"),
        impact_score: actual_total_ms
            .or(total_cost)
            .or(estimated_rows)
            .unwrap_or(1.0),
        properties,
        notes: Vec::new(),
    });

    if let Some(children) = plan.get("Plans").and_then(|value| value.as_array()) {
        for child in children {
            collect_postgres_plan_nodes(child, Some(id.clone()), depth + 1, nodes);
        }
    }
}

fn collect_mysql_plan_nodes(
    value: &serde_json::Value,
    parent_id: Option<String>,
    depth: u32,
    label_hint: &str,
    nodes: &mut Vec<QueryPlanNode>,
) {
    match value {
        serde_json::Value::Object(map) => {
            let has_table = map.contains_key("table_name") || map.contains_key("access_type");
            let has_cost = map.contains_key("cost_info");
            let node_id = if has_table || has_cost {
                let id = format!("mysql-{}", nodes.len());
                let table = string_field(value, "table_name");
                let access_type = string_field(value, "access_type");
                let operation = access_type
                    .as_ref()
                    .map(|access| format!("Access {access}"))
                    .unwrap_or_else(|| label_hint.to_string());
                let rows = number_field(value, "rows_examined_per_scan")
                    .or_else(|| number_field(value, "rows_produced_per_join"));
                let total_cost = value
                    .get("cost_info")
                    .and_then(|cost| string_field(cost, "prefix_cost"))
                    .and_then(|cost| parse_f64(&cost));
                let mut properties = Vec::new();
                if let Some(access) = access_type {
                    properties.push(property("accessType", access));
                }
                if let Some(key) = string_field(value, "key") {
                    properties.push(property("key", key));
                }
                if let Some(rows) = rows {
                    properties.push(property("rowsExaminedPerScan", format_number(rows)));
                }
                if let Some(cost) = total_cost {
                    properties.push(property("prefixCost", format_number(cost)));
                }
                nodes.push(QueryPlanNode {
                    id: id.clone(),
                    parent_id: parent_id.clone(),
                    depth,
                    label: table
                        .as_ref()
                        .map(|table| format!("{operation} on {table}"))
                        .unwrap_or_else(|| operation.clone()),
                    operation,
                    object: table,
                    estimated_rows: rows,
                    actual_rows: None,
                    startup_cost: None,
                    total_cost,
                    actual_startup_ms: None,
                    actual_total_ms: None,
                    loops: None,
                    width: None,
                    impact_score: total_cost.or(rows).unwrap_or(1.0),
                    properties,
                    notes: Vec::new(),
                });
                Some(id)
            } else {
                parent_id
            };

            for (key, child) in map {
                if key == "cost_info" {
                    continue;
                }
                collect_mysql_plan_nodes(
                    child,
                    node_id.clone(),
                    depth + u32::from(node_id.is_some()),
                    key,
                    nodes,
                );
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_mysql_plan_nodes(item, parent_id.clone(), depth, label_hint, nodes);
            }
        }
        _ => {}
    }
}

fn merge_static_findings(
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

fn postgres_findings(nodes: &[QueryPlanNode]) -> Vec<QueryPlanFinding> {
    let mut findings = Vec::new();
    for node in nodes {
        let op = node.operation.to_ascii_lowercase();
        if op.contains("seq scan") && node.estimated_rows.unwrap_or(0.0) >= 10_000.0 {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Large sequential scan".into(),
                detail: format!(
                    "{} is estimated to read about {} rows.",
                    node.label,
                    format_number(node.estimated_rows.unwrap_or_default())
                ),
                action: "Check whether a selective predicate or supporting index should be used."
                    .into(),
                node_id: Some(node.id.clone()),
            });
        }
        if op.contains("nested loop") && node.estimated_rows.unwrap_or(0.0) >= 10_000.0 {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "High-row nested loop".into(),
                detail: "Nested loops can become expensive when the inner side runs many times.".into(),
                action: "Check join cardinality, statistics freshness, and indexes on the inner join key.".into(),
                node_id: Some(node.id.clone()),
            });
        }
        if let (Some(estimated), Some(actual)) = (node.estimated_rows, node.actual_rows) {
            if estimated > 0.0 && actual / estimated >= 10.0 {
                findings.push(QueryPlanFinding {
                    severity: QueryPlanSeverity::Warning,
                    title: "Row estimate mismatch".into(),
                    detail: format!(
                        "{} returned about {}x more rows than estimated.",
                        node.label,
                        format_number(actual / estimated)
                    ),
                    action: "Refresh statistics and check predicates with skewed values.".into(),
                    node_id: Some(node.id.clone()),
                });
            }
        }
    }
    findings
}

fn mysql_findings(nodes: &[QueryPlanNode]) -> Vec<QueryPlanFinding> {
    let mut findings = Vec::new();
    for node in nodes {
        let access_type = node
            .properties
            .iter()
            .find(|prop| prop.name == "accessType")
            .map(|prop| prop.value.as_str());
        if access_type == Some("ALL") {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Full table access".into(),
                detail: format!("{} uses MySQL access type ALL.", node.label),
                action: "Add or adjust an index for the WHERE/JOIN columns, or reduce the scanned range.".into(),
                node_id: Some(node.id.clone()),
            });
        }
    }
    findings
}

fn sqlite_findings(nodes: &[QueryPlanNode]) -> Vec<QueryPlanFinding> {
    nodes
        .iter()
        .filter(|node| node.label.to_ascii_uppercase().contains("SCAN"))
        .map(|node| QueryPlanFinding {
            severity: QueryPlanSeverity::Warning,
            title: "SQLite scan".into(),
            detail: node.label.clone(),
            action: "For large tables, check indexes with PRAGMA index_list and add a predicate that can use one.".into(),
            node_id: Some(node.id.clone()),
        })
        .collect()
}

fn native_metrics(nodes: &[QueryPlanNode], mode: QueryPlanMode) -> Vec<QueryPlanMetric> {
    let total_cost = nodes
        .iter()
        .filter_map(|node| node.total_cost)
        .fold(0.0_f64, f64::max);
    let max_estimated_rows = nodes
        .iter()
        .filter_map(|node| node.estimated_rows)
        .fold(0.0_f64, f64::max);
    let actual_ms = nodes
        .iter()
        .filter_map(|node| node.actual_total_ms)
        .fold(0.0_f64, f64::max);
    let scan_count = nodes
        .iter()
        .filter(|node| node.operation.to_ascii_lowercase().contains("scan"))
        .count();
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
    metrics
}

fn static_metrics(
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

fn metric_guide(mode: QueryPlanMode) -> Vec<QueryPlanMetricGuide> {
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

fn static_summary(
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

fn flame_from_nodes(nodes: &[QueryPlanNode]) -> Vec<QueryPlanFlameFrame> {
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

fn copy_formats(
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

fn plan_rows_tsv(columns: &[String], rows: &[Vec<serde_json::Value>]) -> String {
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

fn collect_table_mentions(tokens: &[String]) -> Vec<String> {
    let mut tables = BTreeSet::new();
    let starters = ["from", "join", "update", "into"];
    for (index, token) in tokens.iter().enumerate() {
        if !starters.contains(&token.as_str()) {
            continue;
        }
        let Some(next) = tokens.get(index + 1) else {
            continue;
        };
        if is_table_noise(next) {
            continue;
        }
        tables.insert(next.clone());
    }
    tables.into_iter().take(16).collect()
}

fn is_table_noise(token: &str) -> bool {
    matches!(
        token,
        "select" | "lateral" | "unnest" | "values" | "json_table" | "only"
    )
}

fn sql_words(sql: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    while let Some(ch) = chars.next() {
        if in_single {
            if ch == '\'' {
                if chars.peek() == Some(&'\'') {
                    let _ = chars.next();
                } else {
                    in_single = false;
                }
            }
            continue;
        }
        if in_double {
            if ch == '"' {
                in_double = false;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '\'' {
            push_word(&mut words, &mut current);
            in_single = true;
            continue;
        }
        if ch == '"' || ch == '`' {
            push_word(&mut words, &mut current);
            in_double = ch == '"';
            continue;
        }
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.') {
            current.push(ch.to_ascii_lowercase());
        } else {
            push_word(&mut words, &mut current);
        }
    }
    push_word(&mut words, &mut current);
    words
}

fn push_word(words: &mut Vec<String>, current: &mut String) {
    if current.is_empty() {
        return;
    }
    words.push(current.trim_matches('.').to_string());
    current.clear();
}

fn static_operation_node(
    id: &str,
    operation: &str,
    label: String,
    impact_score: f64,
) -> QueryPlanNode {
    QueryPlanNode {
        id: id.into(),
        parent_id: Some("static-root".into()),
        depth: 1,
        label,
        operation: operation.into(),
        object: None,
        estimated_rows: None,
        actual_rows: None,
        startup_cost: None,
        total_cost: None,
        actual_startup_ms: None,
        actual_total_ms: None,
        loops: None,
        width: None,
        impact_score,
        properties: Vec::new(),
        notes: Vec::new(),
    }
}

fn property(name: impl Into<String>, value: impl ToString) -> QueryPlanProperty {
    QueryPlanProperty {
        name: name.into(),
        value: value.to_string(),
    }
}

fn push_number_property(props: &mut Vec<QueryPlanProperty>, name: &str, value: Option<f64>) {
    if let Some(value) = value {
        props.push(property(name, format_number(value)));
    }
}

fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
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

fn number_field(value: &serde_json::Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|value| match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => parse_f64(text),
        _ => None,
    })
}

fn table_value(columns: &[String], row: &[serde_json::Value], names: &[&str]) -> Option<String> {
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

fn json_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(value) => value.clone(),
        other => other.to_string(),
    }
}

fn parse_f64(value: &str) -> Option<f64> {
    value.replace(',', "").parse::<f64>().ok()
}

fn format_number(value: f64) -> String {
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

fn sqlite_operation(detail: &str) -> String {
    let upper = detail.to_ascii_uppercase();
    if upper.contains("SEARCH") {
        "Index search".into()
    } else if upper.contains("SCAN") {
        "Scan".into()
    } else if upper.contains("USE TEMP B-TREE") {
        "Temporary sort".into()
    } else {
        "Plan step".into()
    }
}

fn sqlite_object(detail: &str) -> Option<String> {
    let words = detail.split_whitespace().collect::<Vec<_>>();
    words
        .windows(2)
        .find_map(|pair| {
            let left = pair[0].to_ascii_uppercase();
            (left == "SCAN" || left == "SEARCH").then(|| pair[1].to_string())
        })
        .filter(|value| !value.is_empty())
}

fn wire_label(wire: Wire) -> &'static str {
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
        Wire::ObjectStore => "Object store",
    }
}

fn trim_sql(sql: &str) -> String {
    sql.trim().trim_end_matches(';').trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_analysis_flags_broad_reads_and_unbounded_sorts() {
        let plan = static_analysis(
            Wire::Postgres,
            "select * from orders join customers on customers.id = orders.customer_id order by ordered_at",
            QueryPlanMode::Plan,
        );
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Broad read candidate"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Wide projection"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Unbounded sort"));
        assert!(!plan.nodes.is_empty());
        assert!(!plan.metric_guide.is_empty());
    }

    #[test]
    fn postgres_json_is_normalized_to_tree_nodes() {
        let raw = serde_json::json!([
            {
                "Plan": {
                    "Node Type": "Nested Loop",
                    "Total Cost": 42.0,
                    "Plan Rows": 10,
                    "Plans": [
                        {
                            "Node Type": "Seq Scan",
                            "Relation Name": "orders",
                            "Total Cost": 30.0,
                            "Plan Rows": 12000
                        }
                    ]
                }
            }
        ]);
        let plan = analysis_from_postgres_json(
            Wire::Postgres,
            "select * from orders",
            QueryPlanMode::Plan,
            raw.clone(),
            serde_json::to_string_pretty(&raw).unwrap(),
        );
        assert_eq!(plan.nodes.len(), 2);
        assert!(plan.edges.iter().any(|edge| edge.from == "pg-0"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Large sequential scan"));
    }
}
