//! LLM 프로바이더 어댑터.
//!
//! 명세 §7. `LlmProvider` trait 기반으로 Anthropic / OpenAI / OpenRouter /
//! Codex OAuth / Custom 5종 어댑터를 정의한다. 작업 1-4 / 3-5 / 5-1에서 구현.

pub mod anthropic;
pub mod error;
pub mod mock;
pub mod openai;
pub mod sse;
pub mod types;

use async_trait::async_trait;
use futures::stream::BoxStream;

pub use anthropic::AnthropicProvider;
pub use error::ProviderError;
pub use mock::MockProvider;
pub use openai::OpenAiProvider;
pub use types::{
    ChatEvent, ChatRequest, FinishReason, Message, ModelInfo, ToolCall, ToolChoice, ToolDef, Usage,
};

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;
    fn list_models(&self) -> Vec<ModelInfo>;
    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError>;
    async fn refresh_auth(&mut self) -> Result<(), ProviderError>;
}
