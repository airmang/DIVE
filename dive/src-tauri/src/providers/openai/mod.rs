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
            http: crate::http_client::build_provider_http_client(),
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
            .with_models(openrouter_models())
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
        tracing::info!(
            provider = %self.id,
            model = %req.model,
            message_count = req.messages.len(),
            tool_count = req.tools.as_ref().map_or(0, Vec::len),
            "provider chat request started"
        );
        let mut body = to_openai_payload(&req);
        body["stream"] = json!(true);
        if self.id == "openai" {
            body["stream_options"] = json!({"include_usage": true});
        }

        let response = match self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                tracing::warn!(
                    provider = %self.id,
                    error = %crate::telemetry::redact_log_text(&err.to_string()),
                    "provider chat request failed"
                );
                return Err(err.into());
            }
        };

        let status = response.status();
        if !status.is_success() {
            let status_code = status.as_u16();
            let body = response.text().await?;
            tracing::warn!(
                provider = %self.id,
                status = status_code,
                body_len = body.len(),
                "provider chat API error"
            );
            return Err(ProviderError::Api {
                status: status_code,
                body,
            });
        }

        tracing::info!(provider = %self.id, "provider chat stream opened");
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
                reasoning_content,
                tool_calls,
            } => {
                let has_tool_calls = tool_calls.as_ref().is_some_and(|t| !t.is_empty());
                let content_value = if has_tool_calls && content.is_empty() {
                    Value::Null
                } else {
                    Value::String(content.clone())
                };
                let mut msg = json!({ "role": "assistant", "content": content_value });
                if let Some(reasoning_content) = reasoning_content
                    .as_deref()
                    .filter(|value| !value.is_empty())
                {
                    msg["reasoning_content"] = json!(reasoning_content);
                }
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
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.4-mini", "GPT-5.4 Mini"),
        ("gpt-5.3-codex", "GPT-5.3 Codex"),
    ])
}

fn openrouter_models() -> Vec<ModelInfo> {
    models_from_pairs(&[
        ("mistralai/ministral-3b-2512", "Mistral · Ministral 3B 2512"),
        ("openai/gpt-5.5", "OpenAI · GPT-5.5"),
        ("openai/gpt-5.3-codex", "OpenAI · GPT-5.3 Codex"),
        ("openai/gpt-5.4", "OpenAI · GPT-5.4"),
        ("openai/gpt-5.4-mini", "OpenAI · GPT-5.4 Mini"),
    ])
}

fn opencode_zen_models() -> Vec<ModelInfo> {
    models_from_pairs(&[
        ("big-pickle", "Big Pickle"),
        ("minimax-m2.5-free", "MiniMax M2.5 Free"),
        ("hy3-preview-free", "Hy3 Preview Free"),
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
            vec!["big-pickle", "minimax-m2.5-free", "hy3-preview-free"]
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
                    reasoning_content: None,
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
        assert_eq!(body["messages"][0]["content"], Value::Null);
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

    #[test]
    fn assistant_with_content_and_tool_calls_preserves_content() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![Message::Assistant {
                content: "thinking".into(),
                reasoning_content: None,
                tool_calls: Some(vec![ToolCall {
                    id: "c1".into(),
                    name: "x".into(),
                    arguments: "{}".into(),
                }]),
            }],
            tools: None,
            tool_choice: None,
            temperature: None,
            max_tokens: None,
            stream: true,
        };

        let body = to_openai_payload(&req);
        assert_eq!(body["messages"][0]["content"], json!("thinking"));
        assert!(body["messages"][0]["tool_calls"].is_array());
    }

    #[test]
    fn assistant_tool_history_preserves_reasoning_content() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![Message::Assistant {
                content: "".into(),
                reasoning_content: Some("need directory listing first".into()),
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".into(),
                    name: "list_dir".into(),
                    arguments: "{\"path\":\".\"}".into(),
                }]),
            }],
            tools: None,
            tool_choice: None,
            temperature: None,
            max_tokens: None,
            stream: true,
        };

        let body = to_openai_payload(&req);
        assert_eq!(
            body["messages"][0]["reasoning_content"],
            json!("need directory listing first")
        );
        assert_eq!(body["messages"][0]["tool_calls"][0]["id"], json!("call_1"));
    }

    #[test]
    fn assistant_without_tool_calls_keeps_empty_string_content() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![Message::Assistant {
                content: "".into(),
                reasoning_content: None,
                tool_calls: None,
            }],
            tools: None,
            tool_choice: None,
            temperature: None,
            max_tokens: None,
            stream: true,
        };

        let body = to_openai_payload(&req);
        assert_eq!(body["messages"][0]["content"], json!(""));
        assert!(body["messages"][0].get("tool_calls").is_none());
    }
}
