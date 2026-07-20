//! Deterministic supervisor-domain contracts for P1 review cards.
//!
//! The Pi SupervisorAgent returns a `SupervisorDecision`; DIVE validates that
//! decision against Rust-owned context before any UI-facing card is created.

pub(crate) const SUPERVISOR_SCHEMA_VERSION: u8 = 1;
pub(crate) const P1_CONCERN: &str = "ai_self_report_only";
pub(crate) const SCOPE_EXPANSION_CONCERN: &str = "scope_expansion";
pub(crate) const PLAN_DRAFT_CONCERN: &str = "plan_draft_weakness";
pub(crate) const DIFF_READY_CONCERN: &str = "diff_scope_drift";
pub(crate) const RETRY_LOOP_CONCERN: &str = "retry_loop";
pub(crate) const QUESTION_MAX_CHARS: usize = 140;
pub(crate) const SUPERVISION_HABIT_MAX_CHARS: usize = 60;
pub(crate) const CARD_EVIDENCE_CAP: usize = 3;
pub(crate) const CARD_ACTION_CAP: usize = 3;
pub(crate) const DEFAULT_CARD_CREATED_AT: &str = "1970-01-01T00:00:00.000Z";
pub(crate) const SUPERVISOR_PROMPT_MAX_BYTES: usize = 24 * 1024;
pub(crate) const SCOPE_EVIDENCE_SUMMARY_MAX_CHARS: usize = 160;
pub(crate) const SCOPE_EVIDENCE_ARRAY_CAP: usize = 6;
pub(crate) const SCOPE_EVIDENCE_OBJECT_CAP: usize = 12;

mod card;
mod context;
mod decision;
mod evidence;
mod prompt;
#[cfg(test)]
mod tests;

pub use card::*;
pub use context::*;
pub use decision::*;
pub use evidence::*;
pub use prompt::*;
