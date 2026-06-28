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
    let root_item = json
        .as_array()
        .and_then(|items| items.first())
        .or_else(|| json.as_object().map(|_| &json));
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
    enrich_postgres_root_metrics(&mut analysis, root_item);
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

fn enrich_postgres_root_metrics(
    analysis: &mut QueryPlanAnalysis,
    root_item: Option<&serde_json::Value>,
) {
    let Some(root_item) = root_item else {
        return;
    };
    let planning_ms = number_field(root_item, "Planning Time");
    let execution_ms = number_field(root_item, "Execution Time");

    if let Some(root) = analysis.nodes.first_mut() {
        push_number_property(&mut root.properties, "planningTimeMs", planning_ms);
        push_number_property(&mut root.properties, "executionTimeMs", execution_ms);
    }

    if let Some(planning_ms) = planning_ms {
        analysis.metrics.push(QueryPlanMetric {
            key: "planningTime".into(),
            label: "Planning time".into(),
            value: format_number(planning_ms),
            unit: "ms".into(),
            severity: if planning_ms >= 500.0 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "Time PostgreSQL spent choosing the execution plan.".into(),
        });
    }
    if let Some(execution_ms) = execution_ms {
        analysis.metrics.push(QueryPlanMetric {
            key: "executionTime".into(),
            label: "Execution time".into(),
            value: format_number(execution_ms),
            unit: "ms".into(),
            severity: if execution_ms >= 1000.0 {
                QueryPlanSeverity::Warning
            } else {
                QueryPlanSeverity::Info
            },
            description: "Total runtime reported by PostgreSQL for the statement.".into(),
        });
    }
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
    push_number_property(
        &mut properties,
        "actualLoops",
        number_field(plan, "Actual Loops"),
    );
    push_number_property(
        &mut properties,
        "planWidth",
        number_field(plan, "Plan Width"),
    );
    push_number_property(
        &mut properties,
        "rowsRemovedByFilter",
        number_field(plan, "Rows Removed by Filter"),
    );
    push_number_property(
        &mut properties,
        "rowsRemovedByJoinFilter",
        number_field(plan, "Rows Removed by Join Filter"),
    );
    push_number_property(
        &mut properties,
        "sharedHitBlocks",
        number_field(plan, "Shared Hit Blocks"),
    );
    push_number_property(
        &mut properties,
        "sharedReadBlocks",
        number_field(plan, "Shared Read Blocks"),
    );
    push_number_property(
        &mut properties,
        "sharedDirtiedBlocks",
        number_field(plan, "Shared Dirtied Blocks"),
    );
    push_number_property(
        &mut properties,
        "sharedWrittenBlocks",
        number_field(plan, "Shared Written Blocks"),
    );
    push_number_property(
        &mut properties,
        "localReadBlocks",
        number_field(plan, "Local Read Blocks"),
    );
    push_number_property(
        &mut properties,
        "tempReadBlocks",
        number_field(plan, "Temp Read Blocks"),
    );
    push_number_property(
        &mut properties,
        "tempWrittenBlocks",
        number_field(plan, "Temp Written Blocks"),
    );
    push_number_property(
        &mut properties,
        "ioReadTimeMs",
        number_field(plan, "I/O Read Time"),
    );
    push_number_property(
        &mut properties,
        "ioWriteTimeMs",
        number_field(plan, "I/O Write Time"),
    );
    push_number_property(
        &mut properties,
        "sortSpaceUsed",
        number_field(plan, "Sort Space Used"),
    );
    push_number_property(
        &mut properties,
        "hashBatches",
        number_field(plan, "Hash Batches"),
    );
    push_number_property(
        &mut properties,
        "peakMemoryUsage",
        number_field(plan, "Peak Memory Usage"),
    );
    push_number_property(
        &mut properties,
        "workersPlanned",
        number_field(plan, "Workers Planned"),
    );
    push_number_property(
        &mut properties,
        "workersLaunched",
        number_field(plan, "Workers Launched"),
    );
    push_number_property(
        &mut properties,
        "walRecords",
        number_field(plan, "WAL Records"),
    );
    push_number_property(&mut properties, "walFpi", number_field(plan, "WAL FPI"));
    push_number_property(&mut properties, "walBytes", number_field(plan, "WAL Bytes"));
    if let Some(alias) = alias {
        properties.push(property("alias", alias));
    }
    if let Some(index_name) = string_field(plan, "Index Name") {
        properties.push(property("index", index_name));
    }
    if let Some(filter) = string_field(plan, "Filter") {
        properties.push(property("filter", filter));
    }
    push_string_property(
        &mut properties,
        "indexCond",
        string_field(plan, "Index Cond"),
    );
    push_string_property(&mut properties, "hashCond", string_field(plan, "Hash Cond"));
    push_string_property(
        &mut properties,
        "mergeCond",
        string_field(plan, "Merge Cond"),
    );
    push_string_property(
        &mut properties,
        "joinFilter",
        string_field(plan, "Join Filter"),
    );
    push_string_property(
        &mut properties,
        "recheckCond",
        string_field(plan, "Recheck Cond"),
    );
    push_string_property(
        &mut properties,
        "sortMethod",
        string_field(plan, "Sort Method"),
    );
    push_string_property(
        &mut properties,
        "sortSpaceType",
        string_field(plan, "Sort Space Type"),
    );
    push_string_property(
        &mut properties,
        "parallelAware",
        string_field(plan, "Parallel Aware"),
    );

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
            let has_operation_marker = bool_field(value, "using_filesort").unwrap_or(false)
                || bool_field(value, "using_temporary_table").unwrap_or(false);
            let node_id = if has_table || has_cost || has_operation_marker {
                let id = format!("mysql-{}", nodes.len());
                let table = string_field(value, "table_name");
                let access_type = string_field(value, "access_type");
                let operation = if bool_field(value, "using_filesort").unwrap_or(false) {
                    "Filesort".to_string()
                } else if bool_field(value, "using_temporary_table").unwrap_or(false) {
                    "Temporary table".to_string()
                } else {
                    access_type
                        .as_ref()
                        .map(|access| format!("Access {access}"))
                        .unwrap_or_else(|| label_hint.to_string())
                };
                let rows_examined = number_field(value, "rows_examined_per_scan");
                let rows_produced = number_field(value, "rows_produced_per_join");
                let rows = rows_examined.or(rows_produced);
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
                push_number_property(&mut properties, "rowsExaminedPerScan", rows_examined);
                push_number_property(&mut properties, "rowsProducedPerJoin", rows_produced);
                push_number_property(
                    &mut properties,
                    "filteredPercent",
                    number_field(value, "filtered"),
                );
                push_string_property(
                    &mut properties,
                    "usedKeyParts",
                    compact_field(value, "used_key_parts"),
                );
                push_string_property(
                    &mut properties,
                    "usedColumns",
                    compact_field(value, "used_columns"),
                );
                push_string_property(
                    &mut properties,
                    "attachedCondition",
                    string_field(value, "attached_condition"),
                );
                push_string_property(
                    &mut properties,
                    "usingFilesort",
                    string_field(value, "using_filesort"),
                );
                push_string_property(
                    &mut properties,
                    "usingTemporaryTable",
                    string_field(value, "using_temporary_table"),
                );
                if let Some(cost_info) = value.get("cost_info") {
                    push_string_property(
                        &mut properties,
                        "dataReadPerJoin",
                        string_field(cost_info, "data_read_per_join"),
                    );
                    push_number_property(
                        &mut properties,
                        "prefixCost",
                        string_field(cost_info, "prefix_cost").and_then(|cost| parse_f64(&cost)),
                    );
                    push_number_property(
                        &mut properties,
                        "readCost",
                        string_field(cost_info, "read_cost").and_then(|cost| parse_f64(&cost)),
                    );
                    push_number_property(
                        &mut properties,
                        "evalCost",
                        string_field(cost_info, "eval_cost").and_then(|cost| parse_f64(&cost)),
                    );
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
            } else if actual > 0.0 && estimated / actual >= 10.0 {
                findings.push(QueryPlanFinding {
                    severity: QueryPlanSeverity::Info,
                    title: "Row estimate overstatement".into(),
                    detail: format!(
                        "{} returned about {}x fewer rows than estimated.",
                        node.label,
                        format_number(estimated / actual)
                    ),
                    action:
                        "Check statistics and predicates; overestimates can still push bad join order or memory choices."
                            .into(),
                    node_id: Some(node.id.clone()),
                });
            }
        }
        let rows_removed = node_property_f64(node, "rowsRemovedByFilter").unwrap_or(0.0)
            + node_property_f64(node, "rowsRemovedByJoinFilter").unwrap_or(0.0);
        if rows_removed >= 10_000.0 {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Late row rejection".into(),
                detail: format!(
                    "{} removed about {} rows after reading them.",
                    node.label,
                    format_number(rows_removed)
                ),
                action:
                    "Push the predicate into an indexable condition or reduce rows before this filter/join."
                        .into(),
                node_id: Some(node.id.clone()),
            });
        }
        let temp_blocks = node_property_f64(node, "tempReadBlocks").unwrap_or(0.0)
            + node_property_f64(node, "tempWrittenBlocks").unwrap_or(0.0);
        let sort_spilled = node_property_text(node, "sortSpaceType")
            .map(|value| value.eq_ignore_ascii_case("disk"))
            .unwrap_or(false);
        if temp_blocks > 0.0 || sort_spilled {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Disk-backed temp work".into(),
                detail: format!(
                    "{} used temporary disk work{}.",
                    node.label,
                    if temp_blocks > 0.0 {
                        format!(" ({} temp blocks)", format_number(temp_blocks))
                    } else {
                        String::new()
                    }
                ),
                action:
                    "Check work_mem, sort/hash inputs, indexes that avoid sorting, and whether the result can be reduced earlier."
                        .into(),
                node_id: Some(node.id.clone()),
            });
        }
        if node_property_f64(node, "hashBatches").unwrap_or(1.0) > 1.0 {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Hash work batched".into(),
                detail: format!("{} split hash work into multiple batches.", node.label),
                action: "Reduce hash input rows or memory pressure; check work_mem and join order."
                    .into(),
                node_id: Some(node.id.clone()),
            });
        }
        let shared_read_blocks = node_property_f64(node, "sharedReadBlocks").unwrap_or(0.0);
        if shared_read_blocks >= 10_000.0 {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Info,
                title: "I/O-heavy read".into(),
                detail: format!(
                    "{} read about {} shared blocks from storage/cache misses.",
                    node.label,
                    format_number(shared_read_blocks)
                ),
                action:
                    "Check buffer hit ratio, table/index size, cache pressure, and whether the scan can become more selective."
                        .into(),
                node_id: Some(node.id.clone()),
            });
        }
        if let (Some(planned), Some(launched)) = (
            node_property_f64(node, "workersPlanned"),
            node_property_f64(node, "workersLaunched"),
        ) {
            if planned > launched {
                findings.push(QueryPlanFinding {
                    severity: QueryPlanSeverity::Info,
                    title: "Parallel worker shortfall".into(),
                    detail: format!(
                        "{} planned {} worker(s) but launched {}.",
                        node.label,
                        format_number(planned),
                        format_number(launched)
                    ),
                    action:
                        "Check max_parallel_workers settings and concurrent workload when comparing Analyse runs."
                            .into(),
                    node_id: Some(node.id.clone()),
                });
            }
        }
        if op.contains("scan") && node.loops.unwrap_or(0.0) >= 100.0 {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "Repeated scan loop".into(),
                detail: format!(
                    "{} ran about {} loop(s).",
                    node.label,
                    format_number(node.loops.unwrap_or_default())
                ),
                action:
                    "Inspect the parent join; a nested loop may be repeatedly scanning an expensive inner side."
                        .into(),
                node_id: Some(node.id.clone()),
            });
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
        if node_property_bool(node, "usingFilesort") {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "MySQL filesort".into(),
                detail: format!("{} requires an explicit sort step.", node.label),
                action:
                    "Check whether the ORDER BY/GROUP BY can use an index, or reduce rows before sorting."
                        .into(),
                node_id: Some(node.id.clone()),
            });
        }
        if node_property_bool(node, "usingTemporaryTable") {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "MySQL temporary table".into(),
                detail: format!("{} materializes intermediate rows in a temporary table.", node.label),
                action:
                    "Reduce grouped/sorted rows, review GROUP BY/DISTINCT shape, and check memory temp table limits."
                        .into(),
                node_id: Some(node.id.clone()),
            });
        }
        if let (Some(examined), Some(produced)) = (
            node_property_f64(node, "rowsExaminedPerScan"),
            node_property_f64(node, "rowsProducedPerJoin"),
        ) {
            if produced > 0.0 && examined / produced >= 100.0 {
                findings.push(QueryPlanFinding {
                    severity: QueryPlanSeverity::Warning,
                    title: "High rows examined".into(),
                    detail: format!(
                        "{} examines about {}x more rows than it produces.",
                        node.label,
                        format_number(examined / produced)
                    ),
                    action:
                        "Add a more selective index or predicate so MySQL can avoid reading rows that are later filtered."
                            .into(),
                    node_id: Some(node.id.clone()),
                });
            }
        }
    }
    findings
}

