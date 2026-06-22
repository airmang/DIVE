//! Codex provider backed by ChatGPT subscription OAuth.
//!
//! ChatGPT OAuth tokens are not regular OpenAI API keys. The stable path for
//! Codex models is the ChatGPT backend Codex Responses endpoint, which uses the
//! Responses SSE event shape rather than `/v1/chat/completions` chunks.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use async_trait::async_trait;
use futures::{stream, stream::BoxStream, Stream, StreamExt};
use serde_json::{json, Value};

use super::{sse, ChatEvent, ChatRequest, FinishReason, LlmProvider, ModelInfo, ProviderError};
use crate::auth::{CodexOAuth, CodexTokens, OAuthError};

pub const DEFAULT_BASE_URL: &str = "https://chatgpt.com/backend-api";

const MAX_INITIAL_REQUEST_ATTEMPTS: u32 = 3;
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(750);

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

    async fn send_responses_request(
        &self,
        tokens: &CodexTokens,
        body: &Value,
    ) -> Result<reqwest::Response, ProviderError> {
        let url = resolve_codex_responses_url(&self.base_url);
        let mut last: Option<ProviderError> = None;

        for attempt in 0..MAX_INITIAL_REQUEST_ATTEMPTS {
            let result = self
                .http
                .post(&url)
                .bearer_auth(&tokens.access_token)
                .header("chatgpt-account-id", &tokens.account_id)
                .header("originator", "pi")
                .header("OpenAI-Beta", "responses=experimental")
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .json(body)
                .send()
                .await;

            match result {
                Ok(response) if response.status().is_success() => return Ok(response),
                Ok(response) => {
                    let status = response.status();
                    let status_code = status.as_u16();
                    let body = response.text().await?;
                    tracing::warn!(
                        provider = "codex",
                        status = status_code,
                        body_len = body.len(),
                        attempt = attempt + 1,
                        "provider chat API error"
                    );
                    let err = ProviderError::Api {
                        status: status_code,
                        body,
                    };
                    if attempt + 1 >= MAX_INITIAL_REQUEST_ATTEMPTS
                        || !is_retryable_initial_error(&err)
                    {
                        return Err(err);
                    }
                    last = Some(err);
                }
                Err(err) => {
                    tracing::warn!(
                        provider = "codex",
                        error = %crate::telemetry::redact_log_text(&err.to_string()),
                        attempt = attempt + 1,
                        "provider chat request failed"
                    );
                    let err = ProviderError::from(err);
                    if attempt + 1 >= MAX_INITIAL_REQUEST_ATTEMPTS
                        || !is_retryable_initial_error(&err)
                    {
                        return Err(err);
                    }
                    last = Some(err);
                }
            }

            tokio::time::sleep(INITIAL_RETRY_DELAY * 2u32.pow(attempt)).await;
        }

        Err(last.unwrap_or_else(|| ProviderError::Stream("codex retry exhausted".into())))
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
        let body = to_codex_responses_payload(&req);
        let snapshot = self.snapshot_tokens();
        let response = self.send_responses_request(&snapshot, &body).await?;

        tracing::info!(provider = "codex", "provider chat stream opened");
        Ok(parse_codex_response_events(sse::response_to_sse_events(response)).boxed())
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

fn resolve_codex_responses_url(base_url: &str) -> String {
    let normalized = base_url.trim_end_matches('/');
    if normalized.ends_with("/codex/responses") {
        normalized.to_string()
    } else if normalized.ends_with("/codex") {
        format!("{normalized}/responses")
    } else {
        format!("{normalized}/codex/responses")
    }
}

fn is_retryable_initial_error(err: &ProviderError) -> bool {
    match err {
        ProviderError::Api { status, body } => {
            if *status == 429 {
                !body.to_ascii_lowercase().contains("usage limit")
                    && !body.to_ascii_lowercase().contains("insufficient_quota")
            } else {
                *status >= 500 && *status < 600
            }
        }
        ProviderError::Http(error) => error.is_timeout() || error.is_connect(),
        ProviderError::Timeout(_) => true,
        _ => false,
    }
}

fn to_codex_responses_payload(req: &ChatRequest) -> Value {
    let (instructions, input) = to_responses_messages(&req.messages);
    let mut body = json!({
        "model": req.model,
        "store": false,
        "stream": true,
        "instructions": if instructions.trim().is_empty() {
            "You are a helpful assistant."
        } else {
            instructions.as_str()
        },
        "input": input,
        "text": { "verbosity": "low" },
        "include": ["reasoning.encrypted_content"],
        "tool_choice": to_responses_tool_choice(req.tool_choice.as_ref()),
        "parallel_tool_calls": true,
    });

    if let Some(tools) = &req.tools {
        body["tools"] = Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                        "strict": Value::Null,
                    })
                })
                .collect(),
        );
    }

    body
}

