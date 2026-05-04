use std::sync::Arc;

use dive_lib::dive::{PromptCheckEngine, PromptCheckError};
use dive_lib::{ChatEvent, FinishReason, MockProvider};

fn ok_response(refined: &str, issues_json: &str) -> Vec<ChatEvent> {
    let body = format!(r#"{{"issues": {issues_json}, "refined_text": "{refined}"}}"#);
    vec![
        ChatEvent::ToolCallStart {
            id: "tc-1".into(),
            name: "prompt_review".into(),
        },
        ChatEvent::ToolCallDelta {
            id: "tc-1".into(),
            arguments_delta: body,
        },
        ChatEvent::ToolCallEnd { id: "tc-1".into() },
        ChatEvent::Usage {
            prompt_tokens: 120,
            completion_tokens: 48,
        },
        ChatEvent::Done {
            finish_reason: FinishReason::ToolCalls,
        },
    ]
}

#[tokio::test]
async fn review_parses_issues_and_refined_text() {
    let provider = Arc::new(MockProvider::new(vec![ok_response(
        "App.tsx의 타이틀을 '안녕'으로 변경해 주세요",
        r#"[{"kind":"pronoun","excerpt":"이거","suggestion":"대상을 구체적으로"}]"#,
    )]));
    let engine = PromptCheckEngine::new(provider, "mock-model".into());
    let result = engine.review("이거 바꿔줘", Some("I")).await.unwrap();
    assert_eq!(result.issues.len(), 1);
    assert_eq!(result.issues[0].kind, "pronoun");
    assert_eq!(result.issues[0].excerpt, "이거");
    assert_eq!(
        result.refined_text,
        "App.tsx의 타이틀을 '안녕'으로 변경해 주세요"
    );
    assert_eq!(result.approximate_tokens, 168);
}

#[tokio::test]
async fn review_empty_prompt_errors() {
    let provider = Arc::new(MockProvider::new(vec![]));
    let engine = PromptCheckEngine::new(provider, "mock-model".into());
    let err = engine.review("   ", None).await.unwrap_err();
    assert!(matches!(err, PromptCheckError::EmptyPrompt));
}

#[tokio::test]
async fn review_without_model_errors() {
    let provider = Arc::new(MockProvider::new(vec![]));
    let engine = PromptCheckEngine::new(provider, String::new());
    let err = engine.review("hi", None).await.unwrap_err();
    assert!(matches!(err, PromptCheckError::NoModel));
}

#[tokio::test]
async fn review_without_tool_call_errors() {
    let provider = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("no tool used".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let engine = PromptCheckEngine::new(provider, "mock-model".into());
    let err = engine.review("이거 바꿔줘", None).await.unwrap_err();
    assert!(matches!(err, PromptCheckError::NoToolCall));
}

#[tokio::test]
async fn review_includes_span_when_provided() {
    let provider = Arc::new(MockProvider::new(vec![ok_response(
        "...",
        r#"[{"kind":"pronoun","span":[0,2],"excerpt":"이거","suggestion":"x"}]"#,
    )]));
    let engine = PromptCheckEngine::new(provider, "mock-model".into());
    let result = engine.review("이거 바꿔줘", None).await.unwrap();
    assert_eq!(result.issues[0].span, Some([0, 2]));
}

#[tokio::test]
async fn review_handles_empty_issues_array() {
    let provider = Arc::new(MockProvider::new(vec![ok_response(
        "이미 명확합니다",
        "[]",
    )]));
    let engine = PromptCheckEngine::new(provider, "mock-model".into());
    let result = engine
        .review("App.tsx 의 title을 '안녕'으로 설정", None)
        .await
        .unwrap();
    assert_eq!(result.issues.len(), 0);
    assert_eq!(result.refined_text, "이미 명확합니다");
}
