use dive_lib::{
    AnthropicProvider, ChatEvent, ChatRequest, FinishReason, LlmProvider, Message, OpenAiProvider,
    ProviderError,
};
use futures::StreamExt;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

fn request(model: &str) -> ChatRequest {
    ChatRequest {
        model: model.to_string(),
        messages: vec![Message::User {
            content: "hello".to_string(),
        }],
        tools: None,
        tool_choice: None,
        temperature: None,
        max_tokens: Some(128),
    }
}

#[tokio::test]
async fn anthropic_integration_test() {
    let server = MockServer::start().await;
    let body = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":4}}}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"search\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\"}}\n\n",
        "event: content_block_delta\n",
        "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"rust\\\"}\"}}\n\n",
        "event: content_block_stop\n",
        "data: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":6}}\n\n",
        "event: message_stop\n",
        "data: {\"type\":\"message_stop\"}\n\n"
    );
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(body),
        )
        .mount(&server)
        .await;

    let provider = AnthropicProvider::new("test-key".into()).with_base_url(server.uri());
    let events = provider
        .chat(request("claude-sonnet-4.5"))
        .await
        .expect("stream")
        .collect::<Vec<_>>()
        .await;

    assert_eq!(
        events,
        vec![
            ChatEvent::TextDelta("Hi ".into()),
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
                prompt_tokens: 4,
                completion_tokens: 6
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls
            },
        ]
    );
}

#[tokio::test]
async fn openai_integration_test() {
    let server = MockServer::start().await;
    let body = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"},\"finish_reason\":null}],\"usage\":null}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\"}}]},\"finish_reason\":null}],\"usage\":null}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"rust\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}],\"usage\":null}\n\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":7}}\n\n",
        "data: [DONE]\n\n"
    );
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(body),
        )
        .mount(&server)
        .await;

    let provider = OpenAiProvider::new("test-key".into()).with_base_url(server.uri());
    let events = provider
        .chat(request("gpt-5.2"))
        .await
        .expect("stream")
        .collect::<Vec<_>>()
        .await;

    assert_eq!(
        events,
        vec![
            ChatEvent::TextDelta("Hi".into()),
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
            // S-064: OpenAI streams the usage-only chunk after the finish chunk;
            // the parser now emits Usage before Done so a Done-breaking consumer
            // (e.g. prompt_check) still counts tokens.
            ChatEvent::Usage {
                prompt_tokens: 5,
                completion_tokens: 7
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls
            },
        ]
    );
}

#[tokio::test]
async fn error_integration_test() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(500).set_body_string("server exploded"))
        .mount(&server)
        .await;

    let provider = OpenAiProvider::new("test-key".into()).with_base_url(server.uri());
    let error = match provider.chat(request("gpt-5.2")).await {
        Ok(_) => panic!("expected api error"),
        Err(error) => error,
    };

    match error {
        ProviderError::Api { status, body } => {
            assert_eq!(status, 500);
            assert_eq!(body, "server exploded");
        }
        other => panic!("unexpected error: {other:?}"),
    }
}