fn to_responses_tool_choice(choice: Option<&super::ToolChoice>) -> Value {
    match choice {
        Some(super::ToolChoice::None) => json!("none"),
        Some(super::ToolChoice::Required) => json!("required"),
        Some(super::ToolChoice::Specific(name)) => {
            json!({ "type": "function", "name": name })
        }
        Some(super::ToolChoice::Auto) | None => json!("auto"),
    }
}

fn to_responses_messages(messages: &[super::Message]) -> (String, Vec<Value>) {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for (idx, message) in messages.iter().enumerate() {
        match message {
            super::Message::System { content } => instructions.push(content.trim().to_string()),
            super::Message::User { content } => {
                input.push(json!({
                    "role": "user",
                    "content": [{ "type": "input_text", "text": content }],
                }));
            }
            super::Message::Assistant {
                content,
                tool_calls,
                ..
            } => {
                if !content.is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "id": format!("msg_dive_{idx}"),
                        "content": [{ "type": "output_text", "text": content, "annotations": [] }],
                    }));
                }
                for call in tool_calls.iter().flatten() {
                    let (call_id, item_id) = response_tool_ids(&call.id);
                    input.push(json!({
                        "type": "function_call",
                        "id": item_id,
                        "call_id": call_id,
                        "name": call.name,
                        "arguments": call.arguments,
                    }));
                }
            }
            super::Message::Tool {
                content,
                tool_call_id,
            } => {
                let (call_id, _) = response_tool_ids(tool_call_id);
                input.push(json!({
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": content,
                }));
            }
        }
    }
    (
        instructions
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        input,
    )
}

fn response_tool_ids(id: &str) -> (String, String) {
    if let Some((call_id, item_id)) = id.split_once('|') {
        return (
            sanitize_response_id(call_id, "call"),
            ensure_function_item_id(item_id),
        );
    }
    let call_id = sanitize_response_id(id, "call");
    let item_id = ensure_function_item_id(&call_id);
    (call_id, item_id)
}

fn sanitize_response_id(raw: &str, fallback: &str) -> String {
    let mut out = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    while out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        out = fallback.to_string();
    }
    out.chars().take(64).collect()
}

fn ensure_function_item_id(raw: &str) -> String {
    let id = sanitize_response_id(raw, "fc_call");
    if id.starts_with("fc_") {
        id
    } else {
        format!("fc_{id}")
    }
}

#[derive(Default)]
struct CodexResponseState {
    item_to_call: HashMap<String, String>,
    current_call: Option<String>,
    emitted_tool_starts: HashSet<String>,
    ended_tools: HashSet<String>,
    tool_arg_lens: HashMap<String, usize>,
    done_emitted: bool,
    saw_tool_call: bool,
    text_len: usize,
    reasoning_len: usize,
}

fn parse_codex_response_events<S>(events: S) -> impl Stream<Item = ChatEvent>
where
    S: Stream<Item = Result<sse::SseEvent, ProviderError>> + Send + 'static,
{
    events
        .scan(CodexResponseState::default(), |state, item| {
            let output = match item {
                Ok(event) => handle_codex_response_event(state, &event.data),
                Err(error) => vec![ChatEvent::Error(error.to_string())],
            };
            async move { Some(output) }
        })
        .flat_map(stream::iter)
}

