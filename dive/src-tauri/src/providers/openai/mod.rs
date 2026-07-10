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

    /// GET `{base_url}/models` and map OpenRouter's catalog into [`ModelInfo`].
    /// The result is curated (recommended families first, then alphabetical) so
    /// beginners see a sensible order even though the full live catalog is
    /// returned.
    async fn fetch_openrouter_catalog(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        let url = format!("{}/models", self.base_url);
        let response = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(ProviderError::Api {
                status: status.as_u16(),
                body: response.text().await.unwrap_or_default(),
            });
        }
        let body: Value = response.json().await?;
        Ok(curate_openrouter_models(parse_openrouter_catalog(&body)))
    }
}

/// Extract `{ "data": [ { "id", "name" } ] }` into `(id, display_name)` pairs,
/// skipping entries without a usable id. Falls back to the id for the display
/// name when `name` is absent.
fn parse_openrouter_catalog(body: &Value) -> Vec<ModelInfo> {
    let Some(data) = body.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    data.iter()
        .filter_map(|entry| {
            let id = entry.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }
            let display_name = entry
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id)
                .to_string();
            Some(ModelInfo {
                id: id.to_string(),
                display_name,
            })
        })
        .collect()
}

/// Curate the live catalog for a beginner-friendly selector: de-duplicate by id,
/// float recommended families to the top in a fixed order, then sort the
/// remainder by display name. Nothing is hidden — ordering only.
fn curate_openrouter_models(mut models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    // Recommended provider prefixes, in the order beginners should see them.
    const RECOMMENDED: &[&str] = &["anthropic/", "openai/", "google/"];

    let mut seen = std::collections::HashSet::new();
    models.retain(|model| seen.insert(model.id.clone()));

    let rank = |id: &str| -> usize {
        RECOMMENDED
            .iter()
            .position(|prefix| id.starts_with(prefix))
            .unwrap_or(RECOMMENDED.len())
    };
    models.sort_by(|a, b| {
        rank(&a.id)
            .cmp(&rank(&b.id))
            .then_with(|| {
                a.display_name
                    .to_lowercase()
                    .cmp(&b.display_name.to_lowercase())
            })
            .then_with(|| a.id.cmp(&b.id))
    });
    models
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        self.models.clone()
    }

    /// OpenRouter exposes a public `/models` catalog; fetching it live means new
    /// upstream models appear in the selector without a DIVE code change. Only
    /// OpenRouter is fetched live — every other OpenAI-compatible backend keeps
    /// its curated static list (returns `None` here). Any failure (offline, auth,
    /// malformed body) logs and returns `None` so the caller falls back to the
    /// static list.
    async fn fetch_models(&self) -> Option<Vec<ModelInfo>> {
        if self.id != "openrouter" {
            return None;
        }
        match self.fetch_openrouter_catalog().await {
            Ok(models) if !models.is_empty() => Some(models),
            Ok(_) => {
                tracing::warn!(provider = %self.id, "live model catalog empty; using static fallback");
                None
            }
            Err(err) => {
                tracing::warn!(
                    provider = %self.id,
                    error = %crate::telemetry::redact_log_text(&err.to_string()),
                    "live model catalog fetch failed; using static fallback"
                );
                None
            }
        }
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
        ("openai/gpt-5.4-mini", "OpenAI - GPT-5.4 Mini"),
        ("openai/gpt-5.4", "OpenAI - GPT-5.4"),
        ("anthropic/claude-sonnet-5", "Anthropic - Claude Sonnet 5"),
        (
            "google/gemini-3-flash-preview",
            "Google - Gemini 3 Flash Preview",
        ),
        ("deepseek/deepseek-v4-flash", "DeepSeek - DeepSeek V4 Flash"),
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
    fn parses_openrouter_catalog_and_falls_back_to_id_for_missing_name() {
        let body = serde_json::json!({
            "data": [
                { "id": "anthropic/claude-sonnet-5", "name": "Anthropic: Claude Sonnet 5" },
                { "id": "moonshotai/kimi-k2" },
                { "id": "  ", "name": "blank id skipped" },
                { "name": "no id skipped" }
            ]
        });
        let models = parse_openrouter_catalog(&body);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "anthropic/claude-sonnet-5");
        assert_eq!(models[0].display_name, "Anthropic: Claude Sonnet 5");
        // Missing name falls back to the id.
        assert_eq!(models[1].display_name, "moonshotai/kimi-k2");
    }

    #[test]
    fn curates_recommended_families_first_then_alphabetical() {
        let models = curate_openrouter_models(vec![
            ModelInfo {
                id: "zzz/model".into(),
                display_name: "Zzz".into(),
            },
            ModelInfo {
                id: "openai/gpt-5.4".into(),
                display_name: "OpenAI GPT-5.4".into(),
            },
            ModelInfo {
                id: "anthropic/claude-sonnet-5".into(),
                display_name: "Claude Sonnet 5".into(),
            },
            ModelInfo {
                id: "anthropic/claude-sonnet-5".into(),
                display_name: "dup".into(),
            },
            ModelInfo {
                id: "google/gemini-3".into(),
                display_name: "Gemini 3".into(),
            },
        ]);
        let ids: Vec<_> = models.into_iter().map(|m| m.id).collect();
        // De-duplicated, recommended families (anthropic, openai, google) first,
        // non-recommended ("zzz/") last.
        assert_eq!(
            ids,
            vec![
                "anthropic/claude-sonnet-5",
                "openai/gpt-5.4",
                "google/gemini-3",
                "zzz/model",
            ]
        );
    }

    #[tokio::test]
    async fn fetch_models_returns_live_catalog_for_openrouter() {
        use wiremock::matchers::{bearer_token, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .and(bearer_token("sk-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [
                    { "id": "moonshotai/kimi-k2", "name": "MoonshotAI: Kimi K2" },
                    { "id": "anthropic/claude-sonnet-5", "name": "Anthropic: Claude Sonnet 5" }
                ]
            })))
            .mount(&server)
            .await;

        let provider = OpenAiProvider::openrouter("sk-test".into()).with_base_url(server.uri());
        let models = provider.fetch_models().await.expect("live catalog");
        // Recommended (anthropic) floats above the non-recommended vendor.
        assert_eq!(models[0].id, "anthropic/claude-sonnet-5");
        assert!(models.iter().any(|m| m.id == "moonshotai/kimi-k2"));
    }

    #[tokio::test]
    async fn fetch_models_falls_back_to_none_on_http_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
            .mount(&server)
            .await;

        let provider = OpenAiProvider::openrouter("sk-test".into()).with_base_url(server.uri());
        assert!(provider.fetch_models().await.is_none());
    }

    #[tokio::test]
    async fn fetch_models_is_none_for_non_openrouter_backends() {
        // Only OpenRouter is fetched live; other OpenAI-compatible backends keep
        // their static list and never hit the network here.
        let provider = OpenAiProvider::opencode_zen("sk-test".into());
        assert!(provider.fetch_models().await.is_none());
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
