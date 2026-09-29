//! Settings controls for the local replay corpus (spec 015 FR-021).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::dao::supervision_replay;
use crate::dive::replay::{replay_capture_enabled, set_replay_capture_enabled};

use super::AppState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySettingsDto {
    pub capture_enabled: bool,
    pub record_count: i64,
}

pub(crate) fn replay_settings_get_impl(state: &AppState) -> Result<ReplaySettingsDto, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(ReplaySettingsDto {
        capture_enabled: replay_capture_enabled(db.conn()),
        record_count: supervision_replay::count(db.conn()).map_err(|e| e.to_string())?,
    })
}

pub(crate) fn replay_settings_set_impl(
    state: &AppState,
    capture_enabled: bool,
) -> Result<ReplaySettingsDto, String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        set_replay_capture_enabled(db.conn(), capture_enabled).map_err(|e| e.to_string())?;
    }
    replay_settings_get_impl(state)
}

pub(crate) fn replay_records_clear_impl(state: &AppState) -> Result<ReplaySettingsDto, String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        supervision_replay::clear(db.conn()).map_err(|e| e.to_string())?;
    }
    replay_settings_get_impl(state)
}

#[tauri::command]
pub fn replay_settings_get(state: State<'_, AppState>) -> Result<ReplaySettingsDto, String> {
    replay_settings_get_impl(&state)
}

#[tauri::command]
pub fn replay_settings_set(
    state: State<'_, AppState>,
    capture_enabled: bool,
) -> Result<ReplaySettingsDto, String> {
    replay_settings_set_impl(&state, capture_enabled)
}

/// Delete every stored replay record. Capture stays in its current state.
#[tauri::command]
pub fn replay_records_clear(state: State<'_, AppState>) -> Result<ReplaySettingsDto, String> {
    replay_records_clear_impl(&state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::supervision_replay::{NewSupervisionReplay, ReplaySurface};

    #[test]
    fn settings_toggle_capture_and_clear_records() {
        let state = AppState::dev_mock();
        assert_eq!(
            replay_settings_get_impl(&state).unwrap(),
            ReplaySettingsDto {
                capture_enabled: true,
                record_count: 0
            }
        );
        {
            let db = state.db.lock().unwrap();
            supervision_replay::insert(
                db.conn(),
                &NewSupervisionReplay {
                    evaluation_id: "e1".into(),
                    surface: ReplaySurface::Supervisor,
                    session_id: None,
                    project_id: None,
                    prompt_version: "1.0.0+256c9520".into(),
                    policy_version: None,
                    model: None,
                    context_json: "{}".into(),
                    raw_output: None,
                    validation_json: "{}".into(),
                },
            )
            .unwrap();
        }
        let off = replay_settings_set_impl(&state, false).unwrap();
        assert!(!off.capture_enabled);
        assert_eq!(off.record_count, 1);
        let cleared = replay_records_clear_impl(&state).unwrap();
        assert_eq!(cleared.record_count, 0);
        assert!(!cleared.capture_enabled);
    }
}
