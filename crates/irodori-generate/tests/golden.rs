//! Golden end-to-end checks for the generation pipeline.
//!
//! These pin the deterministic parts of generation: with a fixed schema and a
//! fixed model output (an [`EchoModel`]), the projection → plan → verify pipeline
//! must produce a fixed, canonical, schema-valid SQL string — and must reject
//! output that references objects outside the schema. (The model itself is
//! exercised separately behind the `llama` feature.)

use irodori_generate::{
    generate, EchoModel, GenColumn, GenForeignKey, GenSchema, GenTable, GenerateRequest,
};
use irodori_sql::dialect::PostgresDialect;

fn shop_schema() -> GenSchema {
    let customers = GenTable::new("customers").with_columns(vec![
        GenColumn::new("id", "int"),
        GenColumn::new("name", "text"),
        GenColumn::new("country", "text"),
    ]);
    let mut orders = GenTable::new("orders").with_columns(vec![
        GenColumn::new("id", "int"),
        GenColumn::new("customer_id", "int"),
        GenColumn::new("total", "numeric"),
        GenColumn::new("created_at", "timestamptz"),
    ]);
    orders.primary_key = vec!["id".into()];
    orders.foreign_keys.push(GenForeignKey {
        columns: vec!["customer_id".into()],
        ref_schema: None,
        ref_table: "customers".into(),
        ref_columns: vec!["id".into()],
    });
    let mut schema = GenSchema::new(vec![customers, orders]);
    schema.default_schema = Some("public".into());
    schema
}

#[test]
fn golden_aggregate_join_canonicalizes() {
    // A realistic model answer to "top customers by revenue".
    let model = EchoModel::new(
        "select c.name, sum(o.total) as revenue from orders o \
         join customers c on o.customer_id = c.id \
         group by c.name order by revenue desc limit 10",
    );
    let request = GenerateRequest::new("top customers by revenue", shop_schema());
    let outcome = generate(&model, &request, &PostgresDialect).expect("generation succeeds");

    assert_eq!(
        outcome.sql,
        "SELECT c.name, sum(o.total) AS revenue FROM orders o \
         JOIN customers c ON o.customer_id = c.id \
         GROUP BY c.name ORDER BY revenue DESC LIMIT 10"
    );
    assert!(outcome.repaired, "lowercase keywords canonicalized");
}

#[test]
fn golden_rejects_cross_table_hallucination() {
    // `customers.total` does not exist (total is on orders); must be rejected.
    let model = EchoModel::new("SELECT c.total FROM customers c");
    let request = GenerateRequest::new("totals", shop_schema());
    let err = generate(&model, &request, &PostgresDialect).unwrap_err();
    assert!(
        err.message.contains("unknown column"),
        "got: {}",
        err.message
    );
}

#[test]
fn golden_already_canonical_is_not_marked_repaired() {
    let model = EchoModel::new("SELECT id, total FROM orders WHERE total > 100");
    let request = GenerateRequest::new("big orders", shop_schema());
    let outcome = generate(&model, &request, &PostgresDialect).unwrap();
    assert_eq!(
        outcome.sql,
        "SELECT id, total FROM orders WHERE total > 100"
    );
    assert!(!outcome.repaired);
}
