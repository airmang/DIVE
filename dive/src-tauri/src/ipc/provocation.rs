use serde_json::Value;
use tauri::State;

use crate::dive::event_log::append_provocation_event_to_conn;

use super::AppState;

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
    let db = state.db.lock().map_err(|e| e.to_string())?;
    append_provocation_event_to_conn(db.conn(), session_id, &event_type, &payload)
        .map(|_| ())
        .map_err(|e| e.to_string())
}
