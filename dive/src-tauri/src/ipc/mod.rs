//! Tauri IPC commands (spec §11.5).
//!
//! Task 3-1 extends the Phase 2 surface with card state-machine commands
//! and legacy stage telemetry on `chat_send`.
//!
//! Task 4-1 adds project / session / provider CRUD via the sibling
//! `project`, `session`, and `provider` submodules. The keyring used for
//! provider secrets defaults to the OS-native backend but can be swapped
//! (tests use `InMemoryKeyring`).

mod assist;
mod cards;
mod chat;
mod checkpoint;
pub mod codex_oauth;
mod events;
pub mod mcp;
pub mod policy;
pub mod preview;
pub mod project;
pub mod provider;
pub mod provider_runtime;
mod provocation;
mod provocation_agent;
pub mod session;
mod state;
#[cfg(test)]
mod tests;
pub mod timeline;
mod ui_events;
mod verification_coach;
pub mod workmap;
pub mod workspace_plan;

pub use assist::*;
pub use cards::*;
pub use chat::*;
pub use checkpoint::*;
pub use codex_oauth::*;
pub use mcp::*;
pub use policy::*;
pub use preview::*;
pub use project::*;
pub use provider::*;
pub use provider_runtime::*;
pub use provocation::*;
pub use provocation_agent::*;
pub use session::*;
pub use state::*;
pub use timeline::*;
pub use ui_events::*;
pub use verification_coach::*;
pub use workmap::*;
pub use workspace_plan::*;

use events::{log_error_event, log_event};
