//! GEN-013 — parse generated SQL and prove it only references real schema
//! objects, then re-render it canonically.
//!
//! Grammar-constrained decoding already guarantees syntax and that identifiers
//! are *some* real name; this step adds the semantic guarantee the grammar can't
//! cheaply express: a column actually belongs to a table in scope. Anything that
//! fails is rejected with a typed error rather than handed back as plausible-but-
//! wrong SQL.

use crate::schema::{GenTable, SchemaIndex};
use irodori_error::{IrodoriError, IrodoriErrorKind, Result};
use irodori_sql::ast::{ColumnRef, Expr, FuncArg, SelectItem, SelectStatement, TableExpr};
use irodori_sql::dialect::SqlDialect;
use irodori_sql::parser::parse_select;
use std::collections::HashSet;

/// A validated statement plus its canonical rendering.
#[derive(Debug, Clone)]
pub struct Verified {
    pub statement: SelectStatement,
    pub sql: String,
    /// True when canonicalization changed the text (quoting/spacing/casing).
    pub repaired: bool,
}

/// Parse, validate against `index`, and canonicalize `sql`.
pub fn verify(sql: &str, index: &SchemaIndex, dialect: &dyn SqlDialect) -> Result<Verified> {
    let statement = parse_select(sql, dialect).map_err(|e| {
        IrodoriError::new(
            IrodoriErrorKind::Query,
            format!("generated SQL did not parse: {e}"),
        )
    })?;

    verify_statement(&statement, index)?;

    let rendered = statement.render(dialect);
    let repaired = rendered != sql.trim();
    Ok(Verified {
        statement,
        sql: rendered,
        repaired,
    })
}

/// A relation in scope: either a known table or an opaque one (a CTE), keyed by
/// the names it can be qualified with (alias and/or object name).
struct Scope<'a> {
    relations: Vec<(String, Option<&'a GenTable>)>,
    has_opaque: bool,
    /// Projection aliases, which may be referenced unqualified in `ORDER BY` /
    /// `GROUP BY` even though they aren't columns of any table.
    output_aliases: HashSet<String>,
}

impl<'a> Scope<'a> {
    fn resolve(&self, qualifier: &str) -> Option<Option<&'a GenTable>> {
        let key = qualifier.to_ascii_lowercase();
        self.relations
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, t)| *t)
    }

    /// Distinct known tables in scope (deduplicated by name).
    fn known_tables(&self) -> Vec<&'a GenTable> {
        let mut seen = HashSet::new();
        let mut tables = Vec::new();
        for (_, table) in &self.relations {
            if let Some(table) = table {
                if seen.insert(table.name.to_ascii_lowercase()) {
                    tables.push(*table);
                }
            }
        }
        tables
    }
}

fn verify_statement(stmt: &SelectStatement, index: &SchemaIndex) -> Result<()> {
    // CTE bodies are their own SELECTs over the base schema.
    for cte in &stmt.with {
        verify_statement(&cte.query, index)?;
    }

    let cte_names: HashSet<String> = stmt
        .with
        .iter()
        .map(|c| c.name.to_ascii_lowercase())
        .collect();

    let scope = build_scope(stmt, index, &cte_names)?;

    for column in collect_statement_columns(stmt) {
        validate_column(column, &scope)?;
    }
    validate_group_by(stmt)?;
    Ok(())
}

const AGGREGATES: &[&str] = &[
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "total",
    "group_concat",
    "string_agg",
    "array_agg",
];

fn is_aggregate(name: &str) -> bool {
    AGGREGATES.iter().any(|agg| agg.eq_ignore_ascii_case(name))
}

