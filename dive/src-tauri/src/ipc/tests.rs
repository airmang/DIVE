#[cfg(test)]
use super::cards::{card_transition_with_checkpoint_impl, card_update_test_command_impl};
use super::chat::{
    backend_run_mode_floor, mark_step_blocked_after_recoverable_error, message_list_impl,
    safest_run_mode,
};
use super::state::{ActiveTurnGuard, PROJECT_NOT_SELECTED_MESSAGE};
use super::{AppState, ChatHistoryMessage, ProviderKind, ProviderRuntime};
use crate::agent::{AgentRunMode, PendingApprovalSnapshot};
use crate::db::dao::step_session_mapping as mapping_dao;
use crate::db::models::{CardState, NewCard};
use crate::dive::CardTransition;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[test]
fn app_state_runtime_snapshot_and_swap_are_atomic_unit() {
    let state = AppState::dev_mock();
    assert_eq!(state.runtime_snapshot().model, "mock-model");

    state.swap_runtime(ProviderRuntime::none()).unwrap();
    let snap = state.runtime_snapshot();
    assert!(snap.kind.is_none());
    assert_eq!(snap.model, "unset");
}

#[tokio::test]
async fn ensure_provider_runtime_rejects_invalid_active_model_with_cta() {
    let state = AppState::dev_mock();
    state
        .swap_runtime(ProviderRuntime::new(
            Some(1),
            ProviderKind::OpencodeZen,
            "ling-2.6-flash".into(),
            Arc::new(crate::providers::MockProvider::new(Vec::new())),
        ))
        .unwrap();

    let err = match state.ensure_provider_runtime().await {
        Ok(_) => panic!("invalid runtime model should be rejected"),
        Err(err) => err,
    };
    assert!(err.contains("ling-2.6-flash"));
    assert!(err.contains("Settings"));
}

#[test]
fn project_root_required_rejects_empty_snapshot() {
    let state = AppState::dev_mock();
    state.swap_project_root(PathBuf::new()).unwrap();
    let err = state.project_root_required().unwrap_err();
    assert!(err.contains(PROJECT_NOT_SELECTED_MESSAGE));
}

#[test]
fn project_root_snapshot_and_swap_are_atomic_unit() {
    let state = AppState::dev_mock();
    let root = PathBuf::from("/tmp/dive-project-root-snapshot");
    state.swap_project_root(root.clone()).unwrap();
    assert_eq!(state.project_root_snapshot(), root);
    assert_eq!(state.project_root_required().unwrap(), root);
}

#[test]
fn backend_run_mode_floor_requires_plan_until_accepted() {
    assert_eq!(backend_run_mode_floor(false), AgentRunMode::Plan);
}

#[test]
fn backend_run_mode_floor_allows_build_after_plan_accepted() {
    assert_eq!(backend_run_mode_floor(true), AgentRunMode::Build);
}

#[test]
fn safest_run_mode_allows_verify_when_plan_is_accepted() {
    assert_eq!(
        safest_run_mode(backend_run_mode_floor(true), AgentRunMode::Verify),
        AgentRunMode::Verify
    );
}

mod select_runtime_tests {
    use super::super::chat::select_runtime;
    use super::super::{ProviderKind, RuntimeChoice};

    #[test]
    fn default_routes_eligible_provider_to_pi() {
        assert_eq!(select_runtime(ProviderKind::Codex, None), RuntimeChoice::Pi);
    }

    #[test]
    fn default_routes_first_class_api_key_providers_to_pi() {
        for kind in [
            ProviderKind::OpenAi,
            ProviderKind::Anthropic,
            ProviderKind::OpenRouter,
        ] {
            assert_eq!(select_runtime(kind, None), RuntimeChoice::Pi);
        }
    }

    #[test]
    fn default_routes_ineligible_provider_to_legacy() {
        assert_eq!(
            select_runtime(ProviderKind::OpencodeZen, None),
            RuntimeChoice::Legacy
        );
    }

