//! Settings controls for the local replay corpus (spec 015 FR-021).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::dao::supervision_replay;
use crate::dive::replay::{
    prune_replay_corpus_best_effort, replay_capture_enabled, set_replay_capture_enabled,
};

use super::AppState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySettingsDto {
    pub capture_enabled: bool,
    pub record_count: i64,
}

/// Reads (and every write) apply retention first, so expired rows age out
/// even while capture is off and nothing is being inserted.
pub(crate) fn replay_settings_get_impl(state: &AppState) -> Result<ReplaySettingsDto, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    prune_replay_corpus_best_effort(db.conn());
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

    fn replay_row(evaluation_id: &str) -> NewSupervisionReplay {
        NewSupervisionReplay {
            evaluation_id: evaluation_id.into(),
            surface: ReplaySurface::Supervisor,
            session_id: None,
            project_id: None,
            prompt_version: "1.0.0+256c9520".into(),
            policy_version: None,
            model: None,
            context_json: "{}".into(),
            raw_output: None,
            validation_json: "{}".into(),
        }
    }

    #[test]
    fn startup_applies_retention_even_with_capture_off() {
        let dir = tempfile::tempdir().unwrap();
        {
            let db = super::super::state::open_app_database(dir.path()).unwrap();
            crate::dive::replay::set_replay_capture_enabled(db.conn(), false).unwrap();
            // Written long ago (created_at 0) under a generous cap.
            supervision_replay::insert_with_retention(
                db.conn(),
                &replay_row("expired"),
                0,
                500,
                i64::MAX / 2,
            )
            .unwrap();
            assert_eq!(supervision_replay::count(db.conn()).unwrap(), 1);
        }
        let db = super::super::state::open_app_database(dir.path()).unwrap();
        assert_eq!(supervision_replay::count(db.conn()).unwrap(), 0);
    }

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

        // With capture off, an expired row still ages out when Settings reads.
        {
            let db = state.db.lock().unwrap();
            db.conn()
                .execute("UPDATE SupervisionReplay SET created_at = 0", [])
                .unwrap();
        }
        assert_eq!(replay_settings_get_impl(&state).unwrap().record_count, 0);
        let cleared = replay_records_clear_impl(&state).unwrap();
        assert_eq!(cleared.record_count, 0);
        assert!(!cleared.capture_enabled);
    }
}
