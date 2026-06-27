//! GEN-011 — project a [`GenSchema`] into the two artifacts generation needs:
//! a schema-specialized GBNF grammar (so a constrained decoder can only emit
//! real identifiers) and a [`SchemaIndex`] (so the result can be validated).

use crate::schema::{GenSchema, SchemaIndex};
use irodori_sql::grammar::{GrammarSchema, GrammarTable};

/// Build the GBNF schema (closed table/column terminals) from a [`GenSchema`].
pub fn grammar_schema(schema: &GenSchema) -> GrammarSchema {
    GrammarSchema::new(
        schema
            .tables
            .iter()
            .map(|t| GrammarTable {
                name: t.name.clone(),
                columns: t.columns.iter().map(|c| c.name.clone()).collect(),
            })
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

    #[test]
    fn projects_schema_into_closed_grammar_terminals() {
        let schema = GenSchema::new(vec![
            GenTable::new("customers")
                .with_columns(vec![GenColumn::new("id", "int"), GenColumn::new("name", "text")]),
            GenTable::new("orders")
                .with_columns(vec![GenColumn::new("id", "int"), GenColumn::new("total", "numeric")]),
        ]);
        let gbnf = select_grammar(Some(&grammar_schema(&schema)));
        assert!(gbnf.contains(r#"table-name ::= "customers" | "orders""#));
        assert!(gbnf.contains(r#"column-name ::= "id" | "name" | "total""#));
    }
}
