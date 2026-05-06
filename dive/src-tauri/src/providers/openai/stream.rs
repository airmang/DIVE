use std::collections::{HashMap, HashSet};

use futures::{stream, Stream, StreamExt};
use serde::Deserialize;

use crate::providers::{sse::SseEvent, ChatEvent, FinishReason, ProviderError};

#[derive(Default)]
struct OpenAiState {
    tool_ids: HashMap<u32, String>,
    ended_tools: HashSet<String>,
    /// Track whether we have already emitted a `Done` event for this stream so
    /// the `[DONE]` sentinel fallback does not produce a duplicate.
    done_emitted: bool,
    /// Track whether we have observed any tool_call chunks so the `[DONE]`
    /// fallback can emit `ToolCalls` instead of `Stop` when the provider
    /// forgot to send `finish_reason`.
    saw_tool_call: bool,
}

pub fn parse_openai_events<S>(events: S) -> impl Stream<Item = ChatEvent>
where
    S: Stream<Item = Result<SseEvent, ProviderError>> + Send + 'static,
{
    events
        .scan(OpenAiState::default(), |state, item| {
            let output = match item {
                Ok(event) => handle_event(state, &event.data),
                Err(error) => vec![ChatEvent::Error(error.to_string())],
            };
            async move { Some(output) }
        })
        .flat_map(stream::iter)
}

fn handle_event(state: &mut OpenAiState, data: &str) -> Vec<ChatEvent> {
    if data.trim() == "[DONE]" {
        // Some OpenAI-compatible servers (e.g. certain self-hosted gateways)
        // send `[DONE]` without ever producing a `finish_reason`. Without a
        // fallback the caller would block on a stream that never emits
        // `ChatEvent::Done`, which breaks prompt_check and the assistant
        // loop downstream. Emit a synthetic terminator in that case.
        if state.done_emitted {
            return Vec::new();
        }
        state.done_emitted = true;
        let finish_reason = if state.saw_tool_call {
            FinishReason::ToolCalls
        } else {
            FinishReason::Stop
        };
        let mut output = Vec::new();
        if finish_reason == FinishReason::ToolCalls {
            let mut ids = state.tool_ids.values().cloned().collect::<Vec<_>>();
            ids.sort();
            for id in ids {
                if state.ended_tools.insert(id.clone()) {
                    output.push(ChatEvent::ToolCallEnd { id });
                }
            }
        }
        output.push(ChatEvent::Done { finish_reason });
        return output;
    }

    let parsed = serde_json::from_str::<Chunk>(data);
    let Ok(chunk) = parsed else {
        return vec![ChatEvent::Error(format!("invalid OpenAI SSE JSON: {data}"))];
    };

    let mut output = Vec::new();
    for choice in chunk.choices {
        if let Some(content) = choice.delta.content {
            if !content.is_empty() {
                output.push(ChatEvent::TextDelta(content));
            }
        }

        for tool_call in choice.delta.tool_calls.unwrap_or_default() {
            state.saw_tool_call = true;
            if let Some(id) = tool_call.id {
                if let Some(function) = &tool_call.function {
                    if let Some(name) = &function.name {
                        state.tool_ids.insert(tool_call.index, id.clone());
                        output.push(ChatEvent::ToolCallStart {
                            id,
                            name: name.clone(),
                        });
                    }
                }
            }

            if let Some(function) = tool_call.function {
                if let Some(arguments) = function.arguments {
                    if let Some(id) = state.tool_ids.get(&tool_call.index) {
                        output.push(ChatEvent::ToolCallDelta {
                            id: id.clone(),
                            arguments_delta: arguments,
                        });
                    }
                }
            }
        }

        if let Some(reason) = choice.finish_reason {
            let finish_reason = map_finish_reason(&reason);
            if finish_reason == FinishReason::ToolCalls {
                let mut ids = state.tool_ids.values().cloned().collect::<Vec<_>>();
                ids.sort();
                for id in ids {
                    if state.ended_tools.insert(id.clone()) {
                        output.push(ChatEvent::ToolCallEnd { id });
                    }
                }
            }
            output.push(ChatEvent::Done { finish_reason });
            state.done_emitted = true;
        }
    }

    if let Some(usage) = chunk.usage {
        output.push(ChatEvent::Usage {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
        });
    }

    output
}

fn map_finish_reason(reason: &str) -> FinishReason {
    match reason {
        "stop" => FinishReason::Stop,
        "length" => FinishReason::Length,
        "tool_calls" | "function_call" => FinishReason::ToolCalls,
        "content_filter" => FinishReason::ContentFilter,
        _ => FinishReason::Error,
    }
}

