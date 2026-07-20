//! Workspace-plan IPC: PRD interview, plan drafting/mutation, routing, and
//! criterion-quality gating. Split from a single `workspace_plan.rs` file
//! (Wily S-066); submodules are re-exported flat so external paths
//! (`crate::ipc::workspace_plan::*`, `crate::ipc::*`) are unchanged.

mod commands;
mod dashboard;
mod plan_lifecycle;
mod plan_routing;
mod plan_steps;
mod prd_core;
mod prd_interview;
mod prd_patch;
mod quality_gate;
mod roadmap;
mod types;

pub use commands::*;
pub use dashboard::*;
pub use plan_lifecycle::*;
pub use plan_routing::*;
pub use plan_steps::*;
pub use prd_core::*;
pub use prd_interview::*;
pub use roadmap::*;
pub use types::*;

// `prd_patch` and `quality_gate` expose no `pub` items — only `pub(super)`
// helpers shared across sibling submodules. A private glob re-export makes those
// helpers reachable from siblings (via `use super::*`) without publicly
// re-exporting anything, which a `pub use` glob would warn about.
use prd_patch::*;
use quality_gate::*;
