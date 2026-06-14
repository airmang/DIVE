//! IPC boundary for supervisor-backed provocation evaluation.
//!
//! This command constructs the Rust-owned `SupervisorContext`, applies the P1
//! deterministic gate, runs a zero-tool Pi SupervisorAgent turn, and validates
//! the returned `SupervisorDecision` before any card reaches the UI.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

use crate::dive::event_log::append_supervisor_evaluation_to_conn;
use crate::dive::{
    build_stage_c_supervisor_decision, build_supervisor_context_from_ui, build_supervisor_prompt,
    dropped_validation_result, no_card_validation_result, normalize_source_ui_mode,
    p1_provoke_gate, validate_supervisor_decision, validate_supervisor_decision_json, ArtifactRef,
    PlanSummary, ProvocationCard, SourceUiMode, SupervisorContext, SupervisorContextBuildInput,
    SupervisorDedupState, SupervisorDropReason, SupervisorEvaluationLog, SupervisorEvent,
    SupervisorValidationOutcome, SupervisorValidationResult, SupervisorVerificationUiState,
    VerificationFeasibility,
};
use crate::pi_sidecar::{
    run_supervisor_turn, supervisor_turn_timeout, PiSidecarSupervisorErrorKind,
    PiSidecarSupervisorTurnResult,
};

use super::AppState;

