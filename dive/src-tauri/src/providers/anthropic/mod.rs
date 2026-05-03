pub mod convert;
pub mod stream;

use async_trait::async_trait;
use futures::{stream::BoxStream, StreamExt};

use super::{sse, ChatEvent, ChatRequest, LlmProvider, ModelInfo, ProviderError};

pub struct AnthropicProvider {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            base_url: "https://api.anthropic.com".to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn id(&self) -> &str {
        "anthropic"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        [
            ("claude-sonnet-4.5", "Claude Sonnet 4.5"),
            ("claude-opus-4.5", "Claude Opus 4.5"),
            ("claude-haiku-4.5", "Claude Haiku 4.5"),
        ]
        .into_iter()
        .map(|(id, display_name)| ModelInfo {
            id: id.to_string(),
            display_name: display_name.to_string(),
        })
        .collect()
    }

    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        let payload = convert::to_anthropic_payload(&req)?;
        let response = self
            .http
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&payload)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            return Err(ProviderError::Api {
                status: status.as_u16(),
                body: response.text().await?,
            });
        }

        Ok(stream::parse_anthropic_events(sse::response_to_sse_events(response)).boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}
