use futures::{stream, Stream, StreamExt};
use serde::Deserialize;

use crate::providers::{sse::SseEvent, ChatEvent, FinishReason, ProviderError};

#[derive(Default)]
struct AnthropicState {
    blocks: std::collections::HashMap<u32, BlockState>,
    prompt_tokens: u32,
    completion_tokens: u32,
    finish_reason: FinishReason,
}

enum BlockState {
    Text,
    Tool { id: String },
}

pub fn parse_anthropic_events<S>(events: S) -> impl Stream<Item = ChatEvent>
where
    S: Stream<Item = Result<SseEvent, ProviderError>> + Send + 'static,
{
    events
        .scan(AnthropicState::default(), |state, item| {
            let output = match item {
                Ok(event) => handle_event(state, &event.data),
                Err(error) => vec![ChatEvent::Error(error.to_string())],
            };
            async move { Some(output) }
        })
        .flat_map(stream::iter)
}

fn handle_event(state: &mut AnthropicState, data: &str) -> Vec<ChatEvent> {
    let parsed = serde_json::from_str::<AnthropicEvent>(data);
    let Ok(event) = parsed else {
        return vec![ChatEvent::Error(format!(
            "invalid Anthropic SSE JSON: {data}"
        ))];
    };

    match event {
        AnthropicEvent::MessageStart { message } => {
            if let Some(usage) = message.usage {
                state.prompt_tokens = usage.input_tokens.unwrap_or(0);
            }
            Vec::new()
        }
        AnthropicEvent::ContentBlockStart {
            index,
            content_block,
        } => match content_block {
            ContentBlock::Text { .. } => {
                state.blocks.insert(index, BlockState::Text);
                Vec::new()
            }
            ContentBlock::ToolUse { id, name, .. } => {
                state
                    .blocks
                    .insert(index, BlockState::Tool { id: id.clone() });
                vec![ChatEvent::ToolCallStart { id, name }]
            }
        },
        AnthropicEvent::ContentBlockDelta { index, delta } => match delta {
            Delta::TextDelta { text, .. } => vec![ChatEvent::TextDelta(text)],
            Delta::InputJsonDelta { partial_json, .. } => match state.blocks.get(&index) {
                Some(BlockState::Tool { id }) => vec![ChatEvent::ToolCallDelta {
                    id: id.clone(),
                    arguments_delta: partial_json,
                }],
                _ => Vec::new(),
            },
        },
        AnthropicEvent::ContentBlockStop { index } => match state.blocks.remove(&index) {
            Some(BlockState::Tool { id }) => vec![ChatEvent::ToolCallEnd { id }],
            _ => Vec::new(),
        },
        AnthropicEvent::MessageDelta { delta, usage } => {
            let mut output = Vec::new();
            if let Some(output_tokens) = usage.and_then(|usage| usage.output_tokens) {
                state.completion_tokens = output_tokens;
                output.push(ChatEvent::Usage {
                    prompt_tokens: state.prompt_tokens,
                    completion_tokens: state.completion_tokens,
                });
            }
            if let Some(stop_reason) = delta.stop_reason {
                state.finish_reason = map_stop_reason(&stop_reason);
            }
            output
        }
        AnthropicEvent::MessageStop => vec![ChatEvent::Done {
            finish_reason: state.finish_reason,
        }],
        AnthropicEvent::Other => Vec::new(),
    }
}

fn map_stop_reason(reason: &str) -> FinishReason {
    match reason {
        "end_turn" | "stop_sequence" => FinishReason::Stop,
        "max_tokens" => FinishReason::Length,
        "tool_use" => FinishReason::ToolCalls,
        _ => FinishReason::Error,
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicEvent {
    MessageStart {
        message: MessageStart,
    },
    ContentBlockStart {
        index: u32,
        content_block: ContentBlock,
    },
    ContentBlockDelta {
        index: u32,
        delta: Delta,
    },
    ContentBlockStop {
        index: u32,
    },
    MessageDelta {
        delta: MessageDelta,
        usage: Option<UsageDelta>,
    },
    MessageStop,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct MessageStart {
    usage: Option<UsageDelta>,
}

#[derive(Deserialize)]
struct UsageDelta {
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct MessageDelta {
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ContentBlock {
    Text {},
    ToolUse { id: String, name: String },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Delta {
    TextDelta { text: String },
    InputJsonDelta { partial_json: String },
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
        parse_anthropic_events(stream::iter(items)).collect().await
    }

    #[tokio::test]
    async fn parses_text_only_stream() {
        let events = collect(vec![
            event(serde_json::json!({"type":"message_start","message":{"usage":{"input_tokens":3}}})),
            event(serde_json::json!({"type":"content_block_start","index":0,"content_block":{"type":"text"}})),
            event(serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}})),
            event(serde_json::json!({"type":"content_block_stop","index":0})),
            event(serde_json::json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}})),
            event(serde_json::json!({"type":"message_stop"})),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::TextDelta("Hi".into()),
                ChatEvent::Usage {
                    prompt_tokens: 3,
                    completion_tokens: 2
                },
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop
                },
            ]
        );
    }

    #[tokio::test]
    async fn parses_tool_use_stream() {
        let events = collect(vec![
            event(serde_json::json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"search"}})),
            event(serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"q\":"}})),
            event(serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"rust\"}"}})),
            event(serde_json::json!({"type":"content_block_stop","index":0})),
            event(serde_json::json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}})),
            event(serde_json::json!({"type":"message_stop"})),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::ToolCallStart {
                    id: "toolu_1".into(),
                    name: "search".into()
                },
                ChatEvent::ToolCallDelta {
                    id: "toolu_1".into(),
                    arguments_delta: "{\"q\":".into()
                },
                ChatEvent::ToolCallDelta {
                    id: "toolu_1".into(),
                    arguments_delta: "\"rust\"}".into()
                },
                ChatEvent::ToolCallEnd {
                    id: "toolu_1".into()
                },
                ChatEvent::Usage {
                    prompt_tokens: 0,
                    completion_tokens: 5
                },
                ChatEvent::Done {
                    finish_reason: FinishReason::ToolCalls
                },
            ]
        );
    }

    #[tokio::test]
    async fn parses_multiple_tool_uses() {
        let events = collect(vec![
            event(serde_json::json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"a","name":"one"}})),
            event(serde_json::json!({"type":"content_block_stop","index":0})),
            event(serde_json::json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"b","name":"two"}})),
            event(serde_json::json!({"type":"content_block_stop","index":1})),
        ])
        .await;

        assert_eq!(
            events,
            vec![
                ChatEvent::ToolCallStart {
                    id: "a".into(),
                    name: "one".into()
                },
                ChatEvent::ToolCallEnd { id: "a".into() },
                ChatEvent::ToolCallStart {
                    id: "b".into(),
                    name: "two".into()
                },
                ChatEvent::ToolCallEnd { id: "b".into() },
            ]
        );
    }
}
