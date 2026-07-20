use std::sync::Arc;

use crate::providers::{ChatEvent, ChatRequest, LlmProvider, ModelInfo, ProviderError};
use async_trait::async_trait;
use futures::stream::BoxStream;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderKind {
    None,
    Anthropic,
    OpenAi,
    OpenRouter,
    Codex,
    OpencodeZen,
    CustomOpenAi,
    Other(String),
}

impl ProviderKind {
    pub fn parse(kind: &str) -> Self {
        match kind {
            "anthropic" => Self::Anthropic,
            "openai" => Self::OpenAi,
            "openrouter" => Self::OpenRouter,
            "codex" => Self::Codex,
            "opencode-zen" | "opencode_zen" => Self::OpencodeZen,
            "custom-openai" | "custom_openai" => Self::CustomOpenAi,
            "" | "none" => Self::None,
            other => Self::Other(other.to_owned()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::None => "none",
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
            Self::OpenRouter => "openrouter",
            Self::Codex => "codex",
            Self::OpencodeZen => "opencode_zen",
            Self::CustomOpenAi => "custom-openai",
            Self::Other(kind) => kind,
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, Self::None)
    }
}

#[derive(Clone)]
pub struct ProviderRuntime {
    pub config_id: Option<i64>,
    pub kind: ProviderKind,
    pub model: String,
    pub provider: Arc<dyn LlmProvider>,
}

impl ProviderRuntime {
    pub fn none() -> Self {
        Self {
            config_id: None,
            kind: ProviderKind::None,
            model: "unset".into(),
            provider: Arc::new(NoProviderSentinel),
        }
    }

    pub fn new(
        config_id: Option<i64>,
        kind: ProviderKind,
        model: String,
        provider: Arc<dyn LlmProvider>,
    ) -> Self {
        Self {
            config_id,
            kind,
            model,
            provider,
        }
    }
}

pub struct NoProviderSentinel;

#[async_trait]
impl LlmProvider for NoProviderSentinel {
    fn id(&self) -> &str {
        "none"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        Vec::new()
    }

    async fn chat(
        &self,
        _req: ChatRequest,
    ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        Err(ProviderError::NotConfigured)
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Err(ProviderError::NotConfigured)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_kind_parses_known_values() {
        assert_eq!(ProviderKind::parse("anthropic"), ProviderKind::Anthropic);
        assert_eq!(ProviderKind::parse("openrouter"), ProviderKind::OpenRouter);
        assert_eq!(
            ProviderKind::parse("opencode-zen"),
            ProviderKind::OpencodeZen
        );
        assert_eq!(ProviderKind::parse("opencode_zen").as_str(), "opencode_zen");
        assert_eq!(ProviderKind::parse("none"), ProviderKind::None);
        assert_eq!(
            ProviderKind::parse("custom"),
            ProviderKind::Other("custom".into())
        );
    }

    #[tokio::test]
    async fn no_provider_sentinel_returns_not_configured() {
        let sentinel = NoProviderSentinel;
        let req = ChatRequest {
            model: "unset".into(),
            messages: Vec::new(),
            tools: None,
            tool_choice: None,
            temperature: None,
            max_tokens: None,
        };
        assert!(matches!(
            sentinel.chat(req).await,
            Err(ProviderError::NotConfigured)
        ));
    }
}
