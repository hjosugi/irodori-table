//! GEN-013 — parse generated SQL and prove it only references real schema
//! objects, then re-render it canonically.
//!
//! Grammar-constrained decoding already guarantees syntax and that identifiers
//! are *some* real name; this step adds the semantic guarantee the grammar can't
//! cheaply express: a column actually belongs to a table in scope. Anything that
//! fails is rejected with a typed error rather than handed back as plausible-but-
//! wrong SQL.

use crate::schema::{GenTable, SchemaIndex};
use irodori_sql::ast::{ColumnRef, Expr, FuncArg, SelectItem, SelectStatement, TableExpr};
use irodori_sql::dialect::SqlDialect;
use irodori_sql::parser::parse_select;
use irodori_error::{IrodoriError, IrodoriErrorKind, Result};
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
            if tables.iter().any(|t| t.has_column(&column.name)) {
                return Ok(());
            }
            // With an opaque relation in scope the column may legitimately come
            // from it, so we can't prove it wrong.
            if scope.has_opaque || tables.is_empty() {
                return Ok(());
            }
            Err(IrodoriError::new(
                IrodoriErrorKind::Validation,
                format!("generated SQL references unknown column `{}`", column.name),
            ))
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
    match expr {
        Expr::Column(column) => out.push(column),
        Expr::Literal(_) | Expr::Param(_) => {}
        Expr::Unary { expr, .. } => collect_columns(expr, out),
        Expr::Binary { left, right, .. } => {
            collect_columns(left, out);
            collect_columns(right, out);
        }
        Expr::Function { args, .. } => {
            for arg in args {
                if let FuncArg::Expr(e) = arg {
                    collect_columns(e, out);
                }
            }
        }
        Expr::Case {
            operand,
            whens,
            else_expr,
        } => {
            if let Some(operand) = operand {
                collect_columns(operand, out);
            }
            for (when, then) in whens {
                collect_columns(when, out);
                collect_columns(then, out);
            }
            if let Some(else_expr) = else_expr {
                collect_columns(else_expr, out);
            }
        }
        Expr::InList { expr, list, .. } => {
            collect_columns(expr, out);
            for item in list {
                collect_columns(item, out);
            }
        }
        Expr::Between {
            expr, low, high, ..
        } => {
            collect_columns(expr, out);
            collect_columns(low, out);
            collect_columns(high, out);
        }
        Expr::IsNull { expr, .. } => collect_columns(expr, out),
        Expr::Paren(inner) => collect_columns(inner, out),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{GenColumn, GenSchema, GenTable};
    use irodori_sql::dialect::PostgresDialect;

    fn index() -> SchemaIndex {
        SchemaIndex::build(&GenSchema::new(vec![
            GenTable::new("customers")
                .with_columns(vec![GenColumn::new("id", "int"), GenColumn::new("name", "text")]),
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
}
