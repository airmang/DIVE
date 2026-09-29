//! Best-effort capture into the local replay corpus (spec 015 FR-020/FR-021).
//!
//! Called from the sites that log supervisor / coach / PRD interview
//! evaluations, and only when a prompt actually reached a model (the logged
//! `promptVersion` is non-null). Capture never fails or blocks the user's
//! turn: every error is logged as a warning and swallowed.

use rusqlite::Connection;

use crate::db::dao::app_preference::{self, REPLAY_CAPTURE_KEY};
use crate::db::dao::supervision_replay::{self, NewSupervisionReplay};
use crate::db::DbError;

/// D-015-02: capture is ON unless the student turned it off in Settings. An
/// unreadable preference counts as OFF — capture never happens by accident.
pub fn replay_capture_enabled(conn: &Connection) -> bool {
    app_preference::get_bool(conn, REPLAY_CAPTURE_KEY, true).unwrap_or(false)
}

pub fn set_replay_capture_enabled(conn: &Connection, enabled: bool) -> Result<(), DbError> {
    app_preference::set_bool(conn, REPLAY_CAPTURE_KEY, enabled)
}

/// Store `record` when capture is enabled. Returns whether a row was written.
pub fn capture_replay_best_effort(conn: &Connection, record: &NewSupervisionReplay) -> bool {
    if !replay_capture_enabled(conn) {
        return false;
    }
    match supervision_replay::insert(conn, record) {
        Ok(_) => true,
        Err(err) => {
            tracing::warn!(
                surface = record.surface.as_str(),
                error = %crate::telemetry::redact_log_text(&err.to_string()),
                "replay capture failed; continuing without it"
            );
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::supervision_replay::ReplaySurface;
    use crate::db::tests::fresh_db;

    fn record(evaluation_id: &str) -> NewSupervisionReplay {
        NewSupervisionReplay {
            evaluation_id: evaluation_id.into(),
            surface: ReplaySurface::Coach,
            session_id: None,
            project_id: None,
            prompt_version: "1.0.0+c5cd9fc2".into(),
            policy_version: None,
            model: None,
            context_json: "{}".into(),
            raw_output: None,
            validation_json: "{}".into(),
        }
    }

    #[test]
    fn capture_is_on_by_default_and_off_when_disabled() {
        let (db, _tmp) = fresh_db();
        assert!(replay_capture_enabled(db.conn()));
        assert!(capture_replay_best_effort(db.conn(), &record("a")));
        set_replay_capture_enabled(db.conn(), false).unwrap();
        assert!(!capture_replay_best_effort(db.conn(), &record("b")));
        assert_eq!(supervision_replay::count(db.conn()).unwrap(), 1);
    }

    #[test]
    fn capture_failure_is_swallowed() {
        let (db, _tmp) = fresh_db();
        assert!(capture_replay_best_effort(db.conn(), &record("dup")));
        // A duplicate evaluation id fails the insert but never errors out.
        assert!(!capture_replay_best_effort(db.conn(), &record("dup")));
    }
}
