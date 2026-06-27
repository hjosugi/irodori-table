//! Local, correct-by-construction SQL generation for Irodori Table.
//!
//! A lightweight model produces SQL whose every token is forced through a
//! schema-specialized SQL grammar, then the result is parsed back and validated
//! against the schema. The model can be tiny because the grammar — not the
//! model — guarantees the SQL is valid:
//!
//! 1. [`project`] turns a [`GenSchema`] into a GBNF grammar (closed table/column
//!    terminals) and a [`SchemaIndex`].
//! 2. [`plan`] resolves the mentioned tables and foreign-key joins deterministically
//!    and assembles a compact prompt (事前の調整).
//! 3. A [`GrammarModel`] decodes constrained by the grammar.
//! 4. [`verify`] parses the output and proves it references only real objects,
//!    then re-renders it canonically.
//!
//! The deterministic completion in `irodori-completion` remains the always-on
//! default; this is the opt-in generation path.

pub mod command;
pub mod plan;
pub mod project;
pub mod runtime;
pub mod schema;
pub mod verify;

#[cfg(feature = "llama")]
pub mod llama;

#[cfg(feature = "http")]
pub mod http;

pub use command::{CommandConfig, CommandModel};
pub use plan::QueryPlan;
pub use runtime::{DecodeOptions, EchoModel, GrammarModel, ModelDescription, ModelOutput};
pub use schema::{GenColumn, GenForeignKey, GenSchema, GenTable, RelationKind, SchemaIndex};
pub use verify::Verified;

#[cfg(feature = "http")]
pub use http::{HttpConfig, OllamaModel, OpenAiCompatModel};

use irodori_error::Result;
use irodori_sql::dialect::SqlDialect;
use irodori_sql::grammar::select_grammar;

/// Everything a single generation needs.
pub struct GenerateRequest {
    pub prompt: String,
    pub schema: GenSchema,
    pub options: DecodeOptions,
}

impl GenerateRequest {
    pub fn new(prompt: impl Into<String>, schema: GenSchema) -> Self {
        Self {
            prompt: prompt.into(),
            schema,
            options: DecodeOptions::default(),
        }
    }
}

/// The generated SQL plus provenance.
#[derive(Debug, Clone)]
pub struct GenerateOutcome {
    pub sql: String,
    pub model: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    /// True when validation canonicalized the model's output.
    pub repaired: bool,
    /// Tables the planner selected from the prompt (for diagnostics).
    pub tables: Vec<String>,
}

/// Run the full pipeline: project → plan → constrained decode → verify.
pub fn generate(
    model: &dyn GrammarModel,
    request: &GenerateRequest,
    dialect: &dyn SqlDialect,
) -> Result<GenerateOutcome> {
    let index = project::schema_index(&request.schema);
    let plan = plan::plan(&request.prompt, &request.schema);

    // Scope the grammar to the planned tables (+ FK neighbors) when the schema is
    // large enough that the full grammar would be costly. Small schemas keep the
    // full grammar for maximum recall. A smaller grammar decodes faster, lets a
    // tinier model suffice, and can't emit irrelevant relations.
    const GRAMMAR_SCOPE_THRESHOLD: usize = 16;
    let relevant = plan::relevant_tables(&plan, &request.schema);
    let grammar_schema = if relevant.is_empty() || request.schema.tables.len() <= GRAMMAR_SCOPE_THRESHOLD
    {
        project::grammar_schema(&request.schema)
    } else {
        project::grammar_schema_scoped(&request.schema, &relevant)
    };
    let gbnf = select_grammar(Some(&grammar_schema));

    let prompt = plan::build_prompt(&request.prompt, &plan, &request.schema, dialect);

    let output = model.complete(&prompt, &gbnf, &request.options)?;
    let sql = sanitize_output(&output.text);
    let verified = verify::verify(&sql, &index, dialect)?;

    Ok(GenerateOutcome {
        sql: verified.sql,
        model: model.describe().name,
        tokens_in: output.tokens_in,
        tokens_out: output.tokens_out,
        repaired: verified.repaired,
        tables: plan.tables.into_iter().map(|t| t.name).collect(),
    })
}

/// Strip Markdown fences / surrounding prose a non-constrained model might add.
/// For grammar-constrained output (root = a single `SELECT`) this is a no-op.
fn sanitize_output(text: &str) -> String {
    let mut s = text.trim();
    if let Some(rest) = s.strip_prefix("```") {
        // Drop an optional language tag on the opening fence, then the closer.
        let rest = rest.strip_prefix("sql").unwrap_or(rest);
        let rest = rest.trim_start_matches(['\n', '\r']);
        s = rest.split("```").next().unwrap_or(rest).trim();
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{GenColumn, GenForeignKey, GenTable};
    use irodori_sql::dialect::PostgresDialect;

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
    fn end_to_end_with_echo_model_canonicalizes_valid_sql() {
        let model = EchoModel::new("select id, total from orders where total > 100");
        let req = GenerateRequest::new("big orders", shop_schema());
        let outcome = generate(&model, &req, &PostgresDialect).unwrap();
        assert_eq!(outcome.sql, "SELECT id, total FROM orders WHERE total > 100");
        assert!(outcome.repaired); // lowercase -> canonical uppercase keywords
        assert_eq!(outcome.model, "echo");
    }

    #[test]
    fn end_to_end_rejects_hallucinated_column() {
        let model = EchoModel::new("SELECT nonexistent FROM orders");
        let req = GenerateRequest::new("anything", shop_schema());
        assert!(generate(&model, &req, &PostgresDialect).is_err());
    }

    #[test]
    fn sanitizes_markdown_fenced_output() {
        let model = EchoModel::new("```sql\nSELECT id FROM orders\n```");
        let req = GenerateRequest::new("ids", shop_schema());
        let outcome = generate(&model, &req, &PostgresDialect).unwrap();
        assert_eq!(outcome.sql, "SELECT id FROM orders");
    }
}
