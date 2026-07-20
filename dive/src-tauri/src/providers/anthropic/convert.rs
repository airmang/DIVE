use serde_json::{json, Map, Value};

use crate::providers::{ChatRequest, Message, ProviderError};

pub fn to_anthropic_payload(req: &ChatRequest) -> Result<Value, ProviderError> {
    let mut system = Vec::new();
    let mut messages = Vec::new();

    for message in &req.messages {
        match message {
            Message::System { content } => system.push(content.clone()),
            Message::User { content } => messages.push(json!({"role": "user", "content": content})),
            Message::Assistant {
                content,
                tool_calls,
                ..
            } => {
                let mut blocks = Vec::new();
                if !content.is_empty() {
                    blocks.push(json!({"type": "text", "text": content}));
                }
                for call in tool_calls.as_deref().unwrap_or(&[]) {
                    let input = serde_json::from_str::<Value>(&call.arguments)?;
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": input,
                    }));
                }
                messages.push(json!({"role": "assistant", "content": blocks}));
            }
            Message::Tool {
                content,
                tool_call_id,
            } => messages.push(json!({
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": tool_call_id, "content": content}],
            })),
        }
    }

    let mut payload = Map::new();
    payload.insert("model".to_string(), json!(req.model));
    payload.insert("messages".to_string(), Value::Array(messages));
    payload.insert(
        "max_tokens".to_string(),
        json!(req.max_tokens.unwrap_or(4096)),
    );
    payload.insert("stream".to_string(), json!(true));

    if !system.is_empty() {
        payload.insert("system".to_string(), json!(system.join("\n\n")));
    }
    if let Some(temperature) = req.temperature {
        payload.insert("temperature".to_string(), json!(temperature));
    }
    if let Some(tools) = &req.tools {
        payload.insert(
            "tools".to_string(),
            Value::Array(
                tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.parameters,
                        })
                    })
                    .collect(),
            ),
        );
    }

    Ok(Value::Object(payload))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::providers::{ToolCall, ToolDef};

    fn base(messages: Vec<Message>) -> ChatRequest {
        ChatRequest {
            model: "claude-sonnet-4.5".to_string(),
            messages,
            tools: None,
            tool_choice: None,
            temperature: None,
            max_tokens: None,
        }
    }

    #[test]
    fn separates_system_messages() {
        let payload = to_anthropic_payload(&base(vec![
            Message::System {
                content: "A".into(),
            },
            Message::System {
                content: "B".into(),
            },
            Message::User {
                content: "Hi".into(),
            },
        ]))
        .expect("payload");

        assert_eq!(payload["system"], json!("A\n\nB"));
        assert_eq!(payload["messages"][0]["role"], json!("user"));
        assert_eq!(payload["max_tokens"], json!(4096));
    }

    #[test]
    fn converts_assistant_tool_calls() {
        let payload = to_anthropic_payload(&base(vec![Message::Assistant {
            content: "".into(),
            reasoning_content: None,
            tool_calls: Some(vec![ToolCall {
                id: "toolu_1".into(),
                name: "search".into(),
                arguments: r#"{"q":"rust"}"#.into(),
            }]),
        }]))
        .expect("payload");

        assert_eq!(
            payload["messages"][0]["content"][0]["type"],
            json!("tool_use")
        );
        assert_eq!(
            payload["messages"][0]["content"][0]["input"],
            json!({"q":"rust"})
        );
    }

    #[test]
    fn converts_tool_results_and_tool_defs() {
        let mut req = base(vec![Message::Tool {
            content: "done".into(),
            tool_call_id: "toolu_1".into(),
        }]);
        req.tools = Some(vec![ToolDef {
            name: "search".into(),
            description: "Search".into(),
            parameters: json!({"type":"object"}),
        }]);

        let payload = to_anthropic_payload(&req).expect("payload");
        assert_eq!(payload["messages"][0]["role"], json!("user"));
        assert_eq!(
            payload["messages"][0]["content"][0]["type"],
            json!("tool_result")
        );
        assert_eq!(
            payload["tools"][0]["input_schema"],
            json!({"type":"object"})
        );
    }
}
