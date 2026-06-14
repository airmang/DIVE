//! DIVE card lifecycle and plan-first helpers.

pub mod approval;
pub mod assist;
pub mod card_metrics;
pub mod event_log;
pub mod plan_interview;
pub mod plan_router;
pub mod prompt_check;
pub mod state_machine;
pub mod supervisor;
pub mod verify;

pub use approval::{ApprovalJudgment, ApprovalOutcome};
pub use assist::{AiAssistEngine, AssistError, AssistedCard};
pub use card_metrics::card_tool_call_count;
pub use plan_interview::{
    build_system_prompt as build_plan_interview_system_prompt, plan_interview_tool,
    EMIT_PLAN_DRAFT_TOOL_NAME,
};
pub use prompt_check::{PromptCheckEngine, PromptCheckError, PromptCheckResult, PromptIssue};
pub use state_machine::{apply as apply_transition, CardTransition, TransitionError};
pub use supervisor::{
    allowed_actions_for_p1, build_p1_evidence_refs, build_stage_c_supervisor_decision,
    build_supervisor_context_from_ui, build_supervisor_prompt, compute_verification_feasibility,
    deterministic_card_id, dropped_validation_result, error_validation_result,
    invalid_mode_validation_result, map_decision_to_card_at, no_card_validation_result,
    normalize_source_ui_mode, p1_provoke_gate, parse_supervisor_decision,
    record_ai_claimed_done_evidence, validate_supervisor_decision,
    validate_supervisor_decision_json, ArtifactRef, EvidenceKind, EvidenceRef, EvidenceSource,
    NormalizedSupervisorMode, PlanSummary, ProjectStateFeasibilityInput, ProvocationAction,
    ProvocationCard, ProvocationCardStage, ProvocationCardType, ProvocationEvidence,
    ProvocationSeverity, SourceUiMode, SupervisorActionId, SupervisorContext,
    SupervisorContextBuildInput, SupervisorContextBuildResult, SupervisorDecision,
    SupervisorDecisionSummary, SupervisorDedupKey, SupervisorDedupState, SupervisorDropReason,
    SupervisorEvaluationLog, SupervisorEvent, SupervisorMode, SupervisorValidationOutcome,
    SupervisorValidationResult, SupervisorVerificationUiState, TestResult as SupervisorTestResult,
    VerificationFeasibility, VerificationState,
};
pub use verify::{TestResult, VerifyEngine, VerifyError, VerifyLog};
