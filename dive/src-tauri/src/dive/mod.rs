//! DIVE card lifecycle and plan-first helpers.

pub mod approval;
pub mod assist;
pub mod card_metrics;
pub mod event_log;
pub mod plan_interview;
pub mod plan_router;
pub mod prompt_check;
pub mod state_machine;
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
pub use verify::{TestResult, VerifyEngine, VerifyError, VerifyLog};
