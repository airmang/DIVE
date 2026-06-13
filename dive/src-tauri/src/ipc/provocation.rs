use serde_json::Value;
use tauri::State;

use super::{log_event, AppState};

#[tauri::command]
pub fn provocation_log_event(
    state: State<'_, AppState>,
    session_id: Option<i64>,
    event_type: String,
    payload: Value,
) -> Result<(), String> {
    if !event_type.starts_with("provocation.") {
        return Err("provocation event type required".into());
    }
    let payload = crate::export::sanitize_provocation_event_payload(&payload);
    log_event(&state, session_id, &event_type, payload)
}