fn handle_codex_response_event(state: &mut CodexResponseState, data: &str) -> Vec<ChatEvent> {
    if data.trim() == "[DONE]" {
        return done_events(state, FinishReason::Stop);
    }

    let parsed = match serde_json::from_str::<Value>(data) {
        Ok(parsed) => parsed,
        Err(_) => {
            return vec![ChatEvent::Error(format!(
                "invalid Codex Responses SSE JSON: {data}"
            ))]
        }
    };
    let event_type = parsed
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut output = Vec::new();

    match event_type {
        "response.output_item.added" => {
            if let Some(item) = parsed.get("item") {
                if item.get("type").and_then(Value::as_str) == Some("function_call") {
                    state.saw_tool_call = true;
                    let call_id = item
                        .get("call_id")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("id").and_then(Value::as_str))
                        .map(|id| sanitize_response_id(id, "call"))
                        .unwrap_or_else(|| "call".to_string());
                    if let Some(item_id) = item.get("id").and_then(Value::as_str) {
                        state
                            .item_to_call
                            .insert(item_id.to_string(), call_id.clone());
                    }
                    state.current_call = Some(call_id.clone());
                    if let Some(name) = item.get("name").and_then(Value::as_str) {
                        output.extend(tool_start_once(state, call_id, name.to_string()));
                    }
                }
            }
        }
        "response.output_text.delta" | "response.refusal.delta" => {
            if let Some(delta) = parsed.get("delta").and_then(Value::as_str) {
                state.text_len += delta.len();
                output.push(ChatEvent::TextDelta(delta.to_string()));
            }
        }
        "response.output_text.done" | "response.refusal.done" => {
            let text = parsed
                .get("text")
                .or_else(|| parsed.get("refusal"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            output
                .extend(remaining_text_delta(text, &mut state.text_len).map(ChatEvent::TextDelta));
        }
        "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
            if let Some(delta) = parsed.get("delta").and_then(Value::as_str) {
                state.reasoning_len += delta.len();
                output.push(ChatEvent::ReasoningDelta(delta.to_string()));
            }
        }
        "response.reasoning_summary_text.done" | "response.reasoning_text.done" => {
            if let Some(text) = parsed.get("text").and_then(Value::as_str) {
                output.extend(
                    remaining_text_delta(text, &mut state.reasoning_len)
                        .map(ChatEvent::ReasoningDelta),
                );
            }
        }
        "response.function_call_arguments.delta" => {
            if let Some(delta) = parsed.get("delta").and_then(Value::as_str) {
                if let Some(call_id) = event_call_id(state, &parsed) {
                    *state.tool_arg_lens.entry(call_id.clone()).or_default() += delta.len();
                    output.push(ChatEvent::ToolCallDelta {
                        id: call_id,
                        arguments_delta: delta.to_string(),
                    });
                }
            }
        }
        "response.function_call_arguments.done" => {
            if let Some(arguments) = parsed.get("arguments").and_then(Value::as_str) {
                if let Some(call_id) = event_call_id(state, &parsed) {
                    output.extend(tool_arguments_remainder(state, call_id, arguments));
                }
            }
        }
        "response.output_item.done" => {
            if let Some(item) = parsed.get("item") {
                if item.get("type").and_then(Value::as_str) == Some("function_call") {
                    state.saw_tool_call = true;
                    let call_id = item
                        .get("call_id")
                        .and_then(Value::as_str)
                        .map(|id| sanitize_response_id(id, "call"))
                        .or_else(|| event_call_id(state, &parsed))
                        .unwrap_or_else(|| "call".to_string());
                    if let Some(name) = item.get("name").and_then(Value::as_str) {
                        output.extend(tool_start_once(state, call_id.clone(), name.to_string()));
                    }
                    if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
                        output.extend(tool_arguments_remainder(state, call_id.clone(), arguments));
                    }
                    if state.ended_tools.insert(call_id.clone()) {
                        output.push(ChatEvent::ToolCallEnd { id: call_id });
                    }
                }
            }
        }
        "response.completed" => {
            if let Some(usage) = parsed
                .get("response")
                .and_then(|response| response.get("usage"))
            {
                let input_tokens = usage
                    .get("input_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32;
                let output_tokens = usage
                    .get("output_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32;
                output.push(ChatEvent::Usage {
                    prompt_tokens: input_tokens,
                    completion_tokens: output_tokens,
                });
            }
            let finish = parsed
                .get("response")
                .and_then(|response| response.get("status"))
                .and_then(Value::as_str)
                .map(map_codex_finish_reason)
                .unwrap_or(FinishReason::Stop);
            output.extend(done_events(state, finish));
        }
        "response.failed" => {
            output.push(ChatEvent::Error(response_error_message(&parsed)));
            output.extend(done_events(state, FinishReason::Error));
        }
        "error" => {
            let message = parsed
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| parsed.get("error").and_then(Value::as_str))
                .unwrap_or("Codex Responses stream error");
            output.push(ChatEvent::Error(message.to_string()));
            output.extend(done_events(state, FinishReason::Error));
        }
        _ => {}
    }

    output
}

fn event_call_id(state: &CodexResponseState, event: &Value) -> Option<String> {
    event
        .get("call_id")
        .and_then(Value::as_str)
        .map(|id| sanitize_response_id(id, "call"))
        .or_else(|| {
            event
                .get("item_id")
                .and_then(Value::as_str)
                .and_then(|item_id| state.item_to_call.get(item_id).cloned())
        })
        .or_else(|| state.current_call.clone())
}

