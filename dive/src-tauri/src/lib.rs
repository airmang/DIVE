#![allow(dead_code)]

pub mod agent;
pub mod auth;
pub mod checkpoint;
pub mod db;
pub mod dive;
pub mod ipc;
pub mod mcp;
pub mod providers;
pub mod tools;

pub use auth::{AuthError, Keyring, OsKeyring, SecretScope};
pub use db::Database;
pub use ipc::AppState;
pub use providers::{
    AnthropicProvider, ChatEvent, ChatRequest, FinishReason, LlmProvider, Message, MockProvider,
    ModelInfo, OpenAiProvider, ProviderError, ToolCall, ToolChoice, ToolDef, Usage,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = ipc::AppState::dev_mock();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            ipc::chat_send,
            ipc::chat_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
