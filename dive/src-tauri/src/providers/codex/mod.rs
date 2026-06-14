//! Codex provider — ChatGPT subscription-backed LLM. Spec §7.4.
//!
//! Reuses the OpenAI chat/completions wire format but authenticates
//! with an OAuth `access_token` (obtained via `auth::CodexOAuth`) and
//! attaches the `ChatGPT-Account-ID` + `OpenAI-Beta: responses=v1`
//! headers required by the Codex endpoints.
//!
//! The provider holds tokens in memory. Refresh is delegated to an
//! `auth::CodexOAuth` wrapper passed in at construction time, and is
//! triggered by `refresh_auth()`. IPC-level persistence into the
//! keyring is the caller's responsibility.

use async_trait::async_trait;
use futures::{stream::BoxStream, StreamExt};
use serde_json::json;

use super::{sse, ChatEvent, ChatRequest, LlmProvider, ModelInfo, ProviderError};
use crate::auth::{CodexOAuth, CodexTokens, OAuthError};
use crate::providers::openai::stream::parse_openai_events;

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

pub struct CodexProvider {
    tokens: std::sync::Mutex<CodexTokens>,
    oauth: CodexOAuth,
    base_url: String,
    http: reqwest::Client,
}

pub fn default_codex_models() -> Vec<ModelInfo> {
    [
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.4-mini", "GPT-5.4 Mini"),
        ("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark"),
    ]
    .into_iter()
    .map(|(id, display_name)| ModelInfo {
        id: id.to_string(),
        display_name: display_name.to_string(),
    })
    .collect()
}

impl CodexProvider {
    pub fn new(tokens: CodexTokens, oauth: CodexOAuth) -> Self {
        Self::with_base_url(tokens, oauth, DEFAULT_BASE_URL)
    }

    pub fn with_base_url(
        tokens: CodexTokens,
        oauth: CodexOAuth,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            tokens: std::sync::Mutex::new(tokens),
            oauth,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http: crate::http_client::build_provider_http_client(),
        }
    }

    pub fn account_id(&self) -> String {
        self.tokens.lock().unwrap().account_id.clone()
    }

    fn snapshot_tokens(&self) -> CodexTokens {
        self.tokens.lock().unwrap().clone()
    }
}

#[async_trait]
impl LlmProvider for CodexProvider {
    fn id(&self) -> &str {
        "codex"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        default_codex_models()
    }

    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        tracing::info!(
            provider = "codex",
            model = %req.model,
            message_count = req.messages.len(),
            tool_count = req.tools.as_ref().map_or(0, Vec::len),
            "provider chat request started"
        );
        let mut body = serde_json::to_value(&req)?;
        body["stream"] = json!(true);
        body["stream_options"] = json!({"include_usage": true});

        let snapshot = self.snapshot_tokens();
        let response = match self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&snapshot.access_token)
            .header("ChatGPT-Account-ID", &snapshot.account_id)
            .header("OpenAI-Beta", "responses=v1")
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                tracing::warn!(
                    provider = "codex",
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
                provider = "codex",
                status = status_code,
                body_len = body.len(),
                "provider chat API error"
            );
            return Err(ProviderError::Api {
                status: status_code,
                body,
            });
        }

        tracing::info!(provider = "codex", "provider chat stream opened");
        Ok(parse_openai_events(sse::response_to_sse_events(response)).boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        let refresh_token = self.tokens.lock().unwrap().refresh_token.clone();
        let new_tokens = self
            .oauth
            .refresh(&refresh_token)
            .await
            .map_err(codex_err_to_provider)?;
        *self.tokens.lock().unwrap() = new_tokens;
        Ok(())
    }
}

fn codex_err_to_provider(err: OAuthError) -> ProviderError {
    match err {
        OAuthError::Http(e) => ProviderError::Http(e),
        OAuthError::Remote { status, body } => ProviderError::Api { status, body },
        OAuthError::Decode(msg) => ProviderError::Api {
            status: 0,
            body: format!("decode: {msg}"),
        },
        OAuthError::StateMismatch => ProviderError::Api {
            status: 0,
            body: "oauth state mismatch".into(),
        },
    }
}
