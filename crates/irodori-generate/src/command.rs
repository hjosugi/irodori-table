//! GEN-016 — run an external command/CLI as the model.
//!
//! This is how subscription agents and CLIs plug in — Claude Code, Codex,
//! GitHub Copilot CLI, or any program that takes a prompt and prints SQL. It
//! can't constrain decoding with the GBNF grammar, so it ignores it and relies
//! entirely on the [`verify`](crate::verify) gate: the output is parsed and
//! schema-validated, so even an unconstrained agent can't yield invalid or
//! hallucinated SQL — it's just rejected. No extra dependencies (std only).

use std::io::Write;
use std::process::{Command, Stdio};

use irodori_error::{IrodoriError, IrodoriErrorKind, Result};

use crate::runtime::{DecodeOptions, GrammarModel, ModelDescription, ModelOutput};

/// `{prompt}` placeholder substituted into args; if absent, the prompt is piped
/// to the program's stdin.
const PROMPT_PLACEHOLDER: &str = "{prompt}";

#[derive(Debug, Clone)]
pub struct CommandConfig {
    pub program: String,
    pub args: Vec<String>,
    pub label: String,
}

impl CommandConfig {
    pub fn new(program: impl Into<String>, args: Vec<String>, label: impl Into<String>) -> Self {
        Self {
            program: program.into(),
            args,
            label: label.into(),
        }
    }

    /// Best-effort preset for the Claude Code CLI (`claude -p`, prompt on stdin).
    /// Adjust flags to your installed CLI as needed.
    pub fn claude_code() -> Self {
        Self::new("claude", vec!["-p".into()], "claude-code")
    }

    /// Best-effort preset for the Codex CLI (`codex exec`, prompt on stdin).
    pub fn codex() -> Self {
        Self::new("codex", vec!["exec".into()], "codex")
    }
}

/// A model backed by an external command.
pub struct CommandModel {
    config: CommandConfig,
}

impl CommandModel {
    pub fn new(config: CommandConfig) -> Self {
        Self { config }
    }
}

impl GrammarModel for CommandModel {
    fn complete(&self, prompt: &str, _gbnf: &str, _options: &DecodeOptions) -> Result<ModelOutput> {
        let uses_placeholder = self
            .config
            .args
            .iter()
            .any(|a| a.contains(PROMPT_PLACEHOLDER));

        let mut command = Command::new(&self.config.program);
        for arg in &self.config.args {
            command.arg(arg.replace(PROMPT_PLACEHOLDER, prompt));
        }
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if !uses_placeholder {
            command.stdin(Stdio::piped());
        }

        let mut child = command.spawn().map_err(|e| {
            IrodoriError::new(
                IrodoriErrorKind::Unsupported,
                format!("failed to start `{}`: {e}", self.config.program),
            )
        })?;

        if !uses_placeholder {
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(prompt.as_bytes()).map_err(|e| {
                    IrodoriError::new(IrodoriErrorKind::Internal, format!("write stdin: {e}"))
                })?;
            }
        }

        let output = child.wait_with_output().map_err(|e| {
            IrodoriError::new(IrodoriErrorKind::Internal, format!("command failed: {e}"))
        })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(IrodoriError::new(
                IrodoriErrorKind::Internal,
                format!("`{}` exited with error: {}", self.config.program, stderr.trim()),
            ));
        }

        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        Ok(ModelOutput {
            text,
            tokens_in: 0,
            tokens_out: 0,
        })
    }

    fn describe(&self) -> ModelDescription {
        ModelDescription {
            name: self.config.label.clone(),
        }
    }
}
