//! DIVE Gate Engine (spec §4.7).
//!
//! Task 3-1 extends D-only enforcement into full I/V/E gates plus the
//! card state machine (spec §4.6 figure 4). `DiveGateEngine::check` routes
//! by stage; `state_machine::apply` validates card transitions.

pub mod assist;
pub mod gate;
pub mod prompt_check;
pub mod state_machine;
pub mod verify;

pub use assist::{AiAssistEngine, AssistError, AssistedCard};
pub use gate::{card_tool_call_count, DiveGateEngine, DiveStage, GateDecision};
pub use prompt_check::{PromptCheckEngine, PromptCheckError, PromptCheckResult, PromptIssue};
pub use state_machine::{apply as apply_transition, CardTransition, TransitionError};
pub use verify::{TestResult, VerifyEngine, VerifyError, VerifyLog};