static SESSION_DEDUP: Lazy<Mutex<HashMap<i64, SupervisorDedupState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvocationAgentEvaluateRequest {
    pub session_id: i64,
    pub event: SupervisorEvent,
    pub artifact_ref: ArtifactRef,
    pub source_ui_mode: String,
    #[serde(default)]
    pub locale: Option<String>,
    pub ui_state: ProvocationAgentUiState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvocationAgentUiState {
    #[serde(default)]
    pub goal_summary: Option<String>,
    #[serde(default)]
    pub plan_summary: Option<PlanSummary>,
    pub verification: SupervisorVerificationUiState,
    pub feasibility: VerificationFeasibility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvocationAgentEvaluateStatus {
    Shown,
    #[serde(rename = "none")]
    NoCard,
    Dropped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvocationAgentEvaluateResponse {
    pub status: ProvocationAgentEvaluateStatus,
    pub evaluation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card: Option<ProvocationCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_reason: Option<SupervisorDropReason>,
}

#[derive(Debug, Clone)]
enum StageCSupervisorOutput {
    DomainShell,
    DecisionJson {
        raw: String,
        supervisor_model: Option<String>,
        latency_ms: Option<u64>,
        usage: Option<serde_json::Value>,
    },
    Drop(SupervisorDropReason),
    RuntimeUnavailable,
    Timeout,
    SidecarError,
    LateAfterFinalization,
}

#[tauri::command]
pub async fn provocation_agent_evaluate(
    state: State<'_, AppState>,
    request: ProvocationAgentEvaluateRequest,
) -> Result<ProvocationAgentEvaluateResponse, String> {
    let output = supervisor_output_from_runtime(&state, &request).await;
    let evaluated = {
        let mut sessions = SESSION_DEDUP
            .lock()
            .map_err(|_| "supervisor dedup state unavailable".to_string())?;
        let dedup = sessions
            .entry(request.session_id)
            .or_insert_with(SupervisorDedupState::new);
        evaluate_with_output_and_log(request, output, dedup)
    };
    if let Some(log) = &evaluated.log {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        append_supervisor_evaluation_to_conn(
            db.conn(),
            evaluated.session_id,
            &evaluated.response.evaluation_id,
            log,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(evaluated.response)
}

async fn supervisor_output_from_runtime(
    state: &AppState,
    request: &ProvocationAgentEvaluateRequest,
) -> StageCSupervisorOutput {
    let normalized = match normalize_source_ui_mode(&request.source_ui_mode) {
        Ok(normalized) => normalized,
        Err(_) => return StageCSupervisorOutput::RuntimeUnavailable,
    };
    let context = build_context(request.clone(), normalized.source_ui_mode);
    if !p1_provoke_gate(&context) {
        return StageCSupervisorOutput::DomainShell;
    }
    let prompt = match build_supervisor_prompt(&context) {
        Ok(prompt) => prompt,
        Err(reason) => return StageCSupervisorOutput::Drop(reason),
    };
    let snap = match state.ensure_provider_runtime().await {
        Ok(snap) if !snap.kind.is_none() => snap,
        _ => return StageCSupervisorOutput::RuntimeUnavailable,
    };
    let descriptor = match crate::pi_sidecar::parity::pi_provider_descriptor(snap.kind.clone()) {
        Some(descriptor) => descriptor,
        None => return StageCSupervisorOutput::RuntimeUnavailable,
    };
    let provider_config_id = match snap.config_id {
        Some(id) => id,
        None => return StageCSupervisorOutput::RuntimeUnavailable,
    };
    let cwd = match state.project_root_required() {
        Ok(cwd) => cwd,
        Err(_) => return StageCSupervisorOutput::RuntimeUnavailable,
    };

    match run_supervisor_turn(
        state.keyring.as_ref(),
        &descriptor,
        provider_config_id,
        cwd,
        snap.model,
        prompt,
        supervisor_turn_timeout(),
    )
    .await
    {
        Ok(result) => result.into(),
        Err(err) => match err.kind {
            PiSidecarSupervisorErrorKind::RuntimeUnavailable => {
                StageCSupervisorOutput::RuntimeUnavailable
            }
            PiSidecarSupervisorErrorKind::Timeout => StageCSupervisorOutput::Timeout,
            PiSidecarSupervisorErrorKind::SidecarError => StageCSupervisorOutput::SidecarError,
        },
    }
}

impl From<PiSidecarSupervisorTurnResult> for StageCSupervisorOutput {
    fn from(result: PiSidecarSupervisorTurnResult) -> Self {
        Self::DecisionJson {
            raw: result.assistant_text,
            supervisor_model: Some(result.model),
            latency_ms: Some(result.latency_ms),
            usage: result.usage,
        }
    }
}

struct EvaluatedSupervisorAttempt {
    session_id: i64,
    response: ProvocationAgentEvaluateResponse,
    log: Option<SupervisorEvaluationLog>,
}

fn evaluate_with_output(
    request: ProvocationAgentEvaluateRequest,
    output: StageCSupervisorOutput,
    dedup: &mut SupervisorDedupState,
) -> ProvocationAgentEvaluateResponse {
    evaluate_with_output_and_log(request, output, dedup).response
}

fn evaluate_with_output_and_log(
    request: ProvocationAgentEvaluateRequest,
    output: StageCSupervisorOutput,
    dedup: &mut SupervisorDedupState,
) -> EvaluatedSupervisorAttempt {
    let session_id = request.session_id;
    let evaluation_id = Uuid::new_v4().to_string();
    let normalized = match normalize_source_ui_mode(&request.source_ui_mode) {
        Ok(normalized) => normalized,
        Err(reason) => {
            return EvaluatedSupervisorAttempt {
                session_id,
                response: response_from_validation(
                    evaluation_id,
                    dropped_validation_result(reason),
                    None,
                ),
                log: None,
            };
        }
    };
    let source_ui_mode = normalized.source_ui_mode;
    let context = build_context(request, source_ui_mode);
    let mut supervisor_model = None;
    let mut latency_ms = None;
    let mut usage = None;

    let mut validation = if !p1_provoke_gate(&context) {
        no_card_validation_result(SupervisorDropReason::ProvokeFalse)
    } else {
        match output {
            StageCSupervisorOutput::DomainShell => {
                let decision = build_stage_c_supervisor_decision(&context);
                validate_supervisor_decision(&context, decision, dedup)
            }
            StageCSupervisorOutput::DecisionJson {
                raw,
                supervisor_model: model,
                latency_ms: runtime_latency_ms,
                usage: runtime_usage,
            } => {
                supervisor_model = model;
                latency_ms = runtime_latency_ms;
                usage = runtime_usage;
                validate_supervisor_decision_json(&context, &raw, dedup)
            }
            StageCSupervisorOutput::Drop(reason) => dropped_validation_result(reason),
            StageCSupervisorOutput::RuntimeUnavailable => {
                dropped_validation_result(SupervisorDropReason::RuntimeUnavailable)
            }
            StageCSupervisorOutput::SidecarError => {
                dropped_validation_result(SupervisorDropReason::SidecarError)
            }
            StageCSupervisorOutput::Timeout | StageCSupervisorOutput::LateAfterFinalization => {
                dropped_validation_result(SupervisorDropReason::Timeout)
            }
        }
    };

    attach_evaluation_id(&mut validation, &evaluation_id);
    let log = SupervisorEvaluationLog::from_validation(
        &context,
        Some(source_ui_mode),
        &validation,
        supervisor_model,
        latency_ms,
        usage,
    );
    EvaluatedSupervisorAttempt {
        session_id,
        response: response_from_validation(evaluation_id, validation, Some(&context)),
        log: Some(log),
    }
}

fn build_context(
    request: ProvocationAgentEvaluateRequest,
    source_ui_mode: SourceUiMode,
) -> SupervisorContext {
    let plan_summary = request.ui_state.plan_summary.unwrap_or(PlanSummary {
        step_count: 0,
        active_step: None,
    });
    build_supervisor_context_from_ui(SupervisorContextBuildInput {
        event: request.event,
        artifact_ref: request.artifact_ref,
        source_ui_mode,
        locale: request.locale.unwrap_or_else(|| "ko-KR".to_string()),
        goal_summary: request.ui_state.goal_summary.unwrap_or_default(),
        plan_summary,
        verification: request.ui_state.verification,
        feasibility: request.ui_state.feasibility,
    })
    .context
}

fn attach_evaluation_id(validation: &mut SupervisorValidationResult, evaluation_id: &str) {
    if let Some(card) = validation.card.as_mut() {
        if let Some(metadata) = card.metadata.as_object_mut() {
            metadata.insert("supervisorEvaluationId".to_string(), json!(evaluation_id));
        }
    }
}

fn response_from_validation(
    evaluation_id: String,
    validation: SupervisorValidationResult,
    _context: Option<&SupervisorContext>,
) -> ProvocationAgentEvaluateResponse {
    match validation.validation_outcome {
        SupervisorValidationOutcome::Shown => ProvocationAgentEvaluateResponse {
            status: ProvocationAgentEvaluateStatus::Shown,
            evaluation_id,
            card: validation.card,
            drop_reason: None,
        },
        SupervisorValidationOutcome::NoCard => ProvocationAgentEvaluateResponse {
            status: ProvocationAgentEvaluateStatus::NoCard,
            evaluation_id,
            card: None,
            drop_reason: validation.drop_reason,
        },
        SupervisorValidationOutcome::Dropped | SupervisorValidationOutcome::Error => {
            ProvocationAgentEvaluateResponse {
                status: ProvocationAgentEvaluateStatus::Dropped,
                evaluation_id,
                card: None,
                drop_reason: validation.drop_reason,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dive::{ProvocationCardType, SupervisorTestResult as TestResult};

    fn request_with_verification(
        verification: SupervisorVerificationUiState,
    ) -> ProvocationAgentEvaluateRequest {
        ProvocationAgentEvaluateRequest {
            session_id: 123,
            event: SupervisorEvent::VerifyEntered,
            artifact_ref: ArtifactRef::step("step-3", "Add todo item form"),
            source_ui_mode: "standard".to_string(),
            locale: Some("ko-KR".to_string()),
            ui_state: ProvocationAgentUiState {
                goal_summary: Some("사용자가 할 일 앱 입력 폼을 완성하려고 함".to_string()),
                plan_summary: Some(PlanSummary {
                    step_count: 4,
                    active_step: Some("입력 폼 구현".to_string()),
                }),
                verification,
                feasibility: VerificationFeasibility {
                    runnable: false,
                    previewable: false,
                    has_tests: false,
                    diff_available: true,
                },
            },
        }
    }

    fn self_report_only_verification() -> SupervisorVerificationUiState {
        SupervisorVerificationUiState {
            ai_claimed_done: true,
            diff_reviewed: false,
            app_launched: false,
            preview_checked: false,
            automated_tests_passed: false,
            test_result: Some(TestResult::Skipped),
            acceptance_criterion_confirmed: false,
            manual_checks: vec![],
        }
    }

    #[test]
    fn provocation_agent_evaluate_maps_stage_c_shell_to_shown_response() {
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::DomainShell,
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::Shown);
        let card = response.card.expect("shown response carries a card");
        assert_eq!(card.card_type, ProvocationCardType::AiSelfReportOnly);
        assert_eq!(card.title, "확인 필요 카드");
        assert_ne!(card.title, "도발카드");
        assert_eq!(
            card.metadata["supervisorEvaluationId"],
            json!(response.evaluation_id)
        );
        assert_eq!(card.actions[0].id, "open_diff");
    }

    #[test]
    fn provocation_agent_evaluate_returns_none_when_concrete_evidence_exists() {
        let mut verification = self_report_only_verification();
        verification.automated_tests_passed = true;
        verification.test_result = Some(TestResult::Pass);
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(verification),
            StageCSupervisorOutput::DomainShell,
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::NoCard);
        assert_eq!(
            response.drop_reason,
            Some(SupervisorDropReason::ProvokeFalse)
        );
        assert!(response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_does_not_create_fallback_for_runtime_unavailable() {
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::RuntimeUnavailable,
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::Dropped);
        assert_eq!(
            response.drop_reason,
            Some(SupervisorDropReason::RuntimeUnavailable)
        );
        assert!(response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_contract_level_timeout_has_no_card() {
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::Timeout,
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::Dropped);
        assert_eq!(response.drop_reason, Some(SupervisorDropReason::Timeout));
        assert!(response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_contract_level_sidecar_error_has_no_card() {
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::SidecarError,
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::Dropped);
        assert_eq!(
            response.drop_reason,
            Some(SupervisorDropReason::SidecarError)
        );
        assert!(response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_contract_level_late_result_is_dropped_as_timeout() {
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::LateAfterFinalization,
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::Dropped);
        assert_eq!(response.drop_reason, Some(SupervisorDropReason::Timeout));
        assert!(response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_validates_supplied_decision_json() {
        let raw = r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "ai_self_report_only",
            "severity": "risk",
            "question": "AI 완료 주장만 있으니 변경된 파일을 직접 확인할 수 있나요?",
            "evidenceRefIds": ["agent.assistant_claim", "verify.test_result"],
            "suggestedActionIds": ["open_diff", "continue_with_risk"],
            "supervisionHabit": "AI의 말과 직접 본 증거를 구분합니다.",
            "logRationale": "완료 주장은 있으나 독립 검증 증거가 없음"
        }"#;
        let mut dedup = SupervisorDedupState::new();
        let response = evaluate_with_output(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::DecisionJson {
                raw: raw.to_string(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(42),
                usage: None,
            },
            &mut dedup,
        );

        assert_eq!(response.status, ProvocationAgentEvaluateStatus::Shown);
        let card = response.card.expect("valid response carries a card");
        assert_eq!(card.actions.len(), 1);
        assert_eq!(card.actions[0].id, "open_diff");
    }

    #[test]
    fn provocation_agent_evaluate_builds_supervisor_log_before_frontend_exposure() {
        let raw = r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "ai_self_report_only",
            "severity": "caution",
            "question": "AI 완료 주장만 있으니 변경된 파일을 직접 확인할 수 있나요?",
            "evidenceRefIds": ["agent.assistant_claim", "verify.test_result"],
            "suggestedActionIds": ["open_diff"],
            "supervisionHabit": "AI의 말과 직접 본 증거를 구분합니다.",
            "logRationale": "완료 주장은 있으나 독립 검증 증거가 없음"
        }"#;
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            request_with_verification(self_report_only_verification()),
            StageCSupervisorOutput::DecisionJson {
                raw: raw.to_string(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(42),
                usage: Some(json!({ "inputTokens": 10 })),
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Shown
        );
        let card = evaluated
            .response
            .card
            .as_ref()
            .expect("shown response carries card");
        assert_eq!(
            card.metadata["supervisorEvaluationId"],
            json!(evaluated.response.evaluation_id)
        );
        let log = evaluated
            .log
            .expect("evaluation log is built for persistence");
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Shown);
        assert_eq!(log.card_id.as_deref(), Some(card.id.as_str()));
        assert_eq!(log.supervisor_model.as_deref(), Some("mock-supervisor"));
        assert_eq!(log.latency_ms, Some(42));
        assert_eq!(log.usage, Some(json!({ "inputTokens": 10 })));
    }
}
