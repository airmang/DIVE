use serde_json::Value;

use crate::dive::event_log as dive_event_log;

use super::AppState;

pub(super) fn log_event(
    state: &AppState,
    session_id: Option<i64>,
    event_type: &str,
    payload: Value,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    dive_event_log::append_to_conn(db.conn(), session_id, event_type, payload)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub(super) fn log_error_event(
    state: &AppState,
    session_id: Option<i64>,
    source: &str,
    message: &str,
) -> Result<(), String> {
    log_event(
        state,
        session_id,
        "error_occurred",
        dive_event_log::error_payload(source, message),
    )
}
