#[cfg(test)]
use super::cards::{
    card_transition_with_checkpoint_and_provenance_impl, card_transition_with_checkpoint_impl,
    card_update_test_command_impl,
};
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
    fn default_routes_codex_to_pi() {
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
            approval_provenance: None,
            position: 1,
        },
    )
    .unwrap()
}

fn set_verify_log(
    state: &AppState,
    card_id: i64,
    intent_match: bool,
    test_result: crate::dive::TestResult,
) {
    let log = crate::dive::VerifyLog {
        intent_match,
        test_result,
        details: "verification details".into(),
        model: "mock-model".into(),
        ran_at: 1,
        test_command: Some("pnpm test".into()),
        test_exit_code: None,
        test_stdout: None,
        test_stderr: None,
    };
    let db = state.db.lock().unwrap();
    let card = crate::db::dao::card::get_by_id(db.conn(), card_id)
        .unwrap()
        .unwrap();
    crate::db::dao::card::update(
        db.conn(),
        card_id,
        &NewCard {
            session_id: card.session_id,
            title: card.title,
            instruction: card.instruction,
            assist_summary: card.assist_summary,
            acceptance_criteria: card.acceptance_criteria,
            retrospective: card.retrospective,
            change_summary: card.change_summary,
            state: card.state,
            verify_log: Some(log.to_json_string()),
            changed_files: card.changed_files,
            test_command: card.test_command,
            approval_judgment: card.approval_judgment,
            approval_provenance: card.approval_provenance,
            position: card.position,
        },
    )
    .unwrap();
}

fn seed_step_mapping_for_card(state: &AppState, session_id: i64, card_id: i64) -> i64 {
    let db = state.db.lock().unwrap();
    let project_id = db
        .conn()
        .query_row(
            "SELECT project_id FROM Session WHERE id = ?",
            [session_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
    let plan_id = crate::db::dao::plan::insert(
        db.conn(),
        &crate::db::models::NewPlan {
            project_id,
            interview_id: None,
            goal: "approval provenance".into(),
            intent_summary: None,
            scope: Some(serde_json::json!([])),
            non_goals: Some(serde_json::json!([])),
            constraints: Some(serde_json::json!([])),
            acceptance_criteria: Some(serde_json::json!([])),
            status: "approved".into(),
        },
    )
    .unwrap();
    let step_id = crate::db::dao::step::insert(
        db.conn(),
        &crate::db::models::NewStep {
            plan_id,
            step_id: format!("step-{card_id}"),
            title: "Approval provenance".into(),
            summary: None,
            instruction_seed: Some("Verify approval provenance".into()),
            expected_files: Some(serde_json::json!([])),
            acceptance_criteria: Some(serde_json::json!([])),
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: Some(serde_json::json!([])),
            parallel_group: None,
            position: 1,
        },
    )
    .unwrap();
    mapping_dao::insert(
        db.conn(),
        &crate::db::models::NewStepSessionMapping {
            step_id,
            session_id: Some(session_id),
            card_id: Some(card_id),
            state_path: Some(format!("step-{card_id}")),
            status: "in_progress".into(),
            started_at: Some(crate::db::now_ms()),
            completed_at: None,
            checkpoint_ids: Some(serde_json::json!([])),
            verification_status: None,
            verification_evidence: None,
            user_decision: None,
        },
    )
    .unwrap()
}

#[test]
fn provocation_events_are_exported_with_session_event_log() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());

    super::log_event(
        &state,
        Some(session_id),
        "provocation.card_shown",
        serde_json::json!({
            "cardId": "ai_self_report_only:finalApproval:10",
            "cardType": "ai_self_report_only",
            "stage": "finalApproval",
            "severity": "risk",
            "evidence": [{"label": "AI 완료 보고", "value": "있음", "source": "agent"}],
        }),
    )
    .unwrap();

    let options = crate::export::ExportOptions {
        hash_user_text: false,
        hash_file_paths: false,
        hash_ids: false,
        ..Default::default()
    };
    let exported = crate::export::ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &options, "test-salt")
        .unwrap();

    assert!(exported.contains("\"kind\":\"event\""));
    assert!(exported.contains("\"type\":\"provocation.card_shown\""));
    assert!(exported.contains("\"cardType\":\"ai_self_report_only\""));
    assert!(exported.contains("\"agencyComponent\":\"verify\""));
    assert!(exported.contains("\"agencyState\":\"ai_self_report_only\""));
    assert!(exported.contains("\"evidenceSummary\""));
    assert!(exported.contains("\"reasonPresent\":false"));
}