fn tool_start_once(
    state: &mut CodexResponseState,
    call_id: String,
    name: String,
) -> Vec<ChatEvent> {
    if state.emitted_tool_starts.insert(call_id.clone()) {
        vec![ChatEvent::ToolCallStart { id: call_id, name }]
    } else {
        Vec::new()
    }
}

fn tool_arguments_remainder(
    state: &mut CodexResponseState,
    call_id: String,
    arguments: &str,
) -> Vec<ChatEvent> {
    let emitted = *state.tool_arg_lens.get(&call_id).unwrap_or(&0);
    let delta = if emitted == 0 {
        arguments.to_string()
    } else if arguments.len() > emitted && arguments.is_char_boundary(emitted) {
        arguments[emitted..].to_string()
    } else {
        String::new()
    };
    state.tool_arg_lens.insert(call_id.clone(), arguments.len());
    if delta.is_empty() {
        Vec::new()
    } else {
        vec![ChatEvent::ToolCallDelta {
            id: call_id,
            arguments_delta: delta,
        }]
    }
}

fn remaining_text_delta(text: &str, emitted_len: &mut usize) -> Option<String> {
    let delta = if *emitted_len == 0 {
        text.to_string()
    } else if text.len() > *emitted_len && text.is_char_boundary(*emitted_len) {
        text[*emitted_len..].to_string()
    } else {
        String::new()
    };
    *emitted_len = text.len();
    if delta.is_empty() {
        None
    } else {
        Some(delta)
    }
}

fn done_events(state: &mut CodexResponseState, finish: FinishReason) -> Vec<ChatEvent> {
    if state.done_emitted {
        return Vec::new();
    }
    state.done_emitted = true;
    let finish_reason = if state.saw_tool_call && finish == FinishReason::Stop {
        FinishReason::ToolCalls
    } else {
        finish
    };
    vec![ChatEvent::Done { finish_reason }]
}

fn map_codex_finish_reason(status: &str) -> FinishReason {
    match status {
        "completed" => FinishReason::Stop,
        "incomplete" => FinishReason::Length,
        "failed" | "cancelled" => FinishReason::Error,
        "queued" | "in_progress" => FinishReason::Stop,
        _ => FinishReason::Error,
    }
}

