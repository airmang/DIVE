pub mod stream;

use async_trait::async_trait;
use futures::{stream::BoxStream, StreamExt};
use serde_json::{json, Value};

use super::{
    sse, ChatEvent, ChatRequest, LlmProvider, Message, ModelInfo, ProviderError, ToolChoice,
};

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
        let mut body = to_openai_payload(&req);
        body["stream"] = json!(true);
        if self.id == "openai" {
            body["stream_options"] = json!({"include_usage": true});
        }

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

fn to_openai_payload(req: &ChatRequest) -> Value {
    let messages = req
        .messages
        .iter()
        .map(|message| match message {
            Message::System { content } => json!({ "role": "system", "content": content }),
            Message::User { content } => json!({ "role": "user", "content": content }),
            Message::Assistant {
                content,
                tool_calls,
            } => {
                let mut msg = json!({ "role": "assistant", "content": content });
                if let Some(calls) = tool_calls {
                    msg["tool_calls"] = Value::Array(
                        calls
                            .iter()
                            .map(|call| {
                                json!({
                                    "id": call.id,
                                    "type": "function",
                                    "function": {
                                        "name": call.name,
                                        "arguments": call.arguments,
                                    }
                                })
                            })
                            .collect(),
                    );
                }
                msg
            }
            Message::Tool {
                content,
                tool_call_id,
            } => {
                json!({ "role": "tool", "content": content, "tool_call_id": tool_call_id })
            }
        })
        .collect::<Vec<_>>();

    let mut body = json!({
        "model": req.model,
        "messages": messages,
    });
    if let Some(temperature) = req.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(max_tokens) = req.max_tokens {
        body["max_tokens"] = json!(max_tokens);
    }
    if let Some(tools) = &req.tools {
        body["tools"] = Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.parameters,
                        }
                    })
                })
                .collect(),
        );
    }
    if let Some(choice) = &req.tool_choice {
        body["tool_choice"] = match choice {
            ToolChoice::Auto => json!("auto"),
            ToolChoice::None => json!("none"),
            ToolChoice::Required => json!("required"),
            ToolChoice::Specific(name) => {
                json!({ "type": "function", "function": { "name": name } })
            }
        };
    }
    body
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
    use crate::providers::{Message, ToolCall, ToolChoice, ToolDef};

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

    #[test]
    fn converts_tool_request_to_openai_compatible_shape() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![
                Message::System {
                    content: "sys".into(),
                },
                Message::User {
                    content: "make cards".into(),
                },
            ],
            tools: Some(vec![ToolDef {
                name: "assist_cards".into(),
                description: "cards".into(),
                parameters: json!({"type":"object"}),
            }]),
            tool_choice: Some(ToolChoice::Specific("assist_cards".into())),
            temperature: Some(0.4),
            max_tokens: Some(1024),
            stream: true,
        };

        let body = to_openai_payload(&req);
        assert_eq!(body["tools"][0]["type"], json!("function"));
        assert_eq!(body["tools"][0]["function"]["name"], json!("assist_cards"));
        assert_eq!(
            body["tool_choice"],
            json!({"type":"function","function":{"name":"assist_cards"}})
        );
    }

    #[test]
    fn converts_assistant_tool_history_to_openai_compatible_shape() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![
                Message::Assistant {
                    content: "".into(),
                    tool_calls: Some(vec![ToolCall {
                        id: "call_1".into(),
                        name: "read_file".into(),
                        arguments: "{\"path\":\"a\"}".into(),
                    }]),
                },
                Message::Tool {
                    content: "ok".into(),
                    tool_call_id: "call_1".into(),
                },
            ],
            tools: None,
            tool_choice: None,
            temperature: None,
            max_tokens: None,
            stream: true,
        };

        let body = to_openai_payload(&req);
        assert_eq!(
            body["messages"][0]["tool_calls"][0],
            json!({
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": "{\"path\":\"a\"}",
                }
            })
        );
        assert_eq!(body["messages"][1]["role"], json!("tool"));
        assert_eq!(body["messages"][1]["tool_call_id"], json!("call_1"));
    }
}
