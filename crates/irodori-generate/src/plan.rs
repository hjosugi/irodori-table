//! GEN-012 — deterministic planning (事前の調整).
//!
//! Before the model runs, resolve as much structure as possible *without* it:
//! pick the tables the prompt mentions, infer joins from foreign keys, and
//! assemble a compact schema-grounded prompt. The smaller the model's remaining
//! job, the smaller the model can be — which is the whole point of the design.

use crate::schema::{GenSchema, GenTable};
use irodori_sql::dialect::SqlDialect;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fmt::Write as _;

/// A table selected for the query, with a generated short alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedTable {
    pub schema: Option<String>,
    pub name: String,
    pub alias: String,
}

/// One `a.col = b.col` equality of an inferred join.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinPredicate {
    pub left: String,
    pub right: String,
}

/// An inferred join from a foreign key between two selected tables.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedJoin {
    pub table: PlannedTable,
    pub predicates: Vec<JoinPredicate>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QueryPlan {
    /// Selected tables in order of first mention; the first is the `FROM` base.
    pub tables: Vec<PlannedTable>,
    /// Joins for the non-base tables, derived from foreign keys.
    pub joins: Vec<PlannedJoin>,
}

/// Cap so a hub table with many referrers can't re-expand the grammar to the
/// whole schema; beyond this we just keep the planned tables.
const MAX_RELEVANT_TABLES: usize = 12;

/// Tables the grammar should expose for this query: the planned tables plus their
/// direct foreign-key neighbors (so closely-related tables the prompt didn't name
/// stay joinable). Returns empty when planning found nothing — callers then fall
/// back to the full schema. Scoping the grammar to these makes decoding lighter
/// and keeps the model from emitting irrelevant relations.
pub fn relevant_tables(plan: &QueryPlan, schema: &GenSchema) -> Vec<String> {
    if plan.tables.is_empty() {
        return Vec::new();
    }
    let by_name: HashMap<String, &GenTable> = schema
        .tables
        .iter()
        .map(|t| (t.name.to_ascii_lowercase(), t))
        .collect();

    let planned: HashSet<String> = plan
        .tables
        .iter()
        .map(|t| t.name.to_ascii_lowercase())
        .collect();
    let mut keep = planned.clone();

    // Outgoing: tables a planned table points at.
    for name in &planned {
        if let Some(table) = by_name.get(name) {
            for fk in &table.foreign_keys {
                keep.insert(fk.ref_table.to_ascii_lowercase());
            }
        }
    }
    // Incoming: tables that point at a planned table.
    for table in &schema.tables {
        if table
            .foreign_keys
            .iter()
            .any(|fk| planned.contains(&fk.ref_table.to_ascii_lowercase()))
        {
            keep.insert(table.name.to_ascii_lowercase());
        }
    }

    if keep.len() > MAX_RELEVANT_TABLES {
        return plan.tables.iter().map(|t| t.name.clone()).collect();
    }
    // Preserve schema order and original casing.
    schema
        .tables
        .iter()
        .filter(|t| keep.contains(&t.name.to_ascii_lowercase()))
        .map(|t| t.name.clone())
        .collect()
}

/// Resolve the tables the prompt mentions and the joins that connect them.
pub fn plan(prompt: &str, schema: &GenSchema) -> QueryPlan {
    let by_name: HashMap<String, &GenTable> = schema
        .tables
        .iter()
        .map(|t| (t.name.to_ascii_lowercase(), t))
        .collect();

    let selected = select_tables(prompt, schema);
    let mut used_aliases: HashSet<String> = HashSet::new();
    let mut planned: Vec<PlannedTable> = Vec::new();
    for table in &selected {
        let alias = unique_alias(&table.name, &mut used_aliases);
        planned.push(PlannedTable {
            schema: table.schema.clone(),
            name: table.name.clone(),
            alias,
        });
    }

    let mut joins = Vec::new();
    for i in 1..planned.len() {
        let right = &planned[i];
        let Some(right_table) = by_name.get(&right.name.to_ascii_lowercase()) else {
            continue;
        };
        // Find the first already-placed table that this one joins to.
        for left in &planned[..i] {
            let Some(left_table) = by_name.get(&left.name.to_ascii_lowercase()) else {
                continue;
            };
            if let Some(predicates) = join_predicates(left, left_table, right, right_table) {
                joins.push(PlannedJoin {
                    table: right.clone(),
                    predicates,
                });
                break;
            }
        }
    }

    QueryPlan {
        tables: planned,
        joins,
    }
}