#[derive(Deserialize)]
struct Chunk {
    #[serde(default)]
    choices: Vec<Choice>,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Delta,
    finish_reason: Option<String>,
}

#[derive(Default, Deserialize)]
struct Delta {
    content: Option<String>,
    tool_calls: Option<Vec<ToolCallDelta>>,
}

#[derive(Deserialize)]
struct ToolCallDelta {
    index: u32,
    id: Option<String>,
    function: Option<FunctionDelta>,
}

#[derive(Deserialize)]
struct FunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;

    use super::*;

    fn event(data: serde_json::Value) -> Result<SseEvent, ProviderError> {
        Ok(SseEvent {
            event: "message".into(),
            data: data.to_string(),
            id: String::new(),
        })
    }

    async fn collect(items: Vec<Result<SseEvent, ProviderError>>) -> Vec<ChatEvent> {
        parse_openai_events(stream::iter(items)).collect().await
    }

    #[tokio::test]
    async fn parses_text_only_chunks() {
        let events = collect(vec![
            event(serde_json::json!({"choices":[{"delta":{"content":"Hel"},"finish_reason":null}],"usage":null})),
            event(serde_json::json!({"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":null})),
            Ok(SseEvent { event: "message".into(), data: "[DONE]".into(), id: String::new() }),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::TextDelta("Hel".into()),
                ChatEvent::TextDelta("lo".into()),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop
                },
            ]
        );
    }

    #[tokio::test]
    async fn parses_tool_call_chunks() {
        let events = collect(vec![
            event(serde_json::json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":"{\"q\":"}}]},"finish_reason":null}],"usage":null})),
            event(serde_json::json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"rust\"}"}}]},"finish_reason":"tool_calls"}],"usage":null})),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::ToolCallStart {
                    id: "call_1".into(),
                    name: "search".into()
                },
                ChatEvent::ToolCallDelta {
                    id: "call_1".into(),
                    arguments_delta: "{\"q\":".into()
                },
                ChatEvent::ToolCallDelta {
                    id: "call_1".into(),
                    arguments_delta: "\"rust\"}".into()
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
    async fn parses_usage_and_finish() {
        let events = collect(vec![event(serde_json::json!({
            "choices":[{"delta":{},"finish_reason":"length"}],
            "usage":{"prompt_tokens":7,"completion_tokens":9}
        }))])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::Done {
                    finish_reason: FinishReason::Length
                },
                ChatEvent::Usage {
                    prompt_tokens: 7,
                    completion_tokens: 9
                },
            ]
        );
    }

    #[tokio::test]
    async fn bare_done_with_no_finish_reason_emits_stop_fallback() {
        let events = collect(vec![
            event(serde_json::json!({
                "choices":[{"delta":{"content":"hi"},"finish_reason":null}],
                "usage":null
            })),
            Ok(SseEvent {
                event: "message".into(),
                data: "[DONE]".into(),
                id: String::new(),
            }),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::TextDelta("hi".into()),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ]
        );
    }

    #[tokio::test]
    async fn empty_chunk_then_bare_done_still_terminates() {
        let events = collect(vec![
            event(serde_json::json!({
                "choices":[{"delta":{},"finish_reason":null}],
                "usage":null
            })),
            Ok(SseEvent {
                event: "message".into(),
                data: "[DONE]".into(),
                id: String::new(),
            }),
        ])
        .await;

        assert_eq!(
            events,
            vec![ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            }]
        );
    }

    #[tokio::test]
    async fn done_after_finish_reason_does_not_duplicate() {
        let events = collect(vec![
            event(serde_json::json!({
                "choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],
                "usage":null
            })),
            Ok(SseEvent {
                event: "message".into(),
                data: "[DONE]".into(),
                id: String::new(),
            }),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::TextDelta("ok".into()),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ]
        );
    }

    #[tokio::test]
    async fn bare_done_after_tool_call_chunks_uses_tool_calls_finish() {
        let events = collect(vec![
            event(serde_json::json!({
                "choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"x","arguments":"{}"}}]},"finish_reason":null}],
                "usage":null
            })),
            Ok(SseEvent {
                event: "message".into(),
                data: "[DONE]".into(),
                id: String::new(),
            }),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::ToolCallStart {
                    id: "c1".into(),
                    name: "x".into(),
                },
                ChatEvent::ToolCallDelta {
                    id: "c1".into(),
                    arguments_delta: "{}".into(),
                },
                ChatEvent::ToolCallEnd { id: "c1".into() },
                ChatEvent::Done {
                    finish_reason: FinishReason::ToolCalls,
                },
            ]
        );
    }
}
