//! LLM 프로바이더 어댑터.
//!
//! 명세 §7. `LlmProvider` trait 기반으로 Anthropic / OpenAI / OpenRouter /
//! Codex OAuth / Custom 5종 어댑터를 정의한다. 작업 1-4 / 3-5 / 5-1에서 구현.

pub mod anthropic;
pub mod codex;
pub mod error;
pub mod factory;
#[cfg(any(test, feature = "dev-mock"))]
pub mod mock;
pub mod openai;
pub mod retry;
pub mod sse;
pub mod types;

use async_trait::async_trait;
use futures::stream::BoxStream;

pub use anthropic::AnthropicProvider;
pub use codex::CodexProvider;
pub use error::ProviderError;
pub use factory::{
    build_provider, canonical_model_for_kind, default_model_for_kind, health_check,
    models_for_kind, normalize_model_for_kind, validate_model_for_kind, validate_provider_base_url,
};
#[cfg(any(test, feature = "dev-mock"))]
pub use mock::MockProvider;
pub use openai::OpenAiProvider;
pub use retry::{is_retryable, with_retry};
pub use types::{
    ChatEvent, ChatRequest, FinishReason, Message, ModelInfo, ToolCall, ToolChoice, ToolDef, Usage,
};

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;

    /// Static, always-available model catalog. Used as the offline fallback
    /// when a live catalog is unavailable, and as the source of curated
    /// defaults.
    fn list_models(&self) -> Vec<ModelInfo>;

    /// Attempt to fetch a live model catalog from the provider's own API.
    ///
    /// Returns `None` when the provider has no live catalog (callers then use
    /// [`LlmProvider::list_models`]). Implementations MUST NOT surface network
    /// errors as `Some(empty)` — on any failure they log and return `None` so
    /// the caller falls back to the static list. This lets new upstream models
    /// appear without a code change or rebuild.
    async fn fetch_models(&self) -> Option<Vec<ModelInfo>> {
        None
    }

    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError>;
    async fn refresh_auth(&mut self) -> Result<(), ProviderError>;
}
