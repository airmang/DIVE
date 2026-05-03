//! DIVE Gate Engine (spec §4.7).
//!
//! Task 3-1 extends D-only enforcement into full I/V/E gates plus the
//! card state machine (spec §4.6 figure 4). `DiveGateEngine::check` routes
//! by stage; `state_machine::apply` validates card transitions.

pub mod gate;
pub mod state_machine;

pub use gate::{card_tool_call_count, DiveGateEngine, DiveStage, GateDecision};
pub use state_machine::{apply as apply_transition, CardTransition, TransitionError};
