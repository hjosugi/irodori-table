//! GEN-017 — HTTP model providers (feature `http`).
//!
//! [`OllamaModel`] talks to a local Ollama server; [`OpenAiCompatModel`] talks to
//! any OpenAI-compatible chat API (OpenAI, Azure OpenAI, OpenRouter, AI gateways,
//! many self-hosted/Anthropic-compatible endpoints). Neither constrains decoding
//! with the GBNF grammar, so both ignore it and rely on the [`verify`](crate::verify)
//! gate — the output is parsed and schema-validated, so a strong remote model is
//! just as safe as the embedded one, only its mistakes get rejected instead of
//! prevented. Uses a blocking client so it fits the synchronous [`GrammarModel`].

use std::time::Duration;

use irodori_error::{IrodoriError, IrodoriErrorKind, Result};

use crate::runtime::{DecodeOptions, GrammarModel, ModelDescription, ModelOutput};

#[derive(Debug, Clone)]
pub struct HttpConfig {
    /// Base URL (e.g. `http://localhost:11434` or `https://api.openai.com`), or a
    /// full endpoint URL — both are handled.
    pub endpoint: String,
    pub model: String,
    pub api_key: Option<String>,
    pub label: String,
    pub timeout_secs: u64,
}

impl HttpConfig {
    pub fn new(endpoint: impl Into<String>, model: impl Into<String>) -> Self {
        let model = model.into();
        Self {
            endpoint: endpoint.into(),
            label: model.clone(),
            model,
            api_key: None,
            timeout_secs: 60,
        }
    }

    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = label.into();
        self
    }
}

fn client(timeout_secs: u64) -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .build()
        .map_err(|e| internal(format!("http client: {e}")))
}

/// A local [Ollama](https://ollama.com) server.
pub struct OllamaModel {
    config: HttpConfig,
}

impl OllamaModel {
    pub fn new(config: HttpConfig) -> Self {
        Self { config }
    }
}

impl GrammarModel for OllamaModel {
    fn complete(&self, prompt: &str, _gbnf: &str, options: &DecodeOptions) -> Result<ModelOutput> {
        let url = format!(
            "{}/api/generate",
            self.config.endpoint.trim_end_matches('/')
        );
        let body = serde_json::json!({
            "model": self.config.model,
            "prompt": prompt,
            "stream": false,
            "options": { "temperature": options.temperature },
        });
        let response = client(self.config.timeout_secs)?
            .post(url)
            .json(&body)
            .send()
            .map_err(|e| IrodoriError::transport(format!("ollama request failed: {e}")))?;
        if !response.status().is_success() {
            return Err(IrodoriError::transport(format!(
                "ollama returned HTTP {}",
                response.status()
            )));
        }
        let value: serde_json::Value = response
            .json()
            .map_err(|e| internal(format!("ollama response: {e}")))?;
        let text = value
            .get("response")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        Ok(ModelOutput {
            text,
            tokens_in: token_count(&value, "prompt_eval_count"),
            tokens_out: token_count(&value, "eval_count"),
        })
    }

    fn describe(&self) -> ModelDescription {
        ModelDescription {
            name: self.config.label.clone(),
        }
    }
}

/// Any OpenAI-compatible `/chat/completions` API.
pub struct OpenAiCompatModel {
    config: HttpConfig,
}

impl OpenAiCompatModel {
    pub fn new(config: HttpConfig) -> Self {
        Self { config }
    }

    fn url(&self) -> String {
        let base = self.config.endpoint.trim_end_matches('/');
        if base.ends_with("/chat/completions") {
            base.to_string()
        } else if base.ends_with("/v1") {
            format!("{base}/chat/completions")
        } else {
            format!("{base}/v1/chat/completions")
        }
    }
}

impl GrammarModel for OpenAiCompatModel {
    fn complete(&self, prompt: &str, _gbnf: &str, options: &DecodeOptions) -> Result<ModelOutput> {
        let body = serde_json::json!({
            "model": self.config.model,
            "temperature": options.temperature,
            "messages": [
                { "role": "system", "content": "You output a single valid SQL SELECT statement. SQL only, no prose." },
                { "role": "user", "content": prompt },
            ],
        });
        let mut request = client(self.config.timeout_secs)?
            .post(self.url())
            .json(&body);
        if let Some(key) = &self.config.api_key {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .map_err(|e| IrodoriError::transport(format!("api request failed: {e}")))?;
        if !response.status().is_success() {
            return Err(IrodoriError::transport(format!(
                "api returned HTTP {}",
                response.status()
            )));
        }
        let value: serde_json::Value = response
            .json()
            .map_err(|e| internal(format!("api response: {e}")))?;
        let text = value
            .pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        Ok(ModelOutput {
            text,
            tokens_in: token_count(&value, "/usage/prompt_tokens"),
            tokens_out: token_count(&value, "/usage/completion_tokens"),
        })
    }

    fn describe(&self) -> ModelDescription {
        ModelDescription {
            name: self.config.label.clone(),
        }
    }
}

fn token_count(value: &serde_json::Value, key: &str) -> u32 {
    let found = if key.starts_with('/') {
        value.pointer(key)
    } else {
        value.get(key)
    };
    found.and_then(|v| v.as_u64()).unwrap_or(0) as u32
}

fn internal(message: impl Into<String>) -> IrodoriError {
    IrodoriError::new(IrodoriErrorKind::Internal, message)
}