/// Build the model prompt: dialect, grounded schema context, a worked example,
/// and the question. (Under grammar-constrained decoding this guides intent; the
/// grammar guarantees the *shape*.)
pub fn build_prompt(
    user_prompt: &str,
    plan: &QueryPlan,
    schema: &GenSchema,
    dialect: &dyn SqlDialect,
) -> String {
    let mut out = String::new();
    out.push_str(
        "You write a single SQL SELECT statement that answers the question.\n\
         Use only the tables and columns listed. Output SQL only.\n\n",
    );

    let _ = dialect; // dialect-specific hints can be added here later
    out.push_str("Schema:\n");
    let context_tables = context_tables(plan, schema);
    for table in &context_tables {
        render_table_context(&mut out, table);
    }

    if !plan.joins.is_empty() {
        out.push_str("\nKnown joins:\n");
        for join in &plan.joins {
            for predicate in &join.predicates {
                let _ = writeln!(out, "  {} = {}", predicate.left, predicate.right);
            }
        }
    }

    out.push_str("\nExample:\nQuestion: how many orders are there?\nSQL: SELECT COUNT(*) FROM orders\n\n");
    let _ = write!(out, "Question: {}\nSQL:", user_prompt.trim());
    out
}

/// Tables to include in the prompt context: the planned ones, or (when nothing
/// matched) the whole schema capped to a sane size so a tiny model isn't flooded.
fn context_tables<'a>(plan: &QueryPlan, schema: &'a GenSchema) -> Vec<&'a GenTable> {
    if plan.tables.is_empty() {
        const MAX_CONTEXT_TABLES: usize = 12;
        return schema.tables.iter().take(MAX_CONTEXT_TABLES).collect();
    }
    let by_name: HashMap<String, &GenTable> = schema
        .tables
        .iter()
        .map(|t| (t.name.to_ascii_lowercase(), t))
        .collect();
    plan.tables
        .iter()
        .filter_map(|t| by_name.get(&t.name.to_ascii_lowercase()).copied())
        .collect()
}

fn render_table_context(out: &mut String, table: &GenTable) {
    let _ = write!(out, "  {}(", table.name);
    for (i, column) in table.columns.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        let pk = if table
            .primary_key
            .iter()
            .any(|key| key.eq_ignore_ascii_case(&column.name))
        {
            " pk"
        } else {
            ""
        };
        let _ = write!(out, "{} {}{}", column.name, column.data_type, pk);
    }
    out.push_str(")\n");
    // Foreign-key hints so the model joins on real relationships.
    for fk in &table.foreign_keys {
        if let (Some(col), Some(ref_col)) = (fk.columns.first(), fk.ref_columns.first()) {
            let _ = writeln!(out, "    fk: {}.{} -> {}.{}", table.name, col, fk.ref_table, ref_col);
        }
    }
}

/// Pick tables whose name is mentioned in the prompt, in order of first mention.
fn select_tables<'a>(prompt: &str, schema: &'a GenSchema) -> Vec<&'a GenTable> {
    let tokens = tokenize_words(prompt);
    let mut hits: Vec<(usize, &GenTable)> = Vec::new();
    for table in &schema.tables {
        if let Some(pos) = first_mention(&tokens, &table.name) {
            hits.push((pos, table));
        }
    }
    hits.sort_by_key(|(pos, _)| *pos);
    hits.into_iter().map(|(_, t)| t).collect()
}

/// The earliest token index that names `table`, allowing a loose singular/plural
/// match (`customer` ~ `customers`).
fn first_mention(tokens: &[String], table: &str) -> Option<usize> {
    let name = table.to_ascii_lowercase();
    tokens.iter().position(|tok| word_matches(tok, &name))
}

fn word_matches(token: &str, name: &str) -> bool {
    if token == name {
        return true;
    }
    let singular = |s: &str| s.strip_suffix('s').map(str::to_string);
    if singular(token).as_deref() == Some(name) {
        return true;
    }
    if singular(name).as_deref() == Some(token) {
        return true;
    }
    false
}

fn tokenize_words(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase())
        .collect()
}

