//! DIVE Gate Engine (spec §4.7).
//!
//! Task 2-6 implements the D-stage gate only: block chat when the session's
//! workmap has zero cards. I/V/E gates are placeholders (always Allow) and
//! land in task 3-1 alongside the full card state machine.

pub mod gate;

pub use gate::{DiveGateEngine, DiveStage, GateDecision};
