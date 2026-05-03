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

pub use db::Database;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