/// A foreign key in either direction yields the join predicates `left.col = right.col`.
fn join_predicates(
    left: &PlannedTable,
    left_table: &GenTable,
    right: &PlannedTable,
    right_table: &GenTable,
) -> Option<Vec<JoinPredicate>> {
    // right -> left
    for fk in &right_table.foreign_keys {
        if fk.ref_table.eq_ignore_ascii_case(&left.name) {
            return Some(pairs(right, &fk.columns, left, &fk.ref_columns));
        }
    }
    // left -> right
    for fk in &left_table.foreign_keys {
        if fk.ref_table.eq_ignore_ascii_case(&right.name) {
            return Some(pairs(left, &fk.columns, right, &fk.ref_columns));
        }
    }
    None
}

fn pairs(a: &PlannedTable, a_cols: &[String], b: &PlannedTable, b_cols: &[String]) -> Vec<JoinPredicate> {
    a_cols
        .iter()
        .zip(b_cols.iter())
        .map(|(ac, bc)| JoinPredicate {
            left: format!("{}.{}", a.alias, ac),
            right: format!("{}.{}", b.alias, bc),
        })
        .collect()
}

/// A short, unique alias: initials for multi-word names, else a growing prefix.
fn unique_alias(name: &str, used: &mut HashSet<String>) -> String {
    let lower = name.to_ascii_lowercase();
    let parts: Vec<&str> = lower.split('_').filter(|s| !s.is_empty()).collect();
    let mut seeds: Vec<String> = Vec::new();
    if parts.len() > 1 {
        seeds.push(parts.iter().filter_map(|p| p.chars().next()).collect());
    }
    if let Some(first) = lower.get(0..1) {
        seeds.push(first.to_string());
    }
    if let Some(two) = lower.get(0..2) {
        seeds.push(two.to_string());
    }
    seeds.push(lower.clone());

    for seed in seeds {
        if !seed.is_empty() && used.insert(seed.clone()) {
            return seed;
        }
    }
    let mut n = 2;
    loop {
        let candidate = format!("{}{}", lower.get(0..1).unwrap_or("t"), n);
        if used.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{GenColumn, GenForeignKey, GenTable};

    fn shop_schema() -> GenSchema {
        let customers = GenTable::new("customers")
            .with_columns(vec![GenColumn::new("id", "int"), GenColumn::new("name", "text")]);
        let mut orders = GenTable::new("orders").with_columns(vec![
            GenColumn::new("id", "int"),
            GenColumn::new("customer_id", "int"),
            GenColumn::new("total", "numeric"),
        ]);
        orders.foreign_keys.push(GenForeignKey {
            columns: vec!["customer_id".into()],
            ref_schema: None,
            ref_table: "customers".into(),
            ref_columns: vec!["id".into()],
        });
        GenSchema::new(vec![customers, orders])
    }

    #[test]
    fn selects_mentioned_tables_in_order() {
        let plan = plan("show orders joined to each customer", &shop_schema());
        let names: Vec<&str> = plan.tables.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["orders", "customers"]);
    }

    #[test]
    fn infers_join_from_foreign_key() {
        let plan = plan("orders and customers", &shop_schema());
        assert_eq!(plan.joins.len(), 1);
        let predicate = &plan.joins[0].predicates[0];
        // orders.customer_id = customers.id, with generated aliases.
        assert!(predicate.left.ends_with(".customer_id"));
        assert!(predicate.right.ends_with(".id"));
    }

    #[test]
    fn relevant_tables_include_planned_and_fk_neighbors() {
        let schema = shop_schema();
        let plan = plan("orders", &schema);
        let relevant = relevant_tables(&plan, &schema);
        // `orders` was named; `customers` is pulled in as its FK neighbor.
        assert!(relevant.iter().any(|t| t == "orders"));
        assert!(relevant.iter().any(|t| t == "customers"));
    }

    #[test]
    fn relevant_tables_empty_when_nothing_matched() {
        let schema = shop_schema();
        let plan = plan("how is the weather", &schema);
        assert!(relevant_tables(&plan, &schema).is_empty());
    }

    #[test]
    fn aliases_are_unique() {
        let mut used = HashSet::new();
        let a = unique_alias("orders", &mut used);
        let b = unique_alias("orders", &mut used);
        assert_ne!(a, b);
    }

    #[test]
    fn prompt_includes_schema_and_question() {
        let schema = shop_schema();
        let p = plan("total revenue by customer", &schema);
        let prompt = build_prompt(
            "total revenue by customer",
            &p,
            &schema,
            &irodori_sql::dialect::PostgresDialect,
        );
        assert!(prompt.contains("customers("));
        assert!(prompt.contains("Question: total revenue by customer"));
    }
}
