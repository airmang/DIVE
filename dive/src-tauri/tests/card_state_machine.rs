//! Task 3-1 — card state machine + plan-first agent integration scenarios.

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use dive_lib::agent::{AgentLoop, AlwaysApproveHook, StepContext};
use dive_lib::db::dao::{card, message, project, session, workmap};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};
use dive_lib::dive::{
    apply_transition, ApprovalJudgment, ApprovalOutcome, CardTransition, TestResult,
    TransitionError, VerifyLog,
};
use dive_lib::ipc::card_transition_no_checkpoint_impl;
use dive_lib::tools::{ToolContext, ToolRegistry};
use dive_lib::{AppState, Database};
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
            assist_summary: None,
            acceptance_criteria: None,
            retrospective: None,
            change_summary: None,
            state,
            verify_log: None,
            changed_files: None,
            test_command: None,
            approval_judgment: None,
            approval_provenance: None,
            position: pos,
        },
    )
    .unwrap()
}

fn setup_verifying_card_with_passing_log() -> (AppState, i64) {
    let state = AppState::dev_mock();
    let session_id = {
        let guard = state.db.lock().unwrap();
        let project_id = project::insert(
            guard.conn(),
            &NewProject {
                name: "judgment-test".into(),
                path: ".".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        session::insert(
            guard.conn(),
            &NewSession {
                project_id,
                title: "judgment session".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap()
    };
    let card_id = insert_card(
        &state.db,
        session_id,
        CardState::Verifying,
        Some("verify this"),
        1,
    );
    let log = VerifyLog {
        intent_match: true,
        test_result: TestResult::Pass,
        details: "ok".into(),
        model: "mock".into(),
        ran_at: 1,
        test_command: Some("pnpm test".into()),
        test_exit_code: Some(0),
        test_stdout: None,
        test_stderr: None,
    };
    {
        let guard = state.db.lock().unwrap();
        let mut row = card::get_by_id(guard.conn(), card_id).unwrap().unwrap();
        row.verify_log = Some(log.to_json_string());
        card::update(
            guard.conn(),
            card_id,
            &NewCard {
                session_id: row.session_id,
                title: row.title,
                instruction: row.instruction,
                assist_summary: row.assist_summary,
                acceptance_criteria: row.acceptance_criteria,
                retrospective: row.retrospective,
                change_summary: row.change_summary,
                state: row.state,
                verify_log: row.verify_log,
                changed_files: row.changed_files,
                test_command: row.test_command,
                approval_judgment: row.approval_judgment,
                approval_provenance: row.approval_provenance,
                position: row.position,
            },
        )
        .unwrap();
    }
    (state, card_id)
}

fn load_card(state: &AppState, card_id: i64) -> dive_lib::db::models::CardRow {
    let guard = state.db.lock().unwrap();
    card::get_by_id(guard.conn(), card_id).unwrap().unwrap()
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
fn approve_without_judgment_is_rejected_when_required() {
    let (state, card_id) = setup_verifying_card_with_passing_log();
    let err =
        card_transition_no_checkpoint_impl(&state, card_id, CardTransition::Approve, None, None)
            .unwrap_err();
    assert!(err.contains("judgment required"));
}

#[test]
fn approve_with_confirmed_judgment_persists_and_transitions() {
    let (state, card_id) = setup_verifying_card_with_passing_log();
    let j = ApprovalJudgment {
        outcome: ApprovalOutcome::Approved,
        note: None,
        decided_at: 1,
    };
    let next =
        card_transition_no_checkpoint_impl(&state, card_id, CardTransition::Approve, None, Some(j))
            .unwrap();
    assert_eq!(next, CardState::Verified);
    let stored = load_card(&state, card_id).approval_judgment.unwrap();
    assert!(stored.contains("\"outcome\":\"approved\""));
}

#[test]
fn revision_requested_requires_note_and_rejects_card() {
    let (state, card_id) = setup_verifying_card_with_passing_log();
    let j = ApprovalJudgment {
        outcome: ApprovalOutcome::RevisionRequested,
        note: Some("입력 검증 빠짐".into()),
        decided_at: 1,
    };
    let next =
        card_transition_no_checkpoint_impl(&state, card_id, CardTransition::Reject, None, Some(j))
            .unwrap();
    assert_eq!(next, CardState::Rejected);
}

#[test]
fn duplicate_revision_request_from_rejected_is_idempotent() {
    let (state, card_id) = setup_verifying_card_with_passing_log();
    let first = ApprovalJudgment {
        outcome: ApprovalOutcome::RevisionRequested,
        note: Some("needs changes".into()),
        decided_at: 1,
    };
    let next = card_transition_no_checkpoint_impl(
        &state,
        card_id,
        CardTransition::Reject,
        None,
        Some(first),
    )
    .unwrap();
    assert_eq!(next, CardState::Rejected);

    let duplicate = ApprovalJudgment {
        outcome: ApprovalOutcome::RevisionRequested,
        note: Some("still needs changes".into()),
        decided_at: 2,
    };
    let next = card_transition_no_checkpoint_impl(
        &state,
        card_id,
        CardTransition::Reject,
        None,
        Some(duplicate),
    )
    .unwrap();
    assert_eq!(next, CardState::Rejected);
}

#[tokio::test]
async fn agent_loop_starts_without_legacy_instruction_gate() {
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
        .build()
        .unwrap();

    let mut events = Vec::new();
    loop_.run(sid, "hi", &mut |e| events.push(e)).await.unwrap();
    assert_eq!(mock.request_count(), 1);
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
async fn agent_loop_injects_active_step_context_into_system_prompt() {
    let (db, _db_file, root, sid) = fresh_env();
    let cid = insert_card(&db, sid, CardState::Instructed, Some("card instruction"), 1);
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
        .step_context(Some(StepContext {
            step_id: 7,
            title: "Export artifacts".into(),
            instruction_seed: Some("Write plan files".into()),
            acceptance_criteria: Some("plan.json exists".into()),
            linked_criterion_ids: vec!["AC-001".into()],
            decomposition_rationale: Some(
                "The export step preserves PRD reconstruction evidence.".into(),
            ),
            expected_files: Some(".dive/plan.json".into()),
            step_kind: Default::default(),
        }))
        .build()
        .unwrap();

    let mut events = Vec::new();
    loop_
        .run(sid, "continue", &mut |e| events.push(e))
        .await
        .unwrap();

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
    assert!(system_content.contains("Export artifacts"));
    assert!(system_content.contains("Write plan files"));
    assert!(system_content.contains("plan.json exists"));
    assert!(system_content.contains("연결된 PRD 기준: AC-001"));
    assert!(system_content.contains("The export step preserves PRD reconstruction evidence."));
    assert!(system_content.contains(".dive/plan.json"));
    assert!(system_content.contains("단계 종료 규칙"));
    assert!(system_content.contains("동일한 도구 호출을 반복하지 마세요"));
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
