#![allow(dead_code)]

pub mod agent;
pub mod auth;
pub mod checkpoint;
pub mod db;
pub mod dive;
pub mod export;
pub mod ipc;
pub mod mcp;
pub mod providers;
pub mod tools;

pub use auth::{AuthError, Keyring, OsKeyring, SecretScope};
pub use db::Database;
pub use ipc::AppState;
#[cfg(any(test, debug_assertions, feature = "dev-mock"))]
pub use providers::MockProvider;
pub use providers::{
    AnthropicProvider, ChatEvent, ChatRequest, CodexProvider, FinishReason, LlmProvider, Message,
    ModelInfo, OpenAiProvider, ProviderError, ToolCall, ToolChoice, ToolDef, Usage,
};
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_state = ipc::AppState::from_app_handle(app.handle())?;
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ipc::message_list,
            ipc::chat_send,
            ipc::chat_cancel,
            ipc::tool_approve,
            ipc::tool_deny,
            ipc::workmap_set_current_card,
            ipc::workmap_get,
            ipc::card_create,
            ipc::card_list,
            ipc::card_delete,
            ipc::card_reorder,
            ipc::card_tool_call_stats,
            ipc::card_update_instruction,
            ipc::card_update_test_command,
            ipc::card_transition,
            ipc::card_verify,
            ipc::ai_assist_cards,
            ipc::checkpoint_create,
            ipc::checkpoint_restore,
            ipc::checkpoint_list,
            ipc::openrouter_issue_key,
            ipc::openrouter_revoke_all,
            ipc::openrouter_list_keys,
            ipc::export_session,
            ipc::project_create,
            ipc::project_list,
            ipc::project_get,
            ipc::project_open,
            ipc::project_delete,
            ipc::session_create,
            ipc::session_list,
            ipc::session_rename,
            ipc::session_archive,
            ipc::session_delete,
            ipc::provider_connect,
            ipc::provider_list,
            ipc::provider_disconnect,
            ipc::provider_policy_get,
            ipc::provider_policy_set,
            ipc::checkpoint_timeline,
            ipc::codex_oauth_start,
            ipc::codex_oauth_complete,
            ipc::codex_oauth_status,
            ipc::codex_oauth_logout,
            ipc::codex_oauth_refresh,
            ipc::mcp_server_add,
            ipc::mcp_server_list,
            ipc::mcp_server_remove,
            ipc::mcp_server_set_enabled,
            ipc::mcp_server_test_connect,
            ipc::mcp_server_list_tools,
            ipc::prompt_check_review
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