fn sqlite_findings(nodes: &[QueryPlanNode]) -> Vec<QueryPlanFinding> {
    let mut findings = Vec::new();
    for node in nodes {
        let upper = node.label.to_ascii_uppercase();
        if upper.contains("USE TEMP B-TREE") {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "SQLite temporary B-tree".into(),
                detail: node.label.clone(),
                action:
                    "Add an index matching ORDER BY/GROUP BY/DISTINCT, or reduce rows before the sort/aggregate."
                        .into(),
                node_id: Some(node.id.clone()),
            });
        } else if upper.contains("SCAN") {
            findings.push(QueryPlanFinding {
                severity: QueryPlanSeverity::Warning,
                title: "SQLite scan".into(),
                detail: node.label.clone(),
                action: "For large tables, check indexes with PRAGMA index_list and add a predicate that can use one.".into(),
                node_id: Some(node.id.clone()),
            });
        }
    }
    findings
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

fn push_string_property(props: &mut Vec<QueryPlanProperty>, name: &str, value: Option<String>) {
    if let Some(value) = value {
        props.push(property(name, value));
    }
}

fn node_property_text<'a>(node: &'a QueryPlanNode, name: &str) -> Option<&'a str> {
    node.properties
        .iter()
        .find(|property| property.name == name)
        .map(|property| property.value.as_str())
}

