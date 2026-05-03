use std::sync::{Arc, Mutex};

use dive_lib::db::dao::{card, project, session};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};
use dive_lib::dive::{TestResult, VerifyEngine, VerifyError, VerifyLog};
use dive_lib::{ChatEvent, FinishReason, MockProvider};

fn seed(card_state: CardState) -> (Arc<Mutex<dive_lib::Database>>, i64, i64) {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = dive_lib::Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    Box::leak(Box::new(db_file));
    let pid = project::insert(
        db.conn(),
        &NewProject {
            name: "p".into(),
            path: "/tmp/p".into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let sid = session::insert(
        db.conn(),
        &NewSession {
            project_id: pid,
            title: "s".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    let cid = card::insert(
        db.conn(),
        &NewCard {
            session_id: sid,
            title: "add login form".into(),
            instruction: Some("LoginForm 컴포넌트에 이메일+비밀번호 필드 추가".into()),
            state: card_state,
            verify_log: None,
            changed_files: Some(serde_json::json!(["src/LoginForm.tsx", "src/App.tsx"])),
            position: 1,
        },
    )
    .unwrap();
    (Arc::new(Mutex::new(db)), sid, cid)
}

fn scripted_ok_response() -> Vec<ChatEvent> {
    vec![
        ChatEvent::ToolCallStart {
            id: "tc-1".into(),
            name: "verify_result".into(),
        },
        ChatEvent::ToolCallDelta {
            id: "tc-1".into(),
            arguments_delta: r#"{"intent_match":true,"test_result":"skipped","details":"LoginForm.tsx에 이메일/비밀번호 input이 추가되어 지시를 충족."}"#
                .into(),
        },
        ChatEvent::ToolCallEnd { id: "tc-1".into() },
        ChatEvent::Done {
            finish_reason: FinishReason::ToolCalls,
        },
    ]
}

fn scripted_fail_response() -> Vec<ChatEvent> {
    vec![
        ChatEvent::ToolCallStart {
            id: "tc-1".into(),
            name: "verify_result".into(),
        },
        ChatEvent::ToolCallDelta {
            id: "tc-1".into(),
            arguments_delta: r#"{"intent_match":false,"test_result":"fail","details":"지시와 코드 변경이 일치하지 않음"}"#
                .into(),
        },
        ChatEvent::ToolCallEnd { id: "tc-1".into() },
        ChatEvent::Done {
            finish_reason: FinishReason::ToolCalls,
        },
    ]
}

#[tokio::test]
async fn verify_success_writes_verify_log() {
    let (db, sid, cid) = seed(CardState::Verifying);
    let provider = Arc::new(MockProvider::new(vec![scripted_ok_response()]));
    let engine = VerifyEngine::new(provider, db.clone(), "mock-model".into());

    let log = engine.verify_card(sid, cid).await.unwrap();
    assert!(log.intent_match);
    assert_eq!(log.test_result, TestResult::Skipped);
    assert_eq!(log.model, "mock-model");
    assert!(log.details.contains("LoginForm"));
    assert!(log.ran_at > 0);

    let db = db.lock().unwrap();
    let row = dive_lib::db::dao::card::get_by_id(db.conn(), cid)
        .unwrap()
        .unwrap();
    let saved = row.verify_log.expect("verify_log persisted");
    let parsed = VerifyLog::from_json_str(&saved).unwrap();
    assert!(parsed.approve_eligible());
}

#[tokio::test]
async fn verify_rejects_wrong_state() {
    let (db, sid, cid) = seed(CardState::Instructed);
    let provider = Arc::new(MockProvider::new(vec![scripted_ok_response()]));
    let engine = VerifyEngine::new(provider, db, "mock-model".into());
    let err = engine.verify_card(sid, cid).await.unwrap_err();
    assert!(matches!(err, VerifyError::NotVerifying(_, _)));
}

#[tokio::test]
async fn verify_parses_failure_verdict() {
    let (db, sid, cid) = seed(CardState::Verifying);
    let provider = Arc::new(MockProvider::new(vec![scripted_fail_response()]));
    let engine = VerifyEngine::new(provider, db.clone(), "mock-model".into());

    let log = engine.verify_card(sid, cid).await.unwrap();
    assert!(!log.intent_match);
    assert_eq!(log.test_result, TestResult::Fail);
    assert!(!log.approve_eligible());
}

#[tokio::test]
async fn verify_missing_tool_call_errors() {
    let (db, sid, cid) = seed(CardState::Verifying);
    let provider = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("sorry no tool use".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let engine = VerifyEngine::new(provider, db, "mock-model".into());
    let err = engine.verify_card(sid, cid).await.unwrap_err();
    assert!(matches!(err, VerifyError::NoToolCall));
}

#[tokio::test]
async fn verify_invalid_json_errors() {
    let (db, sid, cid) = seed(CardState::Verifying);
    let provider = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::ToolCallStart {
            id: "tc-1".into(),
            name: "verify_result".into(),
        },
        ChatEvent::ToolCallDelta {
            id: "tc-1".into(),
            arguments_delta: "{ broken json".into(),
        },
        ChatEvent::ToolCallEnd { id: "tc-1".into() },
        ChatEvent::Done {
            finish_reason: FinishReason::ToolCalls,
        },
    ]]));
    let engine = VerifyEngine::new(provider, db, "mock-model".into());
    let err = engine.verify_card(sid, cid).await.unwrap_err();
    assert!(matches!(err, VerifyError::ParseLog(_)));
}

#[tokio::test]
async fn verify_missing_card_errors() {
    let (db, sid, _) = seed(CardState::Verifying);
    let provider = Arc::new(MockProvider::new(vec![scripted_ok_response()]));
    let engine = VerifyEngine::new(provider, db, "mock-model".into());
    let err = engine.verify_card(sid, 99_999).await.unwrap_err();
    assert!(matches!(err, VerifyError::CardNotFound(99_999)));
}

#[tokio::test]
async fn verify_sends_specific_tool_choice() {
    let (db, sid, cid) = seed(CardState::Verifying);
    let provider = Arc::new(MockProvider::new(vec![scripted_ok_response()]));
    let engine = VerifyEngine::new(provider.clone(), db, "mock-model".into());

    engine.verify_card(sid, cid).await.unwrap();
    let reqs = provider.requests_snapshot();
    assert_eq!(reqs.len(), 1);
    let req = &reqs[0];
    let tool_choice = req.tool_choice.as_ref().expect("tool_choice set");
    match tool_choice {
        dive_lib::ToolChoice::Specific(name) => assert_eq!(name, "verify_result"),
        other => panic!("expected Specific(verify_result), got {other:?}"),
    }
    let tools = req.tools.as_ref().expect("tools set");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "verify_result");
}
