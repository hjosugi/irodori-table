//! GEN-015 — embedded, CPU-only llama.cpp runtime (feature `llama`).
//!
//! Implements [`GrammarModel`] with grammar-constrained decoding: the
//! schema-projected GBNF grammar is installed as a sampler so the model can only
//! emit grammar-valid tokens. Because the grammar guarantees validity, a tiny
//! quantized GGUF model (e.g. Qwen2.5-Coder-0.5B Q4) is enough — which is the
//! point of running it locally and 徹底的にかるく.
//!
//! Lightness measures: CPU only (`n_gpu_layers = 0`), the model is mmapped and
//! loaded once, a fresh context is created per request (so KV-cache memory is
//! released between calls), a small `n_ctx`, and a capped thread count.

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use irodori_error::{IrodoriError, IrodoriErrorKind, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;

use crate::runtime::{DecodeOptions, GrammarModel, ModelDescription, ModelOutput};

/// How to load and run the local model.
#[derive(Debug, Clone)]
pub struct LlamaConfig {
    pub model_path: PathBuf,
    /// Context window. Kept small; the schema-projected prompt is compact.
    pub n_ctx: u32,
    /// CPU threads. Capped to keep the footprint modest.
    pub n_threads: i32,
}

impl LlamaConfig {
    pub fn new(model_path: impl Into<PathBuf>) -> Self {
        Self {
            model_path: model_path.into(),
            n_ctx: 2048,
            n_threads: default_threads(),
        }
    }
}

/// A loaded local model. `Send + Sync`; create one and reuse it.
pub struct LlamaSqlModel {
    backend: Arc<LlamaBackend>,
    model: LlamaModel,
    config: LlamaConfig,
    label: String,
}

impl LlamaSqlModel {
    /// Load a GGUF model from disk (mmapped, CPU-only). The backend is
    /// initialized once per process.
    pub fn load(config: LlamaConfig) -> Result<Self> {
        if !config.model_path.exists() {
            return Err(IrodoriError::new(
                IrodoriErrorKind::NotFound,
                format!("model file not found: {}", config.model_path.display()),
            ));
        }
        let backend = shared_backend()?;
        // CPU only: no GPU offload.
        let model_params = LlamaModelParams::default().with_n_gpu_layers(0);
        let model = LlamaModel::load_from_file(&backend, &config.model_path, &model_params)
            .map_err(|e| internal(format!("failed to load model: {e}")))?;
        let label = model_label(&config.model_path);
        Ok(Self {
            backend,
            model,
            config,
            label,
        })
    }

    fn context_params(&self) -> Result<LlamaContextParams> {
        let n_ctx =
            NonZeroU32::new(self.config.n_ctx.max(256)).ok_or_else(|| internal("invalid n_ctx"))?;
        Ok(LlamaContextParams::default()
            .with_n_ctx(Some(n_ctx))
            .with_n_threads(self.config.n_threads)
            .with_n_threads_batch(self.config.n_threads))
    }
}

impl GrammarModel for LlamaSqlModel {
    fn complete(&self, prompt: &str, gbnf: &str, options: &DecodeOptions) -> Result<ModelOutput> {
        let mut ctx = self
            .model
            .new_context(&self.backend, self.context_params()?)
            .map_err(|e| internal(format!("failed to create context: {e}")))?;

        let tokens = self
            .model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| internal(format!("tokenization failed: {e}")))?;
        let tokens_in = tokens.len() as u32;

        let n_ctx = ctx.n_ctx() as i32;
        if tokens.len() as i32 >= n_ctx {
            return Err(IrodoriError::new(
                IrodoriErrorKind::Validation,
                "prompt exceeds the model context window".to_string(),
            ));
        }

        let mut batch = LlamaBatch::new(tokens.len().max(512), 1);
        let last = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            batch
                .add(*token, i as i32, &[0], i == last)
                .map_err(|e| internal(format!("batch add failed: {e}")))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| internal(format!("prompt decode failed: {e}")))?;

        let mut sampler = self.build_sampler(gbnf, options)?;
        let mut generated = Vec::new();
        let mut n_cur = batch.n_tokens();
        let max_tokens = options.max_tokens.max(1) as usize;

        while generated.len() < max_tokens && n_cur < n_ctx {
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            if self.model.is_eog_token(token) {
                break;
            }
            generated.push(token);

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| internal(format!("batch add failed: {e}")))?;
            n_cur += 1;
            ctx.decode(&mut batch)
                .map_err(|e| internal(format!("decode failed: {e}")))?;
        }

        let text = self
            .model
            .tokens_to_str(&generated, Special::Plaintext)
            .map_err(|e| internal(format!("detokenization failed: {e}")))?;

        Ok(ModelOutput {
            text,
            tokens_in,
            tokens_out: generated.len() as u32,
        })
    }

    fn describe(&self) -> ModelDescription {
        ModelDescription {
            name: self.label.clone(),
        }
    }
}

impl LlamaSqlModel {
    /// Grammar first (masks invalid tokens), then selection. Greedy by default so
    /// generation is deterministic and the grammar does the constraining.
    fn build_sampler(&self, gbnf: &str, options: &DecodeOptions) -> Result<LlamaSampler> {
        let grammar = LlamaSampler::grammar(&self.model, gbnf, "root")
            .map_err(|e| internal(format!("invalid grammar: {e}")))?;
        if options.temperature > 0.0 {
            let seed = options.seed.unwrap_or(0) as u32;
            Ok(LlamaSampler::chain_simple([
                grammar,
                LlamaSampler::temp(options.temperature),
                LlamaSampler::dist(seed),
            ]))
        } else {
            Ok(LlamaSampler::chain_simple([
                grammar,
                LlamaSampler::greedy(),
            ]))
        }
    }
}

fn shared_backend() -> Result<Arc<LlamaBackend>> {
    static BACKEND: OnceLock<std::result::Result<Arc<LlamaBackend>, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            LlamaBackend::init()
                .map(Arc::new)
                .map_err(|e| e.to_string())
        })
        .clone()
        .map_err(|e| internal(format!("failed to init llama backend: {e}")))
}

fn default_threads() -> i32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    // Cap so a background generation never monopolizes the machine.
    cores.clamp(1, 8) as i32
}

fn model_label(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("local-model")
        .to_string()
}

fn internal(message: impl Into<String>) -> IrodoriError {
    IrodoriError::new(IrodoriErrorKind::Internal, message)
}
