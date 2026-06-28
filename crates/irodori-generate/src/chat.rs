//! GEN-018 — multi-turn chat abstraction with token streaming.
//!
//! Where [`GrammarModel`](crate::runtime::GrammarModel) is single-shot,
//! grammar-constrained SQL completion, [`ChatModel`] is a free-form conversation:
//! a list of role-tagged messages in, an assistant reply out, with tokens
//! streamed as they arrive through an `on_token` callback. Every provider that
//! backs generation also backs chat:
//!
//! * the HTTP providers ([`OllamaModel`](crate::http::OllamaModel),
//!   [`OpenAiCompatModel`](crate::http::OpenAiCompatModel) — and through the
//!   latter, OpenAI / Gemini / DeepSeek / any OpenAI-compatible endpoint) stream
//!   natively;
//! * the [`CommandModel`](crate::command::CommandModel) (Claude Code, Codex,
//!   Copilot, any CLI) streams its stdout line by line;
//! * the embedded local model reuses its `complete` path through
//!   [`GrammarChatAdapter`] (one emission, no mid-token streaming).
//!
//! The callback is `&mut dyn FnMut(&str)` so the Tauri layer can forward each
//! chunk over a channel without this crate depending on Tauri.

use std::sync::Arc;

use irodori_error::Result;

use crate::runtime::{DecodeOptions, GrammarModel, ModelDescription, ModelOutput};

/// A permissive grammar: accept any free-form prose. The embedded local path
/// needs a grammar to decode against; HTTP/CLI providers ignore it.
pub const CHAT_PROSE_GBNF: &str = "root ::= char+\nchar ::= [^\\x00]";

/// Who authored a message in the conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

impl ChatRole {
    /// The wire name used by OpenAI-compatible / Ollama chat APIs.
    pub fn as_api_str(self) -> &'static str {
        match self {
            ChatRole::System => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
        }
    }

    /// A human label for flattened transcripts (local + CLI providers).
    pub fn as_label(self) -> &'static str {
        match self {
            ChatRole::System => "System",
            ChatRole::User => "User",
            ChatRole::Assistant => "Assistant",
        }
    }
}

/// One turn in the conversation.
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

impl ChatMessage {
    pub fn new(role: ChatRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self::new(ChatRole::System, content)
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::new(ChatRole::User, content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::new(ChatRole::Assistant, content)
    }
}

/// A model that holds a multi-turn conversation and streams its reply.
///
/// Implementations call `on_token` once per chunk as output arrives, then return
/// the full assembled [`ModelOutput`]. Blocking (mirrors [`GrammarModel`]); the
/// caller runs it off the async runtime.
pub trait ChatModel: Send + Sync {
    fn chat(
        &self,
        messages: &[ChatMessage],
        options: &DecodeOptions,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<ModelOutput>;

    fn describe(&self) -> ModelDescription;
}

/// Flatten a conversation into a single labelled prompt, ending with an
/// `Assistant:` cue. Used by providers that take one prompt string (the embedded
/// local model and, as a fallback, the CLI provider).
pub fn flatten_transcript(messages: &[ChatMessage]) -> String {
    let mut out = String::new();
    for message in messages {
        out.push_str(message.role.as_label());
        out.push_str(": ");
        out.push_str(message.content.trim());
        out.push_str("\n\n");
    }
    out.push_str("Assistant: ");
    out
}

/// Adapts any [`GrammarModel`] into a [`ChatModel`] by flattening the
/// conversation to a prompt and decoding once against the permissive prose
/// grammar. There is no mid-token streaming — the whole reply is emitted in a
/// single `on_token` call — but it lets the embedded local model join the chat
/// without a separate code path.
pub struct GrammarChatAdapter {
    model: Arc<dyn GrammarModel>,
}

impl GrammarChatAdapter {
    pub fn new(model: Arc<dyn GrammarModel>) -> Self {
        Self { model }
    }
}

impl ChatModel for GrammarChatAdapter {
    fn chat(
        &self,
        messages: &[ChatMessage],
        options: &DecodeOptions,
        on_token: &mut dyn FnMut(&str),
    ) -> Result<ModelOutput> {
        let prompt = flatten_transcript(messages);
        let output = self.model.complete(&prompt, CHAT_PROSE_GBNF, options)?;
        if !output.text.is_empty() {
            on_token(&output.text);
        }
        Ok(output)
    }

    fn describe(&self) -> ModelDescription {
        self.model.describe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::EchoModel;

    #[test]
    fn flatten_ends_with_assistant_cue() {
        let messages = vec![
            ChatMessage::system("be terse"),
            ChatMessage::user("hi"),
        ];
        let prompt = flatten_transcript(&messages);
        assert!(prompt.contains("System: be terse"));
        assert!(prompt.contains("User: hi"));
        assert!(prompt.trim_end().ends_with("Assistant:"));
    }

    #[test]
    fn adapter_emits_full_reply_once() {
        let adapter = GrammarChatAdapter::new(Arc::new(EchoModel::new("hello there")));
        let mut chunks = Vec::new();
        let out = adapter
            .chat(
                &[ChatMessage::user("hi")],
                &DecodeOptions::default(),
                &mut |t| chunks.push(t.to_string()),
            )
            .unwrap();
        assert_eq!(out.text, "hello there");
        assert_eq!(chunks, vec!["hello there".to_string()]);
    }
}
