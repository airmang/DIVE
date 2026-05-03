pub mod stream;

use async_trait::async_trait;
use futures::{stream::BoxStream, StreamExt};
use serde_json::json;

use super::{sse, ChatEvent, ChatRequest, LlmProvider, ModelInfo, ProviderError};

pub struct OpenAiProvider {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            base_url: "https://api.openai.com/v1".to_string(),
            http: reqwest::Client::new(),
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    pub fn openrouter(api_key: String) -> Self {
        Self::new(api_key).with_base_url("https://openrouter.ai/api/v1")
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> &str {
        "openai"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        [
            ("gpt-5.2", "GPT-5.2"),
            ("gpt-5.2-codex", "GPT-5.2 Codex"),
            ("gpt-5.1", "GPT-5.1"),
        ]
        .into_iter()
        .map(|(id, display_name)| ModelInfo {
            id: id.to_string(),
            display_name: display_name.to_string(),
        })
        .collect()
    }

    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        let mut body = serde_json::to_value(&req)?;
        body["stream"] = json!(true);
        body["stream_options"] = json!({"include_usage": true});

        let response = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            return Err(ProviderError::Api {
                status: status.as_u16(),
                body: response.text().await?,
            });
        }

        Ok(stream::parse_openai_events(sse::response_to_sse_events(response)).boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}
