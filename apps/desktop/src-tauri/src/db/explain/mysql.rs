use super::super::engine::Wire;
use super::model::{
    QueryPlanAnalysis, QueryPlanCopyFormat, QueryPlanFinding, QueryPlanMode, QueryPlanNode,
    QueryPlanSeverity,
};
use super::render::{
    bool_field, compact_field, copy_formats, format_number, json_cell, merge_static_findings,
    native_analysis, node_property_bool, node_property_f64, number_field, parse_f64, plan_rows_tsv,
    property, push_number_property, push_string_property, string_field, table_value,
};
use super::static_analysis::static_analysis;

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
