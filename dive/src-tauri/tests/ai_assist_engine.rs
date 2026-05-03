use std::sync::Arc;

use dive_lib::dive::{AiAssistEngine, AssistError};
use dive_lib::{ChatEvent, FinishReason, MockProvider};

fn ok_response() -> Vec<ChatEvent> {
    vec![
        ChatEvent::ToolCallStart {
            id: "tc-1".into(),
            name: "assist_cards".into(),
        },
        ChatEvent::ToolCallDelta {
            id: "tc-1".into(),
            arguments_delta: r#"{"cards":[{"title":"입력 폼","summary":"이메일/비밀번호 input"},{"title":"버튼","summary":"제출 버튼 추가"},{"title":"검증","summary":"빈 값 체크"}]}"#.into(),
        },
        ChatEvent::ToolCallEnd { id: "tc-1".into() },
        ChatEvent::Done {
            finish_reason: FinishReason::ToolCalls,
        },
    ]
}

#[tokio::test]
async fn assist_returns_cards() {
    let provider = Arc::new(MockProvider::new(vec![ok_response()]));
    let engine = AiAssistEngine::new(provider, "mock-model".into());
    let cards = engine.suggest_cards("로그인 폼 만들기").await.unwrap();
    assert_eq!(cards.len(), 3);
    assert_eq!(cards[0].title, "입력 폼");
    assert!(cards[0].summary.contains("이메일"));
}

#[tokio::test]
async fn assist_errors_when_no_tool_call() {
    let provider = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("sorry".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let engine = AiAssistEngine::new(provider, "mock-model".into());
    let err = engine.suggest_cards("x").await.unwrap_err();
    assert!(matches!(err, AssistError::NoToolCall));
}

#[tokio::test]
async fn assist_errors_on_bad_json() {
    let provider = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::ToolCallStart {
            id: "tc-1".into(),
            name: "assist_cards".into(),
        },
        ChatEvent::ToolCallDelta {
            id: "tc-1".into(),
            arguments_delta: "{ broken".into(),
        },
        ChatEvent::ToolCallEnd { id: "tc-1".into() },
        ChatEvent::Done {
            finish_reason: FinishReason::ToolCalls,
        },
    ]]));
    let engine = AiAssistEngine::new(provider, "mock-model".into());
    let err = engine.suggest_cards("x").await.unwrap_err();
    assert!(matches!(err, AssistError::ParseArgs(_)));
}