    #[test]
    fn env_legacy_forces_legacy_even_for_eligible() {
        assert_eq!(
            select_runtime(ProviderKind::Codex, Some("legacy")),
            RuntimeChoice::Legacy
        );
    }

    #[test]
    fn env_pi_forces_pi_for_eligible_provider() {
        assert_eq!(
            select_runtime(ProviderKind::Codex, Some("pi")),
            RuntimeChoice::Pi
        );
    }

    #[test]
    fn env_pi_falls_back_to_legacy_for_ineligible_provider() {
        assert_eq!(
            select_runtime(ProviderKind::OpencodeZen, Some("pi")),
            RuntimeChoice::Legacy
        );
    }
}

fn seed_session(state: &AppState, project_root: &std::path::Path) -> i64 {
    let db = state.db.lock().unwrap();
    let project_id = crate::db::dao::project::insert(
        db.conn(),
        &crate::db::models::NewProject {
            name: "p".into(),
            path: project_root.to_string_lossy().into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    crate::db::dao::session::insert(
        db.conn(),
        &crate::db::models::NewSession {
            project_id,
            title: "s".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap()
}

fn seed_card(state: &AppState, session_id: i64, title: &str, card_state: CardState) -> i64 {
    let db = state.db.lock().unwrap();
    crate::db::dao::card::insert(
        db.conn(),
        &NewCard {
            session_id,
            title: title.into(),
            instruction: Some("instruction".into()),
            assist_summary: None,
            acceptance_criteria: None,
            retrospective: None,
            change_summary: None,
            state: card_state,
            verify_log: None,
            changed_files: None,
            test_command: None,
            approval_judgment: None,
            position: 1,
        },
    )
    .unwrap()
}

#[test]
fn card_transitions_create_dive_stage_auto_checkpoints() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    crate::checkpoint::CheckpointEngine::new(tmp.path(), state.db.clone())
        .init()
        .unwrap();

    let cases = [
        (
            "enter.txt",
            CardState::Decomposed,
            CardTransition::EnterInstruct,
            "[I 진입] enter",
            None,
        ),
        (
            "request.txt",
            CardState::Instructed,
            CardTransition::RequestVerify,
            "[V 요청] request",
            None,
        ),
        (
            "reject.txt",
            CardState::Verifying,
            CardTransition::Reject,
            "[V 거부] reject",
            None,
        ),
        (
            "approve.txt",
            CardState::Verifying,
            CardTransition::Approve,
            "[V 통과] approve",
            Some(true),
        ),
        (
            "extend.txt",
            CardState::Verified,
            CardTransition::Extend,
            "[E 진입] extend",
            None,
        ),
    ];

    for (file, initial_state, transition, expected_label, approve_force) in cases {
        std::fs::write(tmp.path().join(file), transition_name(transition)).unwrap();
        let card_id = seed_card(
            &state,
            session_id,
            expected_label
                .trim_start_matches('[')
                .split("] ")
                .last()
                .unwrap(),
            initial_state,
        );
        let judgment = match transition {
            CardTransition::Approve => Some(crate::dive::ApprovalJudgment {
                outcome: crate::dive::ApprovalOutcome::Approved,
                note: None,
                decided_at: 1,
            }),
            CardTransition::Reject => Some(crate::dive::ApprovalJudgment {
                outcome: crate::dive::ApprovalOutcome::RevisionRequested,
                note: Some("needs revision".into()),
                decided_at: 1,
            }),
            _ => None,
        };
        let (_next, row) = card_transition_with_checkpoint_impl(
            &state,
            card_id,
            transition,
            approve_force,
            judgment,
        )
        .unwrap();
        let row = row.expect("transition should create an auto checkpoint");
        assert_eq!(row.kind, "auto");
        assert_eq!(row.label.as_deref(), Some(expected_label));
        assert_eq!(row.git_sha.len(), 40);
        assert!(
            row.changed_files.iter().any(|changed| changed == file),
            "expected {file} in changed files, got {:?}",
            row.changed_files
        );
    }
    let logs = {
        let db = state.db.lock().unwrap();
        crate::db::dao::event_log::list_by_session(db.conn(), session_id).unwrap()
    };
    assert_eq!(
        logs.iter()
            .filter(|row| row.r#type == "card_update")
            .count(),
        5
    );
    assert_eq!(
        logs.iter()
            .filter(|row| row.r#type == "checkpoint_create")
            .count(),
        5
    );
}

#[test]
fn card_update_test_command_saves_trims_clears_and_logs() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    let card_id = seed_card(&state, session_id, "verify command", CardState::Instructed);

    card_update_test_command_impl(&state, card_id, Some("  pnpm test  ".into())).unwrap();
    {
        let db = state.db.lock().unwrap();
        let row = crate::db::dao::card::get_by_id(db.conn(), card_id)
            .unwrap()
            .unwrap();
        assert_eq!(row.test_command.as_deref(), Some("pnpm test"));
    }

    card_update_test_command_impl(&state, card_id, Some("   ".into())).unwrap();
    let db = state.db.lock().unwrap();
    let row = crate::db::dao::card::get_by_id(db.conn(), card_id)
        .unwrap()
        .unwrap();
    assert_eq!(row.test_command, None);
    let logs = crate::db::dao::event_log::list_by_session(db.conn(), session_id).unwrap();
    assert_eq!(
        logs.iter()
            .filter(|row| row.r#type == "card_update")
            .count(),
        2
    );
}

#[test]
fn recoverable_provider_error_marks_active_plan_step_blocked() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    let db = state.db.lock().unwrap();
    let project_id = crate::db::dao::project::insert(
        db.conn(),
        &crate::db::models::NewProject {
            name: "p".into(),
            path: tmp.path().to_string_lossy().into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let session_id = crate::db::dao::session::insert(
        db.conn(),
        &crate::db::models::NewSession {
            project_id,
            title: "s".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    let plan_id = crate::db::dao::plan::insert(
        db.conn(),
        &crate::db::models::NewPlan {
            project_id,
            interview_id: None,
            goal: "Build a todo app".into(),
            intent_summary: None,
            scope: None,
            non_goals: None,
            constraints: None,
            acceptance_criteria: None,
            status: "approved".into(),
        },
    )
    .unwrap();
    let step_id = crate::db::dao::step::insert(
        db.conn(),
        &crate::db::models::NewStep {
            plan_id,
            step_id: "step-001".into(),
            title: "Create markup".into(),
            summary: None,
            instruction_seed: Some("Write index.html".into()),
            expected_files: Some(serde_json::json!(["index.html"])),
            acceptance_criteria: Some(serde_json::json!(["file exists"])),
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: Some(serde_json::json!([])),
            parallel_group: None,
            position: 1,
        },
    )
    .unwrap();
    let mapping_id = mapping_dao::insert(
        db.conn(),
        &crate::db::models::NewStepSessionMapping {
            step_id,
            session_id: Some(session_id),
            card_id: None,
            state_path: None,
            status: "in_progress".into(),
            started_at: Some(crate::db::now_ms()),
            completed_at: None,
            checkpoint_ids: Some(serde_json::json!([])),
            verification_status: None,
            verification_evidence: None,
            user_decision: None,
        },
    )
    .unwrap();
    drop(db);

    mark_step_blocked_after_recoverable_error(
        &state,
        step_id,
        "provider: api error (429): FreeUsageLimitError",
    )
    .unwrap();

    let db = state.db.lock().unwrap();
    let mapping = mapping_dao::get_by_id(db.conn(), mapping_id)
        .unwrap()
        .unwrap();
    assert_eq!(mapping.status, "blocked");
    let logs = crate::db::dao::event_log::list_by_session(db.conn(), session_id).unwrap();
    assert!(logs.iter().any(|row| {
        row.r#type == "plan_step_state_changed"
            && row.payload["message"] == "Step blocked by provider limit"
    }));
}

#[test]
fn message_list_restores_persisted_chat_rows_for_ui() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    {
        let db = state.db.lock().unwrap();
        crate::db::dao::message::insert(
            db.conn(),
            &crate::db::models::NewMessage {
                session_id,
                card_id: None,
                role: "user".into(),
                content: "hello".into(),
                reasoning_content: None,
                tool_calls: None,
                usage: None,
                provider: Some("openai".into()),
                model: Some("gpt".into()),
            },
        )
        .unwrap();
        crate::db::dao::message::insert(
            db.conn(),
            &crate::db::models::NewMessage {
                session_id,
                card_id: None,
                role: "assistant".into(),
                content: "world".into(),
                reasoning_content: None,
                tool_calls: None,
                usage: None,
                provider: Some("openai".into()),
                model: Some("gpt".into()),
            },
        )
        .unwrap();
    }

    let history = message_list_impl(&state, session_id).unwrap();
    assert_eq!(history.len(), 2);
    assert!(matches!(history[0], ChatHistoryMessage::User { .. }));
    assert!(matches!(history[1], ChatHistoryMessage::Assistant { .. }));
}

#[test]
fn pending_tool_calls_are_rehydratable_by_session() {
    let state = AppState::dev_mock();
    let first = PendingApprovalSnapshot {
        id: "call-1".into(),
        session_id: 10,
        tool: "mkdir".into(),
        params_preview: "path: output".into(),
        risk: crate::tools::RiskLevel::Warn,
        diff_preview: None,
        args: serde_json::json!({ "path": "output" }),
    };
    let second = PendingApprovalSnapshot {
        id: "call-2".into(),
        session_id: 20,
        tool: "write_file".into(),
        params_preview: "path: index.html".into(),
        risk: crate::tools::RiskLevel::Warn,
        diff_preview: None,
        args: serde_json::json!({ "path": "index.html" }),
    };
    let _first_rx = state.pending_approvals.register(first);
    let _second_rx = state.pending_approvals.register(second);

    let pending = state.pending_approvals.list_for_session(10);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, "call-1");
    assert_eq!(pending[0].tool, "mkdir");

    assert_eq!(state.pending_approvals.cancel_session(10), 1);
    assert_eq!(state.pending_approvals.pending_count(), 1);
    assert_eq!(state.pending_approvals.list_for_session(10).len(), 0);
    assert_eq!(state.pending_approvals.list_for_session(20).len(), 1);
}

#[test]
fn active_turn_guard_rejects_concurrent_turn_and_removes_only_own_token() {
    let state = AppState::dev_mock();
    let first = ActiveTurnGuard::begin(&state, 42).unwrap();
    let err = match ActiveTurnGuard::begin(&state, 42) {
        Ok(_) => panic!("concurrent turn should be rejected"),
        Err(err) => err,
    };
    assert!(err.contains("이전 작업"));

    let replacement = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.cancels.lock().unwrap();
        guard.insert(42, replacement.clone());
    }
    drop(first);
    {
        let guard = state.cancels.lock().unwrap();
        assert!(guard
            .get(&42)
            .map(|token| Arc::ptr_eq(token, &replacement))
            .unwrap_or(false));
    }
    state.cancels.lock().unwrap().remove(&42);
}

fn transition_name(transition: CardTransition) -> &'static str {
    match transition {
        CardTransition::EnterInstruct => "enter",
        CardTransition::RequestVerify => "request",
        CardTransition::Approve => "approve",
        CardTransition::Reject => "reject",
        CardTransition::ReopenFromReject => "reopen",
        CardTransition::Extend => "extend",
    }
}