fn contains_aggregate(expr: &Expr) -> bool {
    match expr {
        Expr::Function { name, args, .. } => {
            is_aggregate(name)
                || args
                    .iter()
                    .any(|arg| matches!(arg, FuncArg::Expr(e) if contains_aggregate(e)))
        }
        Expr::Unary { expr, .. } | Expr::IsNull { expr, .. } | Expr::Paren(expr) => {
            contains_aggregate(expr)
        }
        Expr::Binary { left, right, .. } => contains_aggregate(left) || contains_aggregate(right),
        Expr::Case {
            operand,
            whens,
            else_expr,
        } => {
            operand.as_deref().is_some_and(contains_aggregate)
                || whens
                    .iter()
                    .any(|(w, t)| contains_aggregate(w) || contains_aggregate(t))
                || else_expr.as_deref().is_some_and(contains_aggregate)
        }
        Expr::InList { expr, list, .. } => {
            contains_aggregate(expr) || list.iter().any(contains_aggregate)
        }
        Expr::Between {
            expr, low, high, ..
        } => contains_aggregate(expr) || contains_aggregate(low) || contains_aggregate(high),
        _ => false,
    }
}

/// Columns referenced outside any aggregate call (the ones GROUP BY must cover).
fn collect_non_aggregated_columns<'a>(expr: &'a Expr, out: &mut Vec<&'a ColumnRef>) {
    walk_columns(expr, true, out);
}

/// Walk an expression collecting column references. With `skip_aggregates`,
/// columns inside aggregate calls are ignored (used by the GROUP BY check).
fn walk_columns<'a>(expr: &'a Expr, skip_aggregates: bool, out: &mut Vec<&'a ColumnRef>) {
    match expr {
        Expr::Column(column) => out.push(column),
        Expr::Literal(_) | Expr::Param(_) => {}
        Expr::Unary { expr, .. } | Expr::IsNull { expr, .. } | Expr::Paren(expr) => {
            walk_columns(expr, skip_aggregates, out)
        }
        Expr::Binary { left, right, .. } => {
            walk_columns(left, skip_aggregates, out);
            walk_columns(right, skip_aggregates, out);
        }
        Expr::Function { name, args, .. } => {
            if skip_aggregates && is_aggregate(name) {
                return;
            }
            for arg in args {
                if let FuncArg::Expr(e) = arg {
                    walk_columns(e, skip_aggregates, out);
                }
            }
        }
        Expr::Case {
            operand,
            whens,
            else_expr,
        } => {
            if let Some(operand) = operand {
                walk_columns(operand, skip_aggregates, out);
            }
            for (when, then) in whens {
                walk_columns(when, skip_aggregates, out);
                walk_columns(then, skip_aggregates, out);
            }
            if let Some(else_expr) = else_expr {
                walk_columns(else_expr, skip_aggregates, out);
            }
        }
        Expr::InList { expr, list, .. } => {
            walk_columns(expr, skip_aggregates, out);
            for item in list {
                walk_columns(item, skip_aggregates, out);
            }
        }
        Expr::Between {
            expr, low, high, ..
        } => {
            walk_columns(expr, skip_aggregates, out);
            walk_columns(low, skip_aggregates, out);
            walk_columns(high, skip_aggregates, out);
        }
    }
}

/// When a query aggregates, every non-aggregated projection column must appear in
/// GROUP BY (the classic LLM mistake). Lenient: matches by column name so
/// `GROUP BY upper(name)` still covers a `name` projection.
fn validate_group_by(stmt: &SelectStatement) -> Result<()> {
    let has_aggregate = stmt
        .projection
        .iter()
        .any(|item| matches!(item, SelectItem::Expr { expr, .. } if contains_aggregate(expr)));
    if !has_aggregate {
        return Ok(());
    }

    let mut grouped: HashSet<String> = HashSet::new();
    for expr in &stmt.group_by {
        let mut cols = Vec::new();
        collect_columns(expr, &mut cols);
        for col in cols {
            grouped.insert(col.name.to_ascii_lowercase());
        }
    }

    let mut ungrouped = Vec::new();
    for item in &stmt.projection {
        if let SelectItem::Expr { expr, .. } = item {
            collect_non_aggregated_columns(expr, &mut ungrouped);
        }
    }

    for col in ungrouped {
        if !grouped.contains(&col.name.to_ascii_lowercase()) {
            return Err(IrodoriError::new(
                IrodoriErrorKind::Validation,
                format!(
                    "`{}` must appear in GROUP BY or be inside an aggregate",
                    col.name
                ),
            ));
        }
    }
    Ok(())
}

