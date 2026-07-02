use serde_json::Value;
use tauri::State;

use super::{log_event, AppState};

#[tauri::command]
pub fn log_ui_event(
    state: State<'_, AppState>,
    session_id: Option<i64>,
    event_type: String,
    payload: Value,
) -> Result<(), String> {
    log_ui_event_impl(&state, session_id, event_type, payload)
}

pub fn log_ui_event_impl(
    state: &AppState,
    session_id: Option<i64>,
    event_type: String,
    payload: Value,
) -> Result<(), String> {
    if !event_type.starts_with("permission_primer.") {
        return Err("unsupported UI event type".into());
    }
    log_event(state, session_id, &event_type, payload)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::db::dao::event_log;
    use crate::dive::event_log as dive_event_log;

    #[test]
    fn log_ui_event_rejects_non_permission_primer_prefix() {
        let state = AppState::dev_mock();
        let err =
            log_ui_event_impl(&state, None, "other_ui_event.shown".into(), json!({})).unwrap_err();
        assert!(err.contains("unsupported UI event type"));
        let db = state.db.lock().unwrap();
        assert!(event_log::list(db.conn()).unwrap().is_empty());
    }

    #[test]
    fn log_ui_event_appends_valid_permission_primer_event() {
        let state = AppState::dev_mock();
        log_ui_event_impl(
            &state,
            None,
            dive_event_log::PERMISSION_PRIMER_SHOWN_EVENT.into(),
            json!({"variant":"generic"}),
        )
        .unwrap();

        let db = state.db.lock().unwrap();
        let rows = event_log::list(db.conn()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].r#type,
            dive_event_log::PERMISSION_PRIMER_SHOWN_EVENT
        );
        assert_eq!(rows[0].payload["variant"], json!("generic"));
    }
}
