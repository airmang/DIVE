pub mod stream;

use async_trait::async_trait;
use futures::{stream::BoxStream, StreamExt};
use serde_json::json;

use super::{sse, ChatEvent, ChatRequest, LlmProvider, ModelInfo, ProviderError};

pub struct OpenAiProvider {
    api_key: String,
    base_url: String,
    id: String,
    models: Vec<ModelInfo>,
    http: reqwest::Client,
}

impl OpenAiProvider {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            base_url: "https://api.openai.com/v1".to_string(),
            id: "openai".to_string(),
            models: default_openai_models(),
            http: reqwest::Client::new(),
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    pub fn with_models(mut self, models: Vec<ModelInfo>) -> Self {
        self.models = models;
        self
    }

    pub fn openrouter(api_key: String) -> Self {
        Self::new(api_key)
            .with_base_url("https://openrouter.ai/api/v1")
            .with_id("openrouter")
    }

    pub fn opencode_zen(api_key: String) -> Self {
        Self::new(api_key)
            .with_base_url("https://opencode.ai/zen/v1")
            .with_id("opencode_zen")
            .with_models(opencode_zen_models())
    }
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        self.models.clone()
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

fn default_openai_models() -> Vec<ModelInfo> {
    models_from_pairs(&[
        ("gpt-5.2", "GPT-5.2"),
        ("gpt-5.2-codex", "GPT-5.2 Codex"),
        ("gpt-5.1", "GPT-5.1"),
    ])
}

fn opencode_zen_models() -> Vec<ModelInfo> {
    models_from_pairs(&[
        ("gpt-5-nano", "GPT-5 Nano"),
        ("kimi-k2", "Kimi K2"),
        ("qwen3-coder", "Qwen3 Coder"),
        ("glm-4.6", "GLM-4.6"),
        ("gpt-oss-120b", "GPT OSS 120B"),
    ])
}

fn models_from_pairs(pairs: &[(&str, &str)]) -> Vec<ModelInfo> {
    pairs
        .iter()
        .map(|(id, display_name)| ModelInfo {
            id: (*id).to_string(),
            display_name: (*display_name).to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_zen_sets_id_base_url_and_free_models() {
        let provider = OpenAiProvider::opencode_zen("sk-test".into());

        assert_eq!(provider.id(), "opencode_zen");
        assert_eq!(provider.base_url, "https://opencode.ai/zen/v1");
        assert_eq!(
            provider
                .list_models()
                .into_iter()
                .map(|m| m.id)
                .collect::<Vec<_>>(),
            vec![
                "gpt-5-nano",
                "kimi-k2",
                "qwen3-coder",
                "glm-4.6",
                "gpt-oss-120b"
            ]
        );
    }

    #[test]
    fn custom_id_and_models_override_openai_defaults() {
        let provider = OpenAiProvider::new("sk-test".into())
            .with_id("compatible")
            .with_models(vec![ModelInfo {
                id: "custom-model".into(),
                display_name: "Custom Model".into(),
            }]);

        assert_eq!(provider.id(), "compatible");
        assert_eq!(provider.list_models()[0].id, "custom-model");
    }
}