fn node_property_f64(node: &QueryPlanNode, name: &str) -> Option<f64> {
    node_property_text(node, name).and_then(parse_f64)
}

fn node_property_bool(node: &QueryPlanNode, name: &str) -> bool {
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

fn bool_field(value: &serde_json::Value, key: &str) -> Option<bool> {
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

fn compact_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|value| match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        other => serde_json::to_string(other).ok(),
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

fn contains_ascii_case(haystack: &str, needle: &str) -> bool {
    let needle = needle.as_bytes();
    !needle.is_empty()
        && haystack
            .as_bytes()
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle))
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

    #[test]
    fn postgres_json_surfaces_runtime_io_and_spill_signals() {
        let raw = serde_json::json!([
            {
                "Planning Time": 12.5,
                "Execution Time": 1550.0,
                "Plan": {
                    "Node Type": "Sort",
                    "Total Cost": 1000.0,
                    "Plan Rows": 100,
                    "Actual Rows": 50000,
                    "Actual Total Time": 1200.0,
                    "Sort Method": "external merge",
                    "Sort Space Used": 8192,
                    "Sort Space Type": "Disk",
                    "Temp Read Blocks": 256,
                    "Temp Written Blocks": 512,
                    "Plans": [
                        {
                            "Node Type": "Seq Scan",
                            "Relation Name": "events",
                            "Plan Rows": 100,
                            "Actual Rows": 50000,
                            "Rows Removed by Filter": 25000,
                            "Shared Read Blocks": 12000,
                            "Actual Loops": 1,
                            "Actual Total Time": 900.0
                        }
                    ]
                }
            }
        ]);
        let plan = analysis_from_postgres_json(
            Wire::Postgres,
            "select * from events order by created_at",
            QueryPlanMode::Analyze,
            raw.clone(),
            serde_json::to_string_pretty(&raw).unwrap(),
        );

        let sort = plan
            .nodes
            .iter()
            .find(|node| node.operation == "Sort")
            .unwrap();
        assert!(sort
            .properties
            .iter()
            .any(|property| property.name == "sortSpaceType" && property.value == "Disk"));
        assert!(plan
            .metrics
            .iter()
            .any(|metric| metric.key == "executionTime" && metric.value == "1550"));
        assert!(plan
            .metrics
            .iter()
            .any(|metric| metric.key == "tempBlocks"
                && metric.severity == QueryPlanSeverity::Warning));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Disk-backed temp work"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Late row rejection"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Row estimate mismatch"));
    }

    #[test]
    fn mysql_json_surfaces_filesort_temp_table_and_row_waste() {
        let raw = serde_json::json!({
            "query_block": {
                "ordering_operation": {
                    "using_filesort": true,
                    "using_temporary_table": true,
                    "table": {
                        "table_name": "orders",
                        "access_type": "ALL",
                        "rows_examined_per_scan": 50000,
                        "rows_produced_per_join": 10,
                        "filtered": "0.02",
                        "attached_condition": "orders.status = 'open'",
                        "cost_info": {
                            "read_cost": "1000.00",
                            "eval_cost": "250.00",
                            "prefix_cost": "1250.00",
                            "data_read_per_join": "12M"
                        }
                    }
                }
            }
        });
        let plan = analysis_from_mysql_json(
            Wire::Mysql,
            "select * from orders where status = 'open' order by created_at",
            QueryPlanMode::Plan,
            raw.clone(),
            serde_json::to_string_pretty(&raw).unwrap(),
        );

        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "MySQL filesort"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "MySQL temporary table"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "Full table access"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "High rows examined"));
        assert!(plan.nodes.iter().any(|node| node
            .properties
            .iter()
            .any(|property| property.name == "attachedCondition")));
    }

    #[test]
    fn sqlite_rows_surface_temp_btree_separately_from_scan() {
        let plan = analysis_from_sqlite_rows(
            Wire::Sqlite,
            "select * from orders order by created_at",
            QueryPlanMode::Plan,
            vec![
                (2, 0, "SCAN orders".into()),
                (3, 0, "USE TEMP B-TREE FOR ORDER BY".into()),
            ],
        );

        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "SQLite scan"));
        assert!(plan
            .findings
            .iter()
            .any(|finding| finding.title == "SQLite temporary B-tree"));
    }
}
