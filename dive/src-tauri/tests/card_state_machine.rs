//! Task 3-1 — card state machine + I/V/E gate integration scenarios.

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use dive_lib::agent::{AgentError, AgentLoop, AlwaysApproveHook};
use dive_lib::db::dao::{card, message, project, session, workmap};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};
use dive_lib::dive::{
    apply_transition, CardTransition, DiveGateEngine, DiveStage, GateDecision, TransitionError,
};
use dive_lib::tools::{ToolContext, ToolRegistry};
use dive_lib::Database;
use dive_lib::{ChatEvent, FinishReason, MockProvider};

fn fresh_env() -> (
    Arc<Mutex<Database>>,
    tempfile::NamedTempFile,
    tempfile::TempDir,
    i64,
) {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let project_id = project::insert(
        db.conn(),
        &NewProject {
            name: "test".into(),
            path: project_root.path().to_string_lossy().into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let session_id = session::insert(
        db.conn(),
        &NewSession {
            project_id,
            title: "s".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    (Arc::new(Mutex::new(db)), db_file, project_root, session_id)
}

fn insert_card(
    db: &Arc<Mutex<Database>>,
    session_id: i64,
    state: CardState,
    instruction: Option<&str>,
    pos: i64,
) -> i64 {
    let guard = db.lock().unwrap();
    card::insert(
        guard.conn(),
        &NewCard {
            session_id,
            title: format!("card-{pos}"),
            instruction: instruction.map(str::to_string),
            state,
            verify_log: None,
            changed_files: None,
            test_command: None,
            position: pos,
        },
    )
    .unwrap()
}

#[test]
fn card_state_machine_valid_path_decomposed_to_extended() {
    let state = CardState::Decomposed;
    let state = apply_transition(state, CardTransition::EnterInstruct).unwrap();
    assert_eq!(state, CardState::Instructed);
    let state = apply_transition(state, CardTransition::RequestVerify).unwrap();
    assert_eq!(state, CardState::Verifying);
    let state = apply_transition(state, CardTransition::Approve).unwrap();
    assert_eq!(state, CardState::Verified);
    let state = apply_transition(state, CardTransition::Extend).unwrap();
    assert_eq!(state, CardState::Extended);
}

#[test]
fn card_state_machine_rejected_reopens_to_instructed() {
    let state = CardState::Verifying;
    let state = apply_transition(state, CardTransition::Reject).unwrap();
    assert_eq!(state, CardState::Rejected);
    let state = apply_transition(state, CardTransition::ReopenFromReject).unwrap();
    assert_eq!(state, CardState::Instructed);
}

#[test]
fn card_state_machine_rejects_illegal_transitions() {
    assert!(matches!(
        apply_transition(CardState::Decomposed, CardTransition::Approve).unwrap_err(),
        TransitionError::InvalidTransition { .. }
    ));
    assert!(matches!(
        apply_transition(CardState::Decomposed, CardTransition::Extend).unwrap_err(),
        TransitionError::InvalidTransition { .. }
    ));
    assert!(matches!(
        apply_transition(CardState::Verified, CardTransition::EnterInstruct).unwrap_err(),
        TransitionError::InvalidTransition { .. }
    ));
}

#[test]
fn i_gate_blocks_without_instruction() {
    let (db, _db_file, _root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Instructed, None, 1);
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let guard = db.lock().unwrap();
    let decision = DiveGateEngine::check_stage_i(guard.conn(), sid).unwrap();
    assert!(matches!(
        decision,
        GateDecision::Block {
            stage: DiveStage::I,
            ..
        }
    ));
}

#[test]
fn i_gate_allows_with_instruction() {
    let (db, _db_file, _root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Instructed, Some("do it"), 1);
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let guard = db.lock().unwrap();
    assert_eq!(
        DiveGateEngine::check_stage_i(guard.conn(), sid).unwrap(),
        GateDecision::Allow
    );
}

#[test]
fn v_gate_blocks_non_verifying_current_card() {
    let (db, _db_file, _root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Instructed, Some("x"), 1);
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let guard = db.lock().unwrap();
    let decision = DiveGateEngine::check_stage_v(guard.conn(), sid).unwrap();
    assert!(matches!(
        decision,
        GateDecision::Block {
            stage: DiveStage::V,
            ..
        }
    ));
}

#[test]
fn v_gate_allows_verifying_current_card() {
    let (db, _db_file, _root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Verifying, Some("x"), 1);
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let guard = db.lock().unwrap();
    assert_eq!(
        DiveGateEngine::check_stage_v(guard.conn(), sid).unwrap(),
        GateDecision::Allow
    );
}

#[test]
fn e_gate_blocks_when_any_card_unfinished() {
    let (db, _db_file, _root, sid) = fresh_env();
    insert_card(&db, sid, CardState::Verified, Some("x"), 1);
    insert_card(&db, sid, CardState::Instructed, Some("y"), 2);
    let guard = db.lock().unwrap();
    let decision = DiveGateEngine::check_stage_e(guard.conn(), sid).unwrap();
    assert!(matches!(
        decision,
        GateDecision::Block {
            stage: DiveStage::E,
            ..
        }
    ));
}

#[test]
fn e_gate_allows_when_all_cards_done() {
    let (db, _db_file, _root, sid) = fresh_env();
    insert_card(&db, sid, CardState::Verified, Some("x"), 1);
    insert_card(&db, sid, CardState::Extended, Some("y"), 2);
    let guard = db.lock().unwrap();
    assert_eq!(
        DiveGateEngine::check_stage_e(guard.conn(), sid).unwrap(),
        GateDecision::Allow
    );
}

#[tokio::test]
async fn agent_loop_blocks_i_when_current_card_has_no_instruction() {
    let (db, _db_file, root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Instructed, None, 1);
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("ignored".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = AgentLoop::builder()
        .provider(mock.clone())
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(3)
        .stage(DiveStage::I)
        .build()
        .unwrap();

    let mut events = Vec::new();
    let result = loop_.run(sid, "hi", &mut |e| events.push(e)).await;
    assert!(
        matches!(result, Err(AgentError::GateBlocked { ref stage, .. }) if stage == "I"),
        "expected I GateBlocked, got {result:?}"
    );
    assert_eq!(mock.request_count(), 0);
}

#[tokio::test]
async fn agent_loop_injects_current_card_system_prompt() {
    let (db, _db_file, root, sid) = fresh_env();
    let cid = insert_card(
        &db,
        sid,
        CardState::Instructed,
        Some("implement login form"),
        1,
    );
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("ok".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = AgentLoop::builder()
        .provider(mock.clone())
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(3)
        .stage(DiveStage::I)
        .build()
        .unwrap();

    let mut events = Vec::new();
    loop_
        .run(sid, "write the form", &mut |e| events.push(e))
        .await
        .unwrap();
    assert_eq!(mock.request_count(), 1);

    let request = mock
        .requests_snapshot()
        .into_iter()
        .next()
        .expect("expected request");
    let system_content = request
        .messages
        .iter()
        .find_map(|m| match m {
            dive_lib::Message::System { content } => Some(content.clone()),
            _ => None,
        })
        .expect("expected system prompt injection");
    assert!(
        system_content.contains("현재 작업 중인 카드"),
        "system prompt should mention current card, got: {system_content}"
    );
    assert!(system_content.contains("card-1"));
    assert!(system_content.contains("implement login form"));
}

#[tokio::test]
async fn agent_loop_persists_user_message_with_card_id() {
    let (db, _db_file, root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Instructed, Some("x"), 1);
    {
        let guard = db.lock().unwrap();
        workmap::set_current_card(guard.conn(), sid, Some(cid)).unwrap();
    }
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("ok".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(3)
        .stage(DiveStage::I)
        .build()
        .unwrap();
    let mut events = Vec::new();
    loop_.run(sid, "hi", &mut |e| events.push(e)).await.unwrap();

    let guard = db.lock().unwrap();
    let msgs = message::list_by_session(guard.conn(), sid, 10).unwrap();
    let user_msg = msgs.iter().find(|m| m.role == "user").unwrap();
    assert_eq!(user_msg.card_id, Some(cid));
    let assistant_msg = msgs.iter().find(|m| m.role == "assistant").unwrap();
    assert_eq!(assistant_msg.card_id, Some(cid));
}
