use super::super::engine::Wire;
use super::model::{
    QueryPlanAnalysis, QueryPlanCopyFormat, QueryPlanFinding, QueryPlanMetric, QueryPlanMode,
    QueryPlanNode, QueryPlanSeverity,
};
use super::render::{
    copy_formats, format_number, merge_static_findings, native_analysis, node_property_f64,
    node_property_text, number_field, property, push_number_property, push_string_property,
    string_field,
};
use super::static_analysis::static_analysis;

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
