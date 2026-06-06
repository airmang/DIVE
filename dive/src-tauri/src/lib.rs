#![allow(dead_code)]

pub mod agent;
pub mod auth;
pub mod checkpoint;
pub mod db;
pub mod dive;
pub mod export;
pub(crate) mod http_client;
pub mod ipc;
pub mod mcp;
pub mod menu;
pub mod pi_sidecar;
pub mod providers;
pub(crate) mod telemetry;
pub mod tools;
pub mod workspace_plan;

pub use auth::{AuthError, Keyring, OsKeyring, SecretScope};
pub use db::Database;
pub use ipc::AppState;
#[cfg(any(test, feature = "dev-mock"))]
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
    telemetry::install_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            match telemetry::init_file_logging(app.handle()) {
                Ok(Some(logs_dir)) => {
                    tracing::info!(logs_dir = %logs_dir.display(), "file logging initialized");
                }
                Ok(None) => {}
                Err(err) => {
                    let _ = err;
                }
            }

            tracing::info!("tauri setup starting");
            let app_state = match ipc::AppState::from_app_handle(app.handle()) {
                Ok(app_state) => app_state,
                Err(err) => {
                    tracing::error!(
                        error = %telemetry::redact_log_text(&err.to_string()),
                        "startup state initialization failed"
                    );
                    return Err(err.into());
                }
            };
            app.manage(app_state);

            let recents = ipc::fetch_recent_projects_for_menu(app.handle()).unwrap_or_default();
            let menu = menu::build_menu(app.handle(), &recents)?;
            app.set_menu(menu)?;
            menu::install_event_handler(app.handle());

            tracing::info!(
                recent_project_count = recents.len(),
                "tauri setup completed"
            );
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
            ipc::card_save_retrospective,
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
            ipc::project_select,
            ipc::project_delete,
            ipc::session_create,
            ipc::session_list,
            ipc::session_rename,
            ipc::session_archive,
            ipc::session_delete,
            ipc::provider_connect,
            ipc::provider_list,
            ipc::provider_list_models,
            ipc::provider_set_model,
            ipc::provider_disconnect,
            ipc::provider_policy_get,
            ipc::provider_policy_set,
            ipc::research_settings_get,
            ipc::research_settings_set,
            ipc::checkpoint_timeline,
            ipc::codex_oauth_start,
            ipc::codex_oauth_complete,
            ipc::codex_oauth_status,
            ipc::codex_oauth_logout,
            ipc::codex_oauth_refresh,
            ipc::pi_sidecar_codex_smoke,
            ipc::mcp_server_add,
            ipc::mcp_server_list,
            ipc::mcp_server_remove,
            ipc::mcp_server_set_enabled,
            ipc::mcp_server_test_connect,
            ipc::mcp_server_list_tools,
            ipc::prompt_check_review,
            ipc::menu_refresh_recents,
            ipc::workspace_plan_status,
            ipc::workspace_plan_dashboard,
            ipc::workspace_plan_activity,
            ipc::workspace_plan_start_interview,
            ipc::workspace_plan_save_interview_answer,
            ipc::workspace_plan_submit_interview,
            ipc::workspace_plan_generate_draft,
            ipc::workspace_plan_approve,
            ipc::workspace_plan_discard_plan,
            ipc::workspace_plan_list_steps,
            ipc::workspace_plan_step_mappings,
            ipc::workspace_plan_route_chat,
            ipc::workspace_plan_route_cancel,
            ipc::workspace_plan_append_step,
            ipc::roadmap_step_open,
            ipc::roadmap_step_update_state
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|err| {
            tracing::error!(
                error = %telemetry::redact_log_text(&err.to_string()),
                "tauri runtime failed"
            );
            panic!("error while running tauri application: {err}");
        });
}
