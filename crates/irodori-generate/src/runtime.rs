//! GEN-014 — the model abstraction the orchestrator decodes against.
//!
//! A [`GrammarModel`] turns a prompt + GBNF grammar into text. The embedded
//! llama.cpp implementation (Phase 3, behind the `llama` feature) is one impl;
//! [`EchoModel`] is a deterministic stand-in that lets the whole
//! project → plan → verify pipeline be tested without a model.

use irodori_error::Result;

/// Decoder knobs. Generation defaults to greedy (`temperature == 0`) so output is
/// deterministic and the grammar does the heavy lifting.
#[derive(Debug, Clone)]
pub struct DecodeOptions {
    pub max_tokens: u32,
    pub temperature: f32,
    pub seed: Option<u64>,
    /// Total generation attempts. On a validation failure the verify error is fed
    /// back into the prompt and the model tries again, up to this many times.
    pub max_attempts: u32,
}

impl Default for DecodeOptions {
    fn default() -> Self {
        Self {
            max_tokens: 256,
            temperature: 0.0,
            seed: None,
            max_attempts: 2,
        }
    }
}

/// Raw model output and token accounting.
#[derive(Debug, Clone)]
pub struct ModelOutput {
    pub text: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
}

/// Identifying metadata for a model (surfaced to the UI).
#[derive(Debug, Clone)]
pub struct ModelDescription {
    pub name: String,
}

/// A model that decodes constrained by a GBNF grammar.
pub trait GrammarModel: Send + Sync {
    fn complete(&self, prompt: &str, gbnf: &str, options: &DecodeOptions) -> Result<ModelOutput>;
    fn describe(&self) -> ModelDescription;
}

/// A test/fallback model that returns a fixed string and ignores the grammar.
pub struct EchoModel {
    pub sql: String,
    pub name: String,
}

impl EchoModel {
    pub fn new(sql: impl Into<String>) -> Self {
        Self {
            sql: sql.into(),
            name: "echo".to_string(),
        }
    }
}

impl GrammarModel for EchoModel {
    fn complete(&self, _prompt: &str, _gbnf: &str, _options: &DecodeOptions) -> Result<ModelOutput> {
        Ok(ModelOutput {
            text: self.sql.clone(),
            tokens_in: 0,
            tokens_out: 0,
        })
    }

    fn describe(&self) -> ModelDescription {
        ModelDescription {
            name: self.name.clone(),
        }
    }
}