fn build_scope<'a>(
    stmt: &SelectStatement,
    index: &'a SchemaIndex,
    cte_names: &HashSet<String>,
) -> Result<Scope<'a>> {
    let mut relations: Vec<(String, Option<&GenTable>)> = Vec::new();
    let mut has_opaque = false;

    let mut add = |table_expr: &TableExpr| -> Result<()> {
        let object = table_expr.name.object();
        let object_lower = object.to_ascii_lowercase();

        let resolved: Option<&GenTable> = if cte_names.contains(&object_lower) {
            has_opaque = true;
            None
        } else {
            match index.table(object) {
                Some(table) => Some(table),
                None => {
                    return Err(IrodoriError::new(
                        IrodoriErrorKind::Validation,
                        format!("generated SQL references unknown table `{object}`"),
                    ))
                }
            }
        };

        let mut keys: Vec<String> = vec![object_lower];
        if let Some(alias) = &table_expr.alias {
            keys.push(alias.to_ascii_lowercase());
        }
        for key in keys {
            if !relations.iter().any(|(k, _)| *k == key) {
                relations.push((key, resolved));
            }
        }
        Ok(())
    };

    if let Some(from) = &stmt.from {
        add(from)?;
    }
    for join in &stmt.joins {
        add(&join.table)?;
    }

    let output_aliases = stmt
        .projection
        .iter()
        .filter_map(|item| match item {
            SelectItem::Expr {
                alias: Some(alias), ..
            } => Some(alias.to_ascii_lowercase()),
            _ => None,
        })
        .collect();

    Ok(Scope {
        relations,
        has_opaque,
        output_aliases,
    })
}

fn validate_column(column: &ColumnRef, scope: &Scope<'_>) -> Result<()> {
    match &column.qualifier {
        Some(qualifier) => match scope.resolve(qualifier) {
            // Known table: the column must exist on it.
            Some(Some(table)) => {
                if table.has_column(&column.name) {
                    Ok(())
                } else {
                    Err(IrodoriError::new(
                        IrodoriErrorKind::Validation,
                        format!(
                            "generated SQL references unknown column `{}.{}`",
                            qualifier, column.name
                        ),
                    ))
                }
            }
            // Opaque relation (CTE): can't check columns, accept.
            Some(None) => Ok(()),
            None => Err(IrodoriError::new(
                IrodoriErrorKind::Validation,
                format!("generated SQL uses unknown table qualifier `{qualifier}`"),
            )),
        },
        None => {
            // A projection alias referenced in ORDER BY / GROUP BY is valid.
            if scope
                .output_aliases
                .contains(&column.name.to_ascii_lowercase())
            {
                return Ok(());
            }
            let tables = scope.known_tables();
            let matching = tables.iter().filter(|t| t.has_column(&column.name)).count();
            if matching == 1 {
                return Ok(());
            }
            // With an opaque relation (CTE) in scope, or no known tables, we can't
            // prove the column wrong.
            if scope.has_opaque || tables.is_empty() {
                return Ok(());
            }
            if matching == 0 {
                Err(IrodoriError::new(
                    IrodoriErrorKind::Validation,
                    format!("generated SQL references unknown column `{}`", column.name),
                ))
            } else {
                Err(IrodoriError::new(
                    IrodoriErrorKind::Validation,
                    format!(
                        "column `{}` is ambiguous; qualify it with a table alias",
                        column.name
                    ),
                ))
            }
        }
    }
}