#[test]
fn ai_self_report_only_approval_records_unverified_risk_provenance() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    let card_id = seed_card(&state, session_id, "AI only", CardState::Verifying);
    let mapping_id = seed_step_mapping_for_card(&state, session_id, card_id);
    set_verify_log(&state, card_id, true, crate::dive::TestResult::Skipped);

    card_transition_with_checkpoint_impl(
        &state,
        card_id,
        CardTransition::Approve,
        Some(true),
        Some(crate::dive::ApprovalJudgment {
            outcome: crate::dive::ApprovalOutcome::Approved,
            note: None,
            decided_at: 10,
        }),
    )
    .unwrap();

    let (provenance, mapping) = {
        let db = state.db.lock().unwrap();
        let card = crate::db::dao::card::get_by_id(db.conn(), card_id)
            .unwrap()
            .unwrap();
        let provenance: serde_json::Value =
            serde_json::from_str(card.approval_provenance.as_deref().unwrap()).unwrap();
        let mapping = mapping_dao::get_by_id(db.conn(), mapping_id)
            .unwrap()
            .unwrap();
        (provenance, mapping)
    };

    assert_eq!(provenance["verificationState"], "unverified_risk_accepted");
    assert_eq!(provenance["riskAccepted"], true);
    assert_eq!(provenance["evidenceSummary"]["concreteEvidence"], false);
    assert!(provenance["statusIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "ai_self_report_only"));
    assert!(provenance["statusIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "approved_with_risk"));
    assert_eq!(mapping.status, "done");
    assert_eq!(
        mapping.verification_status.as_deref(),
        Some("unverified_risk_accepted")
    );
    assert!(mapping
        .verification_evidence
        .as_deref()
        .unwrap()
        .contains("\"concreteEvidence\":false"));

    let options = crate::export::ExportOptions {
        hash_user_text: false,
        hash_file_paths: false,
        hash_ids: false,
        ..Default::default()
    };
    let exported = crate::export::ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &options, "test-salt")
        .unwrap();
    assert!(exported.contains("\"approval_provenance\""));
    assert!(exported.contains("\"verification_evidence_summary\""));
    assert!(exported.contains("\"agency\""));
    assert!(exported.contains("\"state\":\"approved_with_risk\""));
    assert!(exported.contains("\"checkpoint_count\":0"));
    assert!(exported.contains("\"rollback_available\":false"));
    assert!(exported.contains("\"ai_self_report_only\""));
    assert!(exported.contains("\"unverified_risk_accepted\""));
    assert!(exported.contains("\"kind\":\"step_session_mapping\""));
}

#[test]
fn diff_reviewed_only_approval_does_not_record_verified_evidence() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    let card_id = seed_card(&state, session_id, "Diff only", CardState::Verifying);
    let mapping_id = seed_step_mapping_for_card(&state, session_id, card_id);
    set_verify_log(&state, card_id, true, crate::dive::TestResult::Skipped);

    card_transition_with_checkpoint_and_provenance_impl(
        &state,
        card_id,
        CardTransition::Approve,
        Some(true),
        Some(crate::dive::ApprovalJudgment {
            outcome: crate::dive::ApprovalOutcome::ApprovedWithConcern,
            note: Some("diff만 확인했고 실행 증거는 아직 없음".into()),
            decided_at: 12,
        }),
        Some(serde_json::json!({
            "statusIds": ["diff_reviewed"],
            "statuses": [{
                "id": "diff_reviewed",
                "label": "Diff 확인됨",
                "evidenceBacked": true,
                "tone": "info",
                "source": "diff_review"
            }]
        })),
    )
    .unwrap();

    let (provenance, mapping) = {
        let db = state.db.lock().unwrap();
        let card = crate::db::dao::card::get_by_id(db.conn(), card_id)
            .unwrap()
            .unwrap();
        let provenance: serde_json::Value =
            serde_json::from_str(card.approval_provenance.as_deref().unwrap()).unwrap();
        let mapping = mapping_dao::get_by_id(db.conn(), mapping_id)
            .unwrap()
            .unwrap();
        (provenance, mapping)
    };

    assert_eq!(provenance["verificationState"], "unverified_risk_accepted");
    assert_eq!(provenance["evidenceSummary"]["concreteEvidence"], false);
    assert!(provenance["statusIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "diff_reviewed"));
    assert!(provenance["statusIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "approved_with_risk"));
    assert_eq!(
        mapping.verification_status.as_deref(),
        Some("unverified_risk_accepted")
    );
}

#[test]
fn passed_test_approval_records_evidence_backed_provenance() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    let card_id = seed_card(&state, session_id, "Test pass", CardState::Verifying);
    let mapping_id = seed_step_mapping_for_card(&state, session_id, card_id);
    set_verify_log(&state, card_id, true, crate::dive::TestResult::Pass);

    card_transition_with_checkpoint_impl(
        &state,
        card_id,
        CardTransition::Approve,
        Some(false),
        Some(crate::dive::ApprovalJudgment {
            outcome: crate::dive::ApprovalOutcome::Approved,
            note: None,
            decided_at: 11,
        }),
    )
    .unwrap();

    let (provenance, mapping) = {
        let db = state.db.lock().unwrap();
        let card = crate::db::dao::card::get_by_id(db.conn(), card_id)
            .unwrap()
            .unwrap();
        let provenance: serde_json::Value =
            serde_json::from_str(card.approval_provenance.as_deref().unwrap()).unwrap();
        let mapping = mapping_dao::get_by_id(db.conn(), mapping_id)
            .unwrap()
            .unwrap();
        (provenance, mapping)
    };

    assert_eq!(provenance["verificationState"], "verified_with_evidence");
    assert_eq!(provenance["riskAccepted"], false);
    assert_eq!(provenance["evidenceSummary"]["concreteEvidence"], true);
    assert!(provenance["statusIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "automated_tests_passed"));
    assert!(!provenance["statusIds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == "approved_with_risk"));
    assert_eq!(
        mapping.verification_status.as_deref(),
        Some("verified_with_evidence")
    );

    let options = crate::export::ExportOptions {
        hash_user_text: false,
        hash_file_paths: false,
        hash_ids: false,
        ..Default::default()
    };
    let exported = crate::export::ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &options, "test-salt")
        .unwrap();
    assert!(exported.contains("\"automated_tests_passed\""));
    assert!(exported.contains("\"verified_with_evidence\""));
    assert!(exported.contains("\"component\":\"decision\""));
    assert!(!exported.contains("\"approved_with_risk\""));
}

#[test]
fn export_maps_agency_event_metadata_for_tool_risk_and_checkpoint_restore() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());

    super::log_event(
        &state,
        Some(session_id),
        "provocation.continued_with_risk",
        serde_json::json!({
            "tool": "edit_file",
            "tool_call_id": "tool-1",
            "risk": "warn",
            "approval_metadata": {
                "source": "provocation.continue_with_risk",
                "cardType": "diff_scope_drift",
                "riskReason": "package change is intentional",
                "highRiskFiles": ["package.json"]
            },
            "reason": "package change is intentional",
            "highRiskFiles": ["package.json"]
        }),
    )
    .unwrap();
    super::log_event(
        &state,
        Some(session_id),
        "checkpoint_restore",
        serde_json::json!({
            "checkpoint_id": 1,
            "card_id": 2,
            "pre_restore_backup": true
        }),
    )
    .unwrap();

    let options = crate::export::ExportOptions {
        hash_user_text: false,
        hash_file_paths: false,
        hash_ids: false,
        ..Default::default()
    };
    let exported = crate::export::ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &options, "test-salt")
        .unwrap();

    assert!(exported.contains("\"agencyComponent\":\"action\""));
    assert!(exported.contains("\"agencyState\":\"approved_with_risk\""));
    assert!(exported.contains("\"riskLevel\":\"warn\""));
    assert!(exported.contains("\"affectedFiles\""));
    assert!(exported.contains("\"permissionReviewed\":true"));
    assert!(exported.contains("\"highRiskFileCount\":1"));
    assert!(exported.contains("\"reasonPresent\":true"));
    assert!(exported.contains("\"agencyComponent\":\"rollback\""));
    assert!(exported.contains("\"rollbackUsed\":true"));
    assert!(exported.contains("\"decision\":{\"kind\":\"restore_checkpoint\"}"));
}

#[test]
fn default_export_hashes_risk_reason_and_paths_in_agency_events() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());

    super::log_event(
        &state,
        Some(session_id),
        "provocation.continued_with_risk",
        serde_json::json!({
            "tool": "edit_file",
            "tool_call_id": "tool-1",
            "risk": "warn",
            "approval_metadata": {
                "source": "provocation.continue_with_risk",
                "cardType": "diff_scope_drift",
                "riskReason": "package change is intentional",
                "highRiskFiles": ["package.json"]
            },
            "reason": "package change is intentional",
            "highRiskFiles": ["package.json"]
        }),
    )
    .unwrap();

    let exported = crate::export::ExportEngine::new(state.db.clone())
        .export_session_with_salt(
            session_id,
            &crate::export::ExportOptions::default(),
            "test-salt",
        )
        .unwrap();

    assert!(exported.contains("\"reasonPresent\":true"));
    assert!(exported.contains("\"highRiskFileCount\":1"));
    assert!(!exported.contains("package change is intentional"));
    assert!(!exported.contains("package.json"));
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
fn approving_plan_step_card_unlocks_dependent_next_step() {
    let state = AppState::dev_mock();
    let tmp = tempfile::tempdir().unwrap();
    state.swap_project_root(tmp.path().to_path_buf()).unwrap();
    let session_id = seed_session(&state, tmp.path());
    let project_id = {
        let db = state.db.lock().unwrap();
        crate::db::dao::session::get_by_id(db.conn(), session_id)
            .unwrap()
            .unwrap()
            .project_id
    };
    let card_id = seed_card(&state, session_id, "First", CardState::Verifying);
    let (step1_id, step2_id) = {
        let db = state.db.lock().unwrap();
        let plan_id = crate::db::dao::plan::insert(
            db.conn(),
            &crate::db::models::NewPlan {
                project_id,
                interview_id: None,
                goal: "build dependent steps".into(),
                intent_summary: None,
                scope: Some(serde_json::json!([])),
                non_goals: Some(serde_json::json!([])),
                constraints: Some(serde_json::json!([])),
                acceptance_criteria: Some(serde_json::json!([])),
                status: "approved".into(),
            },
        )
        .unwrap();
        let step1_id = crate::db::dao::step::insert(
            db.conn(),
            &crate::db::models::NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "First".into(),
                summary: None,
                instruction_seed: Some("Do first".into()),
                expected_files: Some(serde_json::json!([])),
                acceptance_criteria: Some(serde_json::json!([])),
                verification_kind: None,
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(serde_json::json!([])),
                parallel_group: None,
                position: 1,
            },
        )
        .unwrap();
        let step2_id = crate::db::dao::step::insert(
            db.conn(),
            &crate::db::models::NewStep {
                plan_id,
                step_id: "step-002".into(),
                title: "Second".into(),
                summary: None,
                instruction_seed: Some("Do second".into()),
                expected_files: Some(serde_json::json!([])),
                acceptance_criteria: Some(serde_json::json!([])),
                verification_kind: None,
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(serde_json::json!(["step-001"])),
                parallel_group: None,
                position: 2,
            },
        )
        .unwrap();
        mapping_dao::insert(
            db.conn(),
            &crate::db::models::NewStepSessionMapping {
                step_id: step1_id,
                session_id: Some(session_id),
                card_id: Some(card_id),
                state_path: Some("step-001".into()),
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
        (step1_id, step2_id)
    };

    card_transition_with_checkpoint_impl(
        &state,
        card_id,
        CardTransition::Approve,
        Some(true),
        Some(crate::dive::ApprovalJudgment {
            outcome: crate::dive::ApprovalOutcome::Approved,
            note: None,
            decided_at: 1,
        }),
    )
    .unwrap();

    let status = super::workspace_plan_status_impl(&state, project_id).unwrap();
    assert_eq!(status.done_count, 1);
    assert_eq!(status.ready_count, 1);
    {
        let db = state.db.lock().unwrap();
        assert_eq!(
            mapping_dao::get_by_step(db.conn(), step1_id)
                .unwrap()
                .unwrap()
                .status,
            "done"
        );
    }

    let opened = super::roadmap_step_open_impl(&state, step2_id).unwrap();
    assert_eq!(opened.step_id, step2_id);
    assert_eq!(opened.status, "in_progress");
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
