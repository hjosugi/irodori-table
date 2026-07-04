use std::collections::BTreeSet;

use super::super::engine::Wire;
use super::model::{
    QueryPlanAnalysis, QueryPlanEdge, QueryPlanFinding, QueryPlanMode, QueryPlanNode,
    QueryPlanSeverity, QueryPlanSource,
};
use super::render::{
    copy_formats, flame_from_nodes, metric_guide, property, static_metrics, static_summary,
    trim_sql, wire_label,
};

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
                super::super::split_sql_statements(&normalized_sql).len(),
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
