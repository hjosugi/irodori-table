use super::super::engine::Wire;
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
        .any(|metric| metric.key == "tempBlocks" && metric.severity == QueryPlanSeverity::Warning));
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
