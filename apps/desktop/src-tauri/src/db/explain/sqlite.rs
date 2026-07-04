use std::collections::BTreeSet;

use super::super::engine::Wire;
use super::model::{
    QueryPlanAnalysis, QueryPlanCopyFormat, QueryPlanFinding, QueryPlanMode, QueryPlanNode,
    QueryPlanSeverity,
};
use super::render::{copy_formats, merge_static_findings, native_analysis, property};

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
