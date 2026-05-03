//! Tauri Commands (IPC).
//!
//! 명세 §11.5. 프론트엔드 ↔ 백엔드 IPC. `chat_send`, `tool_approve`,
//! `tool_reject`, `project_open`, `checkpoint_restore`, `provider_connect` 등을
//! `#[tauri::command]`로 노출한다. 작업별로 필요한 command를 누적 등록.
