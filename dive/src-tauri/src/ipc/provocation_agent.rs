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

use crate::db::models::ScopeExpansionAssessment;
use crate::dive::event_log::append_supervisor_evaluation_to_conn;
use crate::dive::supervisor::{
    build_diff_ready_supervisor_context, build_plan_drafted_supervisor_context,
    build_retry_loop_supervisor_context, build_scope_expansion_supervisor_context,
    supervisor_provoke_gate, DiffReadyReviewAssessment, DiffReadySupervisorContextBuildInput,
    PlanDraftReviewAssessment, PlanDraftSupervisorContextBuildInput, RetryLoopReviewAssessment,
    RetryLoopSupervisorContextBuildInput, ScopeExpansionEvidenceRefInput,
    ScopeExpansionSupervisorContextBuildInput,
};
use crate::dive::{
    build_stage_c_supervisor_decision, build_supervisor_context_from_ui, build_supervisor_prompt,
    dropped_validation_result, no_card_validation_result, normalize_source_ui_mode,
    validate_supervisor_decision, validate_supervisor_decision_json, ArtifactRef, PlanSummary,
    ProvocationCard, SourceUiMode, SupervisorActionId, SupervisorContext,
    SupervisorContextBuildInput, SupervisorDedupState, SupervisorDropReason,
    SupervisorEvaluationLog, SupervisorEvent, SupervisorValidationOutcome,
    SupervisorValidationResult, SupervisorVerificationUiState, VerificationFeasibility,
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
    #[serde(default = "default_source_ui_mode")]
    pub source_ui_mode: String,
    #[serde(default)]
    pub locale: Option<String>,
    pub ui_state: ProvocationAgentUiState,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub plan_id: Option<i64>,
    #[serde(default)]
    pub allowed_action_ids: Vec<SupervisorActionId>,
    #[serde(default)]
    pub evidence_refs: Vec<ScopeExpansionEvidenceRefInput>,
    #[serde(default)]
    pub scope_expansion: Option<ScopeExpansionAssessment>,
    #[serde(default)]
    pub plan_draft_assessment: Option<PlanDraftReviewAssessment>,
    #[serde(default)]
    pub diff_ready_assessment: Option<DiffReadyReviewAssessment>,
    #[serde(default)]
    pub retry_loop_assessment: Option<RetryLoopReviewAssessment>,
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

fn default_source_ui_mode() -> String {
    "standard".to_string()
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
    if !supervisor_provoke_gate(&context) {
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

    let mut validation = if !supervisor_provoke_gate(&context) {
        no_card_validation_result(SupervisorDropReason::ProvokeFalse)
    } else {
        match output {
            StageCSupervisorOutput::DomainShell => {
                if matches!(
                    context.event,
                    SupervisorEvent::ScopeExpansion
                        | SupervisorEvent::PlanDrafted
                        | SupervisorEvent::DiffReady
                        | SupervisorEvent::RetryLoop
                ) {
                    dropped_validation_result(SupervisorDropReason::RuntimeUnavailable)
                } else {
                    let decision = build_stage_c_supervisor_decision(&context);
                    validate_supervisor_decision(&context, decision, dedup)
                }
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
    match request.event {
        SupervisorEvent::ScopeExpansion => {
            build_scope_expansion_supervisor_context(ScopeExpansionSupervisorContextBuildInput {
                artifact_ref: request.artifact_ref,
                source_ui_mode,
                locale: request.locale.unwrap_or_else(|| "ko-KR".to_string()),
                goal_summary: request.ui_state.goal_summary.unwrap_or_default(),
                plan_summary,
                allowed_action_ids: request.allowed_action_ids,
                evidence_refs: request.evidence_refs,
                scope_expansion: request.scope_expansion.unwrap_or(ScopeExpansionAssessment {
                    expanded: false,
                    reason_codes: Vec::new(),
                    evidence_refs: Vec::new(),
                }),
            })
            .context
        }
        SupervisorEvent::PlanDrafted => {
            build_plan_drafted_supervisor_context(PlanDraftSupervisorContextBuildInput {
                artifact_ref: request.artifact_ref,
                source_ui_mode,
                locale: request.locale.unwrap_or_else(|| "ko-KR".to_string()),
                goal_summary: request.ui_state.goal_summary.unwrap_or_default(),
                plan_summary,
                allowed_action_ids: request.allowed_action_ids,
                evidence_refs: request.evidence_refs,
                plan_draft_assessment: request.plan_draft_assessment.unwrap_or_default(),
            })
            .context
        }
        SupervisorEvent::DiffReady => {
            build_diff_ready_supervisor_context(DiffReadySupervisorContextBuildInput {
                artifact_ref: request.artifact_ref,
                source_ui_mode,
                locale: request.locale.unwrap_or_else(|| "ko-KR".to_string()),
                goal_summary: request.ui_state.goal_summary.unwrap_or_default(),
                plan_summary,
                verification: request.ui_state.verification,
                feasibility: request.ui_state.feasibility,
                allowed_action_ids: request.allowed_action_ids,
                evidence_refs: request.evidence_refs,
                diff_ready_assessment: request.diff_ready_assessment.unwrap_or_default(),
            })
            .context
        }
        SupervisorEvent::RetryLoop => {
            build_retry_loop_supervisor_context(RetryLoopSupervisorContextBuildInput {
                artifact_ref: request.artifact_ref,
                source_ui_mode,
                locale: request.locale.unwrap_or_else(|| "ko-KR".to_string()),
                goal_summary: request.ui_state.goal_summary.unwrap_or_default(),
                plan_summary,
                verification: request.ui_state.verification,
                feasibility: request.ui_state.feasibility,
                allowed_action_ids: request.allowed_action_ids,
                evidence_refs: request.evidence_refs,
                retry_loop_assessment: request.retry_loop_assessment.unwrap_or_default(),
            })
            .context
        }
        SupervisorEvent::AiClaimedDone | SupervisorEvent::VerifyEntered => {
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
    }
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
    use crate::dive::{
        ProvocationCardStage, ProvocationCardType, SupervisorTestResult as TestResult,
    };

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
            project_id: None,
            plan_id: None,
            allowed_action_ids: Vec::new(),
            evidence_refs: Vec::new(),
            scope_expansion: None,
            plan_draft_assessment: None,
            diff_ready_assessment: None,
            retry_loop_assessment: None,
        }
    }

    fn scope_expansion_request() -> ProvocationAgentEvaluateRequest {
        ProvocationAgentEvaluateRequest {
            session_id: 456,
            event: SupervisorEvent::ScopeExpansion,
            artifact_ref: ArtifactRef::add_step_draft("draft-analytics", "Add analytics dashboard"),
            source_ui_mode: "standard".to_string(),
            locale: Some("ko-KR".to_string()),
            ui_state: ProvocationAgentUiState {
                goal_summary: Some("Keep this project to login settings".to_string()),
                plan_summary: Some(PlanSummary {
                    step_count: 3,
                    active_step: Some("Settings page".to_string()),
                }),
                verification: SupervisorVerificationUiState {
                    ai_claimed_done: false,
                    diff_reviewed: false,
                    app_launched: false,
                    preview_checked: false,
                    automated_tests_passed: false,
                    test_result: None,
                    test_command: None,
                    test_exit_code: None,
                    acceptance_criterion_confirmed: false,
                    manual_checks: vec![],
                },
                feasibility: VerificationFeasibility {
                    runnable: false,
                    previewable: false,
                    has_tests: false,
                    diff_available: false,
                },
            },
            project_id: Some(7),
            plan_id: Some(9),
            allowed_action_ids: vec![
                SupervisorActionId::LinkCriterion,
                SupervisorActionId::SplitScope,
                SupervisorActionId::EditPrd,
                SupervisorActionId::DismissReview,
            ],
            evidence_refs: vec![
                ScopeExpansionEvidenceRefInput {
                    id: "step.title".to_string(),
                    source: Some("plan".to_string()),
                    kind: Some("add_step_draft".to_string()),
                    label: Some("Add analytics dashboard".to_string()),
                    value_summary: json!("Add analytics dashboard"),
                    verification_evidence: false,
                },
                ScopeExpansionEvidenceRefInput {
                    id: "AC-001".to_string(),
                    source: Some("plan".to_string()),
                    kind: Some("acceptance_criteria".to_string()),
                    label: Some("Users can sign in".to_string()),
                    value_summary: json!({ "criterionId": "AC-001" }),
                    verification_evidence: false,
                },
            ],
            scope_expansion: Some(ScopeExpansionAssessment {
                expanded: true,
                reason_codes: vec!["missing_criterion_link".into()],
                evidence_refs: vec!["step.linkedCriterionIds".into()],
            }),
            plan_draft_assessment: None,
            diff_ready_assessment: None,
            retry_loop_assessment: None,
        }
    }

    fn plan_drafted_request() -> ProvocationAgentEvaluateRequest {
        ProvocationAgentEvaluateRequest {
            session_id: 789,
            event: SupervisorEvent::PlanDrafted,
            artifact_ref: ArtifactRef::plan_draft("plan-9:draft", "Plan draft"),
            source_ui_mode: "work".to_string(),
            locale: Some("ko-KR".to_string()),
            ui_state: ProvocationAgentUiState {
                goal_summary: Some("Build a todo app".to_string()),
                plan_summary: Some(PlanSummary {
                    step_count: 2,
                    active_step: None,
                }),
                verification: SupervisorVerificationUiState {
                    ai_claimed_done: false,
                    diff_reviewed: false,
                    app_launched: false,
                    preview_checked: false,
                    automated_tests_passed: false,
                    test_result: None,
                    test_command: None,
                    test_exit_code: None,
                    acceptance_criterion_confirmed: false,
                    manual_checks: vec![],
                },
                feasibility: VerificationFeasibility {
                    runnable: false,
                    previewable: false,
                    has_tests: false,
                    diff_available: false,
                },
            },
            project_id: Some(7),
            plan_id: Some(9),
            allowed_action_ids: vec![
                SupervisorActionId::AddVerificationStep,
                SupervisorActionId::LinkCriterion,
                SupervisorActionId::DismissReview,
            ],
            evidence_refs: vec![
                ScopeExpansionEvidenceRefInput {
                    id: "plan.goal".to_string(),
                    source: Some("goal".to_string()),
                    kind: Some("plan_goal".to_string()),
                    label: Some("Plan goal".to_string()),
                    value_summary: json!("Build a todo app"),
                    verification_evidence: false,
                },
                ScopeExpansionEvidenceRefInput {
                    id: "plan.step.s_001.verification".to_string(),
                    source: Some("plan".to_string()),
                    kind: Some("verification_coverage".to_string()),
                    label: Some("Missing verification".to_string()),
                    value_summary: json!({"stepId":"s_001"}),
                    verification_evidence: false,
                },
            ],
            scope_expansion: None,
            plan_draft_assessment: Some(PlanDraftReviewAssessment {
                eligible: true,
                reason_codes: vec!["missing_verification".into()],
                evidence_refs: vec!["plan.goal".into(), "plan.step.s_001.verification".into()],
                step_count: 2,
                criteria_count: 1,
                unverified_step_ids: vec!["s_001".into()],
                unlinked_step_ids: vec![],
            }),
            diff_ready_assessment: None,
            retry_loop_assessment: None,
        }
    }

    fn diff_ready_request() -> ProvocationAgentEvaluateRequest {
        ProvocationAgentEvaluateRequest {
            session_id: 790,
            event: SupervisorEvent::DiffReady,
            artifact_ref: ArtifactRef::diff("step-1:diff", "Changed work"),
            source_ui_mode: "work".to_string(),
            locale: Some("ko-KR".to_string()),
            ui_state: ProvocationAgentUiState {
                goal_summary: Some("Keep settings changes scoped".to_string()),
                plan_summary: Some(PlanSummary {
                    step_count: 1,
                    active_step: Some("Settings save".to_string()),
                }),
                verification: SupervisorVerificationUiState {
                    ai_claimed_done: false,
                    diff_reviewed: false,
                    app_launched: false,
                    preview_checked: false,
                    automated_tests_passed: false,
                    test_result: None,
                    test_command: None,
                    test_exit_code: None,
                    acceptance_criterion_confirmed: false,
                    manual_checks: vec![],
                },
                feasibility: VerificationFeasibility {
                    runnable: false,
                    previewable: false,
                    has_tests: true,
                    diff_available: true,
                },
            },
            project_id: Some(7),
            plan_id: Some(9),
            allowed_action_ids: vec![
                SupervisorActionId::OpenDiff,
                SupervisorActionId::AskAiForRationale,
                SupervisorActionId::RunTests,
                SupervisorActionId::DismissReview,
            ],
            evidence_refs: vec![
                ScopeExpansionEvidenceRefInput {
                    id: "diff.changed_files".to_string(),
                    source: Some("diff".to_string()),
                    kind: Some("changed_file".to_string()),
                    label: Some("Changed files".to_string()),
                    value_summary: json!({"paths":["src/auth/session.ts"]}),
                    verification_evidence: false,
                },
                ScopeExpansionEvidenceRefInput {
                    id: "diff.unexpected_files".to_string(),
                    source: Some("diff".to_string()),
                    kind: Some("changed_file".to_string()),
                    label: Some("Unexpected files".to_string()),
                    value_summary: json!({"paths":["src/auth/session.ts"]}),
                    verification_evidence: false,
                },
            ],
            scope_expansion: None,
            plan_draft_assessment: None,
            diff_ready_assessment: Some(DiffReadyReviewAssessment {
                eligible: true,
                reason_codes: vec!["outside_expected_files".into()],
                evidence_refs: vec!["diff.changed_files".into(), "diff.unexpected_files".into()],
                changed_file_count: 1,
                unexpected_files: vec!["src/auth/session.ts".into()],
                high_risk_files: vec!["src/auth/session.ts".into()],
                diff_viewed: false,
            }),
            retry_loop_assessment: None,
        }
    }

    fn retry_loop_request() -> ProvocationAgentEvaluateRequest {
        ProvocationAgentEvaluateRequest {
            session_id: 791,
            event: SupervisorEvent::RetryLoop,
            artifact_ref: ArtifactRef::failure("step-1:failure", "Repeated failure"),
            source_ui_mode: "work".to_string(),
            locale: Some("ko-KR".to_string()),
            ui_state: ProvocationAgentUiState {
                goal_summary: Some("Fix settings save".to_string()),
                plan_summary: Some(PlanSummary {
                    step_count: 1,
                    active_step: Some("Settings save".to_string()),
                }),
                verification: SupervisorVerificationUiState {
                    ai_claimed_done: false,
                    diff_reviewed: false,
                    app_launched: false,
                    preview_checked: false,
                    automated_tests_passed: false,
                    test_result: Some(TestResult::Fail),
                    test_command: Some("pnpm test".to_string()),
                    test_exit_code: Some(1),
                    acceptance_criterion_confirmed: false,
                    manual_checks: vec![],
                },
                feasibility: VerificationFeasibility {
                    runnable: false,
                    previewable: false,
                    has_tests: true,
                    diff_available: true,
                },
            },
            project_id: Some(7),
            plan_id: Some(9),
            allowed_action_ids: vec![
                SupervisorActionId::CreateReproSteps,
                SupervisorActionId::RollbackLastChange,
                SupervisorActionId::OpenDiff,
                SupervisorActionId::RunTests,
                SupervisorActionId::DismissReview,
            ],
            evidence_refs: vec![
                ScopeExpansionEvidenceRefInput {
                    id: "failure.fingerprint".to_string(),
                    source: Some("terminal".to_string()),
                    kind: Some("failure_summary".to_string()),
                    label: Some("Failure fingerprint".to_string()),
                    value_summary: json!({"fingerprint":"typeerror_at_save"}),
                    verification_evidence: false,
                },
                ScopeExpansionEvidenceRefInput {
                    id: "failure.count".to_string(),
                    source: Some("verification".to_string()),
                    kind: Some("retry_loop_assessment".to_string()),
                    label: Some("Failure count".to_string()),
                    value_summary: json!({"count":2}),
                    verification_evidence: false,
                },
            ],
            scope_expansion: None,
            plan_draft_assessment: None,
            diff_ready_assessment: None,
            retry_loop_assessment: Some(RetryLoopReviewAssessment {
                eligible: true,
                reason_codes: vec!["same_failure_repeated".into()],
                evidence_refs: vec!["failure.fingerprint".into(), "failure.count".into()],
                failure_fingerprint: "typeerror_at_save".into(),
                failure_count: 2,
                last_failure_at: json!(2000),
                last_action_summary: Some("verification_failed".into()),
                recovery_available: true,
            }),
        }
    }

    fn valid_scope_expansion_decision_json() -> String {
        r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "scope_expansion",
            "severity": "caution",
            "question": "이 추가 단계가 기존 PRD 기준과 연결되는지 먼저 확인할까요?",
            "evidenceRefIds": ["add_step.title", "add_step.linked_criterion_ids", "scope.assessment"],
            "suggestedActionIds": ["link_criterion", "split_scope", "continue_with_risk"],
            "supervisionHabit": "새 범위는 PRD 기준에 묶어 봅니다.",
            "logRationale": "Add-step draft lacks a linked criterion"
        }"#
        .to_string()
    }

    fn valid_plan_drafted_decision_json() -> String {
        r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "plan_draft_weakness",
            "severity": "caution",
            "question": "이 계획은 검증 없이 승인해도 완료 판단이 가능한가요?",
            "evidenceRefIds": ["plan.goal", "plan.step.s_001.verification"],
            "suggestedActionIds": ["add_verification_step", "link_criterion", "run_tests"],
            "supervisionHabit": "승인 전 검증 가능한 계획인지 봅니다.",
            "logRationale": "Missing verification coverage"
        }"#
        .to_string()
    }

    fn valid_diff_ready_decision_json() -> String {
        r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "diff_scope_drift",
            "severity": "caution",
            "question": "이 변경 파일이 현재 목표 범위 안에 있나요?",
            "evidenceRefIds": ["diff.changed_files", "diff.unexpected_files"],
            "suggestedActionIds": ["open_diff", "ask_ai_for_rationale", "run_tests"],
            "supervisionHabit": "변경 범위는 목표와 나란히 확인합니다.",
            "logRationale": "Changed files include an unexpected path"
        }"#
        .to_string()
    }

    fn valid_retry_loop_decision_json() -> String {
        r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "retry_loop",
            "severity": "caution",
            "question": "같은 실패가 반복되니 먼저 재현 단계를 좁혀볼까요?",
            "evidenceRefIds": ["failure.fingerprint", "failure.count"],
            "suggestedActionIds": ["create_repro_steps", "rollback_last_change", "run_tests"],
            "supervisionHabit": "반복 실패는 재현과 복구 지점부터 봅니다.",
            "logRationale": "Same failure fingerprint repeated"
        }"#
        .to_string()
    }

    fn self_report_only_verification() -> SupervisorVerificationUiState {
        SupervisorVerificationUiState {
            ai_claimed_done: true,
            diff_reviewed: false,
            app_launched: false,
            preview_checked: false,
            automated_tests_passed: false,
            test_result: Some(TestResult::Skipped),
            test_command: None,
            test_exit_code: None,
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
        verification.test_command = Some("pnpm test".to_string());
        verification.test_exit_code = Some(0);
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

    #[test]
    fn provocation_agent_evaluate_scope_expansion_maps_valid_decision_to_non_blocking_card() {
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            scope_expansion_request(),
            StageCSupervisorOutput::DecisionJson {
                raw: valid_scope_expansion_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(88),
                usage: Some(json!({ "inputTokens": 12 })),
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Shown
        );
        let card = evaluated.response.card.as_ref().unwrap();
        assert_eq!(card.card_type, ProvocationCardType::ScopeExpansion);
        assert_eq!(card.stage, ProvocationCardStage::Extend);
        assert_eq!(card.metadata["concern"], json!("scope_expansion"));
        assert_eq!(
            card.actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<Vec<_>>(),
            vec!["link_criterion", "split_scope"]
        );
        assert_eq!(
            card.metadata["supervisorEvaluationId"],
            json!(evaluated.response.evaluation_id)
        );

        let log = evaluated.log.expect("scope evaluation is locally logged");
        assert_eq!(log.event, SupervisorEvent::ScopeExpansion);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Shown);
        assert_eq!(log.drop_reason, None);
        assert_eq!(log.supervisor_model.as_deref(), Some("mock-supervisor"));
        assert_eq!(log.latency_ms, Some(88));
        assert!(log
            .evidence_refs
            .iter()
            .any(|evidence| evidence.id == "add_step.linked_criterion_ids"));
    }

    #[test]
    fn provocation_agent_evaluate_scope_expansion_drops_invalid_decision_with_log() {
        let raw = r#"{
            "schemaVersion": 1,
            "provoke": true,
            "concern": "scope_expansion",
            "severity": "caution",
            "question": "이 추가 단계가 기존 PRD 기준과 연결되는지 먼저 확인할까요?",
            "evidenceRefIds": ["prd.ac_missing"],
            "suggestedActionIds": ["link_criterion"],
            "supervisionHabit": "새 범위는 PRD 기준에 묶어 봅니다.",
            "logRationale": "Unknown evidence"
        }"#;
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            scope_expansion_request(),
            StageCSupervisorOutput::DecisionJson {
                raw: raw.to_string(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(30),
                usage: None,
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Dropped
        );
        assert_eq!(
            evaluated.response.drop_reason,
            Some(SupervisorDropReason::UnknownEvidenceRef)
        );
        assert!(evaluated.response.card.is_none());
        let log = evaluated.log.expect("invalid scope decision is logged");
        assert_eq!(log.event, SupervisorEvent::ScopeExpansion);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Dropped);
        assert_eq!(
            log.drop_reason,
            Some(SupervisorDropReason::UnknownEvidenceRef)
        );
    }

    #[test]
    fn provocation_agent_evaluate_scope_expansion_timeout_and_unavailable_have_no_card_and_log() {
        for (output, reason) in [
            (
                StageCSupervisorOutput::Timeout,
                SupervisorDropReason::Timeout,
            ),
            (
                StageCSupervisorOutput::RuntimeUnavailable,
                SupervisorDropReason::RuntimeUnavailable,
            ),
        ] {
            let mut dedup = SupervisorDedupState::new();
            let evaluated =
                evaluate_with_output_and_log(scope_expansion_request(), output, &mut dedup);

            assert_eq!(
                evaluated.response.status,
                ProvocationAgentEvaluateStatus::Dropped
            );
            assert_eq!(evaluated.response.drop_reason, Some(reason));
            assert!(evaluated.response.card.is_none());
            let log = evaluated.log.expect("scope no-card outcome is logged");
            assert_eq!(log.event, SupervisorEvent::ScopeExpansion);
            assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Dropped);
            assert_eq!(log.drop_reason, Some(reason));
        }
    }

    #[test]
    fn provocation_agent_evaluate_scope_expansion_has_no_domain_shell_fallback_card() {
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            scope_expansion_request(),
            StageCSupervisorOutput::DomainShell,
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Dropped
        );
        assert_eq!(
            evaluated.response.drop_reason,
            Some(SupervisorDropReason::RuntimeUnavailable)
        );
        assert!(evaluated.response.card.is_none());
        let log = evaluated.log.expect("scope fallback suppression is logged");
        assert_eq!(log.event, SupervisorEvent::ScopeExpansion);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Dropped);
    }

    #[test]
    fn provocation_agent_evaluate_scope_expansion_false_assessment_logs_no_card() {
        let mut request = scope_expansion_request();
        request.scope_expansion.as_mut().unwrap().expanded = false;
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            request,
            StageCSupervisorOutput::DecisionJson {
                raw: valid_scope_expansion_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(20),
                usage: None,
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::NoCard
        );
        assert_eq!(
            evaluated.response.drop_reason,
            Some(SupervisorDropReason::ProvokeFalse)
        );
        assert!(evaluated.response.card.is_none());
        let log = evaluated.log.expect("scope no-card evaluation is logged");
        assert_eq!(log.event, SupervisorEvent::ScopeExpansion);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::NoCard);
    }

    #[test]
    fn provocation_agent_evaluate_plan_drafted_maps_valid_decision_without_static_fallback() {
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            plan_drafted_request(),
            StageCSupervisorOutput::DecisionJson {
                raw: valid_plan_drafted_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(40),
                usage: None,
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Shown
        );
        let card = evaluated.response.card.as_ref().unwrap();
        assert_eq!(card.card_type, ProvocationCardType::PlanDraftReview);
        assert_eq!(card.stage, ProvocationCardStage::Instruct);
        assert_eq!(card.metadata["supervisorEvent"], json!("plan_drafted"));
        assert_eq!(
            card.actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<Vec<_>>(),
            vec!["add_verification_step", "link_criterion"]
        );
        let log = evaluated.log.expect("plan-draft evaluation is logged");
        assert_eq!(log.event, SupervisorEvent::PlanDrafted);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Shown);
        assert!(log.assessment_summary.is_some());
    }

    #[test]
    fn provocation_agent_evaluate_plan_drafted_false_or_unavailable_has_no_card() {
        let mut request = plan_drafted_request();
        request.plan_draft_assessment.as_mut().unwrap().eligible = false;
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            request,
            StageCSupervisorOutput::DecisionJson {
                raw: valid_plan_drafted_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(20),
                usage: None,
            },
            &mut dedup,
        );
        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::NoCard
        );
        assert!(evaluated.response.card.is_none());

        let mut dedup = SupervisorDedupState::new();
        let unavailable = evaluate_with_output_and_log(
            plan_drafted_request(),
            StageCSupervisorOutput::DomainShell,
            &mut dedup,
        );
        assert_eq!(
            unavailable.response.status,
            ProvocationAgentEvaluateStatus::Dropped
        );
        assert_eq!(
            unavailable.response.drop_reason,
            Some(SupervisorDropReason::RuntimeUnavailable)
        );
        assert!(unavailable.response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_diff_ready_maps_valid_decision_without_static_fallback() {
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            diff_ready_request(),
            StageCSupervisorOutput::DecisionJson {
                raw: valid_diff_ready_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(41),
                usage: None,
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Shown
        );
        let card = evaluated.response.card.as_ref().unwrap();
        assert_eq!(card.card_type, ProvocationCardType::DiffScopeReview);
        assert_eq!(card.stage, ProvocationCardStage::Verify);
        assert_eq!(card.metadata["supervisorEvent"], json!("diff_ready"));
        assert_eq!(
            card.actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<Vec<_>>(),
            vec!["open_diff", "ask_ai_for_rationale", "run_tests"]
        );
        let log = evaluated.log.expect("diff-ready evaluation is logged");
        assert_eq!(log.event, SupervisorEvent::DiffReady);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Shown);
        assert!(log.assessment_summary.is_some());
    }

    #[test]
    fn provocation_agent_evaluate_diff_ready_false_or_unavailable_has_no_card() {
        let mut request = diff_ready_request();
        request.diff_ready_assessment.as_mut().unwrap().eligible = false;
        request.diff_ready_assessment.as_mut().unwrap().reason_codes = vec![];
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            request,
            StageCSupervisorOutput::DecisionJson {
                raw: valid_diff_ready_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(20),
                usage: None,
            },
            &mut dedup,
        );
        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::NoCard
        );
        assert_eq!(
            evaluated.response.drop_reason,
            Some(SupervisorDropReason::ProvokeFalse)
        );
        assert!(evaluated.response.card.is_none());

        let mut dedup = SupervisorDedupState::new();
        let unavailable = evaluate_with_output_and_log(
            diff_ready_request(),
            StageCSupervisorOutput::DomainShell,
            &mut dedup,
        );
        assert_eq!(
            unavailable.response.status,
            ProvocationAgentEvaluateStatus::Dropped
        );
        assert_eq!(
            unavailable.response.drop_reason,
            Some(SupervisorDropReason::RuntimeUnavailable)
        );
        assert!(unavailable.response.card.is_none());
    }

    #[test]
    fn provocation_agent_evaluate_retry_loop_maps_valid_decision_without_static_fallback() {
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            retry_loop_request(),
            StageCSupervisorOutput::DecisionJson {
                raw: valid_retry_loop_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(42),
                usage: None,
            },
            &mut dedup,
        );

        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::Shown
        );
        let card = evaluated.response.card.as_ref().unwrap();
        assert_eq!(card.card_type, ProvocationCardType::RetryLoopReview);
        assert_eq!(card.stage, ProvocationCardStage::Verify);
        assert_eq!(card.metadata["supervisorEvent"], json!("retry_loop"));
        assert_eq!(
            card.actions
                .iter()
                .map(|action| action.id.as_str())
                .collect::<Vec<_>>(),
            vec!["create_repro_steps", "rollback_last_change", "run_tests"]
        );
        let log = evaluated.log.expect("retry-loop evaluation is logged");
        assert_eq!(log.event, SupervisorEvent::RetryLoop);
        assert_eq!(log.validation_outcome, SupervisorValidationOutcome::Shown);
        assert!(log.assessment_summary.is_some());
    }

    #[test]
    fn provocation_agent_evaluate_retry_loop_false_timeout_or_unavailable_has_no_card() {
        let mut request = retry_loop_request();
        request
            .retry_loop_assessment
            .as_mut()
            .unwrap()
            .failure_count = 1;
        let mut dedup = SupervisorDedupState::new();
        let evaluated = evaluate_with_output_and_log(
            request,
            StageCSupervisorOutput::DecisionJson {
                raw: valid_retry_loop_decision_json(),
                supervisor_model: Some("mock-supervisor".to_string()),
                latency_ms: Some(20),
                usage: None,
            },
            &mut dedup,
        );
        assert_eq!(
            evaluated.response.status,
            ProvocationAgentEvaluateStatus::NoCard
        );
        assert_eq!(
            evaluated.response.drop_reason,
            Some(SupervisorDropReason::ProvokeFalse)
        );
        assert!(evaluated.response.card.is_none());

        for (output, reason) in [
            (
                StageCSupervisorOutput::DomainShell,
                SupervisorDropReason::RuntimeUnavailable,
            ),
            (
                StageCSupervisorOutput::Timeout,
                SupervisorDropReason::Timeout,
            ),
            (
                StageCSupervisorOutput::RuntimeUnavailable,
                SupervisorDropReason::RuntimeUnavailable,
            ),
        ] {
            let mut dedup = SupervisorDedupState::new();
            let unavailable =
                evaluate_with_output_and_log(retry_loop_request(), output, &mut dedup);
            assert_eq!(
                unavailable.response.status,
                ProvocationAgentEvaluateStatus::Dropped
            );
            assert_eq!(unavailable.response.drop_reason, Some(reason));
            assert!(unavailable.response.card.is_none());
        }
    }
}