fn response_error_message(event: &Value) -> String {
    let error = event
        .get("response")
        .and_then(|response| response.get("error"));
    let code = error
        .and_then(|err| err.get("code"))
        .and_then(Value::as_str);
    let message = error
        .and_then(|err| err.get("message"))
        .and_then(Value::as_str);
    match (code, message) {
        (Some(code), Some(message)) => format!("{code}: {message}"),
        (_, Some(message)) => message.to_string(),
        (Some(code), _) => code.to_string(),
        _ => "Codex response failed".to_string(),
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

#[cfg(test)]
mod tests {
    use futures::StreamExt;

    use super::*;

    fn event(data: Value) -> Result<sse::SseEvent, ProviderError> {
        Ok(sse::SseEvent {
            event: "message".into(),
            data: data.to_string(),
            id: String::new(),
        })
    }

    async fn collect(items: Vec<Result<sse::SseEvent, ProviderError>>) -> Vec<ChatEvent> {
        parse_codex_response_events(stream::iter(items))
            .collect()
            .await
    }

    #[test]
    fn resolves_codex_responses_url() {
        assert_eq!(
            resolve_codex_responses_url("https://chatgpt.com/backend-api"),
            "https://chatgpt.com/backend-api/codex/responses"
        );
        assert_eq!(
            resolve_codex_responses_url("https://example.test/codex"),
            "https://example.test/codex/responses"
        );
        assert_eq!(
            resolve_codex_responses_url("https://example.test/codex/responses"),
            "https://example.test/codex/responses"
        );
    }

    #[test]
    fn builds_responses_payload_with_specific_tool_choice() {
        let req = ChatRequest {
            model: "gpt-5.5".into(),
            messages: vec![
                super::super::Message::System {
                    content: "sys".into(),
                },
                super::super::Message::User {
                    content: "verify".into(),
                },
            ],
            tools: Some(vec![super::super::ToolDef {
                name: "verify_result".into(),
                description: "verify".into(),
                parameters: json!({ "type": "object" }),
            }]),
            tool_choice: Some(super::super::ToolChoice::Specific("verify_result".into())),
            temperature: Some(0.0),
            max_tokens: Some(256),
            stream: true,
        };

        let body = to_codex_responses_payload(&req);

        assert_eq!(body["model"], json!("gpt-5.5"));
        assert_eq!(body["instructions"], json!("sys"));
        assert_eq!(body["input"][0]["content"][0]["type"], json!("input_text"));
        assert_eq!(
            body["tool_choice"],
            json!({ "type": "function", "name": "verify_result" })
        );
        assert_eq!(body["tools"][0]["type"], json!("function"));
        assert!(body.get("temperature").is_none());
        assert!(body.get("max_output_tokens").is_none());
    }

    #[tokio::test]
    async fn parses_text_usage_and_done() {
        let events = collect(vec![
            event(json!({
                "type": "response.output_text.delta",
                "delta": "Hel"
            })),
            event(json!({
                "type": "response.output_text.done",
                "text": "Hello"
            })),
            event(json!({
                "type": "response.completed",
                "response": {
                    "status": "completed",
                    "usage": {
                        "input_tokens": 3,
                        "output_tokens": 4,
                        "total_tokens": 7
                    }
                }
            })),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::TextDelta("Hel".into()),
                ChatEvent::TextDelta("lo".into()),
                ChatEvent::Usage {
                    prompt_tokens: 3,
                    completion_tokens: 4
                },
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop
                },
            ]
        );
    }

    #[tokio::test]
    async fn parses_tool_call_arguments() {
        let events = collect(vec![
            event(json!({
                "type": "response.output_item.added",
                "item": {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "verify_result",
                    "arguments": ""
                }
            })),
            event(json!({
                "type": "response.function_call_arguments.delta",
                "item_id": "fc_1",
                "delta": "{\"ok\":"
            })),
            event(json!({
                "type": "response.function_call_arguments.done",
                "item_id": "fc_1",
                "arguments": "{\"ok\":true}"
            })),
            event(json!({
                "type": "response.output_item.done",
                "item": {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "verify_result",
                    "arguments": "{\"ok\":true}"
                }
            })),
            event(json!({
                "type": "response.completed",
                "response": { "status": "completed" }
            })),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::ToolCallStart {
                    id: "call_1".into(),
                    name: "verify_result".into()
                },
                ChatEvent::ToolCallDelta {
                    id: "call_1".into(),
                    arguments_delta: "{\"ok\":".into()
                },
                ChatEvent::ToolCallDelta {
                    id: "call_1".into(),
                    arguments_delta: "true}".into()
                },
                ChatEvent::ToolCallEnd {
                    id: "call_1".into()
                },
                ChatEvent::Done {
                    finish_reason: FinishReason::ToolCalls
                },
            ]
        );
    }

    #[tokio::test]
    #[ignore]
    async fn live_codex_provider_responses_smoke_uses_dive_keyring() {
        let provider_config_id: i64 = std::env::var("DIVE_CODEX_PROVIDER_LIVE_CONFIG_ID")
            .expect("set DIVE_CODEX_PROVIDER_LIVE_CONFIG_ID")
            .parse()
            .expect("provider config id");
        let model = std::env::var("DIVE_CODEX_PROVIDER_LIVE_MODEL")
            .unwrap_or_else(|_| "gpt-5.5".to_string());
        let keyring = crate::auth::OsKeyring::new();
        let (access_token, refresh_token, id_token) =
            crate::auth::load_codex_tokens(&keyring, provider_config_id)
                .expect("keyring read")
                .expect("codex tokens");
        let account_id =
            crate::auth::codex_oauth::decode_account_id(&id_token).expect("id token account id");
        let provider = CodexProvider::new(
            CodexTokens {
                access_token,
                refresh_token,
                id_token,
                account_id,
                expires_in: 0,
            },
            CodexOAuth::new(),
        );
        let req = ChatRequest {
            model,
            messages: vec![super::super::Message::User {
                content: "Reply with exactly: DIVE_CODEX_DIRECT_SMOKE_OK".into(),
            }],
            tools: None,
            tool_choice: Some(super::super::ToolChoice::None),
            temperature: Some(0.0),
            max_tokens: Some(64),
            stream: true,
        };

        let mut stream = provider.chat(req).await.expect("codex provider chat");
        let mut text = String::new();
        while let Some(event) = stream.next().await {
            match event {
                ChatEvent::TextDelta(delta) => text.push_str(&delta),
                ChatEvent::Done { .. } => break,
                ChatEvent::Error(error) => panic!("codex stream error: {error}"),
                _ => {}
            }
        }

        assert!(
            text.contains("DIVE_CODEX_DIRECT_SMOKE_OK"),
            "unexpected smoke response: {text}"
        );
    }
}
