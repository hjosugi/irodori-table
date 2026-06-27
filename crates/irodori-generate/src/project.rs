//! GEN-011 — project a [`GenSchema`] into the two artifacts generation needs:
//! a schema-specialized GBNF grammar (so a constrained decoder can only emit
//! real identifiers) and a [`SchemaIndex`] (so the result can be validated).

use crate::schema::{GenSchema, GenTable, SchemaIndex};
use irodori_sql::grammar::{GrammarSchema, GrammarTable};
use std::collections::HashSet;

fn grammar_table(table: &GenTable) -> GrammarTable {
    GrammarTable {
        name: table.name.clone(),
        columns: table.columns.iter().map(|c| c.name.clone()).collect(),
    }
}

/// Build the GBNF schema (closed table/column terminals) from a [`GenSchema`].
pub fn grammar_schema(schema: &GenSchema) -> GrammarSchema {
    GrammarSchema::new(schema.tables.iter().map(grammar_table).collect())
}

/// Build a GBNF schema restricted to `table_names` (case-insensitive), preserving
/// schema order. Used to project the grammar down to just the tables a query
/// needs — a smaller grammar decodes faster and can't emit irrelevant relations.
pub fn grammar_schema_scoped(schema: &GenSchema, table_names: &[String]) -> GrammarSchema {
    let wanted: HashSet<String> = table_names
        .iter()
        .map(|n| n.to_ascii_lowercase())
        .collect();
    GrammarSchema::new(
        schema
            .tables
            .iter()
            .filter(|t| wanted.contains(&t.name.to_ascii_lowercase()))
            .map(grammar_table)
            .collect(),
    )
}

/// Build the validation index from a [`GenSchema`].
pub fn schema_index(schema: &GenSchema) -> SchemaIndex {
    SchemaIndex::build(schema)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{GenColumn, GenTable};
    use irodori_sql::grammar::select_grammar;

    fn two_table_schema() -> GenSchema {
        GenSchema::new(vec![
            GenTable::new("customers")
                .with_columns(vec![GenColumn::new("id", "int"), GenColumn::new("name", "text")]),
            GenTable::new("orders")
                .with_columns(vec![GenColumn::new("id", "int"), GenColumn::new("total", "numeric")]),
        ])
    }

    #[test]
    fn projects_schema_into_closed_grammar_terminals() {
        let gbnf = select_grammar(Some(&grammar_schema(&two_table_schema())));
        assert!(gbnf.contains(r#"table-name ::= "customers" | "orders""#));
        assert!(gbnf.contains(r#"column-name ::= "id" | "name" | "total""#));
    }

    #[test]
    fn scoped_grammar_excludes_unscoped_tables() {
        let gbnf = select_grammar(Some(&grammar_schema_scoped(
            &two_table_schema(),
            &["orders".to_string()],
        )));
        assert!(gbnf.contains(r#"table-name ::= "orders""#));
        assert!(!gbnf.contains("customers"));
        // `name` is a customers-only column and must be gone; `total` remains.
        assert!(gbnf.contains("total"));
        assert!(!gbnf.contains(r#""name""#));
    }
}