fn collect_statement_columns(stmt: &SelectStatement) -> Vec<&ColumnRef> {
    let mut columns = Vec::new();
    for item in &stmt.projection {
        if let SelectItem::Expr { expr, .. } = item {
            collect_columns(expr, &mut columns);
        }
    }
    for join in &stmt.joins {
        if let Some(on) = &join.on {
            collect_columns(on, &mut columns);
        }
    }
    if let Some(filter) = &stmt.filter {
        collect_columns(filter, &mut columns);
    }
    for expr in &stmt.group_by {
        collect_columns(expr, &mut columns);
    }
    if let Some(having) = &stmt.having {
        collect_columns(having, &mut columns);
    }
    for item in &stmt.order_by {
        collect_columns(&item.expr, &mut columns);
    }
    columns
}

fn collect_columns<'a>(expr: &'a Expr, out: &mut Vec<&'a ColumnRef>) {
    walk_columns(expr, false, out);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{GenColumn, GenSchema, GenTable};
    use irodori_sql::dialect::PostgresDialect;

    fn index() -> SchemaIndex {
        SchemaIndex::build(&GenSchema::new(vec![
            GenTable::new("customers").with_columns(vec![
                GenColumn::new("id", "int"),
                GenColumn::new("name", "text"),
            ]),
            GenTable::new("orders").with_columns(vec![
                GenColumn::new("id", "int"),
                GenColumn::new("customer_id", "int"),
                GenColumn::new("total", "numeric"),
            ]),
        ]))
    }

    fn check(sql: &str) -> Result<Verified> {
        verify(sql, &index(), &PostgresDialect)
    }

    #[test]
    fn accepts_valid_query() {
        let v = check("SELECT id, total FROM orders WHERE total > 100").unwrap();
        assert!(v.sql.contains("FROM orders"));
    }

    #[test]
    fn accepts_valid_join_with_aliases() {
        check("SELECT c.name, o.total FROM orders o JOIN customers c ON o.customer_id = c.id")
            .unwrap();
    }

    #[test]
    fn rejects_unknown_table() {
        let err = check("SELECT * FROM widgets").unwrap_err();
        assert_eq!(err.kind, IrodoriErrorKind::Validation);
        assert!(err.message.contains("unknown table"));
    }

    #[test]
    fn rejects_unknown_column() {
        let err = check("SELECT bogus FROM orders").unwrap_err();
        assert!(err.message.contains("unknown column"));
    }

    #[test]
    fn rejects_unknown_qualified_column() {
        let err = check("SELECT o.nope FROM orders o").unwrap_err();
        assert!(err.message.contains("unknown column"));
    }

    #[test]
    fn rejects_unknown_qualifier() {
        let err = check("SELECT x.id FROM orders o").unwrap_err();
        assert!(err.message.contains("unknown table qualifier"));
    }

    #[test]
    fn allows_cte_columns_opaquely() {
        check("WITH recent (oid) AS (SELECT id FROM orders) SELECT oid FROM recent").unwrap();
    }

    #[test]
    fn rejects_unparseable_sql() {
        let err = check("SELCT * FROM orders").unwrap_err();
        assert_eq!(err.kind, IrodoriErrorKind::Query);
    }

    #[test]
    fn rejects_ambiguous_bare_column() {
        // both `orders` and `customers` have `id`.
        let err =
            check("SELECT id FROM orders o JOIN customers c ON o.customer_id = c.id").unwrap_err();
        assert!(err.message.contains("ambiguous"), "got: {}", err.message);
    }

    #[test]
    fn rejects_missing_group_by() {
        let err = check("SELECT name, count(*) FROM customers").unwrap_err();
        assert!(err.message.contains("GROUP BY"), "got: {}", err.message);
    }

    #[test]
    fn accepts_correct_group_by() {
        check("SELECT name, count(*) FROM customers GROUP BY name").unwrap();
    }
}
