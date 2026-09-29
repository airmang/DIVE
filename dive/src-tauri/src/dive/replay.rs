//! Best-effort capture into the local replay corpus (spec 015 FR-020/FR-021).
//!
//! Called from the sites that log supervisor / coach / PRD interview
//! evaluations, and only when a prompt actually reached a model (the logged
//! `promptVersion` is non-null). Capture never fails or blocks the user's
//! turn: every error is logged as a warning and swallowed.

use rusqlite::Connection;
use serde_json::Value;

use crate::db::dao::app_preference::{self, REPLAY_CAPTURE_KEY};
use crate::db::dao::supervision_replay::{self, NewSupervisionReplay};
use crate::db::DbError;
use crate::export::redact_export_string;

/// D-015-02: capture is ON unless the student turned it off in Settings.
/// Strictly: no stored value → ON, `"true"` → ON, anything else (including a
/// read error or an unexpected value) → OFF, so capture never happens by
/// accident.
pub fn replay_capture_enabled(conn: &Connection) -> bool {
    match app_preference::get(conn, REPLAY_CAPTURE_KEY) {
        Ok(None) => true,
        Ok(Some(value)) => value == "true",
        Err(_) => false,
    }
}

/// Apply replay retention now (startup, Settings). Best effort.
pub fn prune_replay_corpus_best_effort(conn: &Connection) {
    if let Err(err) = supervision_replay::prune(conn) {
        tracing::warn!(error = %err, "replay corpus retention failed");
    }
}

/// Defence in depth before anything is stored (S-078 security review): the
/// same secret/email/account redaction the export applies, over every string
/// of the prompt inputs and over the raw model output.
fn redact_for_storage(record: &NewSupervisionReplay) -> NewSupervisionReplay {
    fn redact_strings(value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(redact_export_string(text)),
            Value::Array(items) => Value::Array(items.iter().map(redact_strings).collect()),
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(key, nested)| (key.clone(), redact_strings(nested)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }
    let context_json = match serde_json::from_str::<Value>(&record.context_json) {
        Ok(value) => redact_strings(&value).to_string(),
        Err(_) => redact_export_string(&record.context_json),
    };
    NewSupervisionReplay {
        context_json,
        raw_output: record.raw_output.as_deref().map(redact_export_string),
        ..record.clone()
    }
}

pub fn set_replay_capture_enabled(conn: &Connection, enabled: bool) -> Result<(), DbError> {
    app_preference::set_bool(conn, REPLAY_CAPTURE_KEY, enabled)
}

/// Store `record` when capture is enabled. Returns whether a row was written.
pub fn capture_replay_best_effort(conn: &Connection, record: &NewSupervisionReplay) -> bool {
    if !replay_capture_enabled(conn) {
        return false;
    }
    match supervision_replay::insert(conn, &redact_for_storage(record)) {
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
    fn capture_switch_is_strict_about_unreadable_values() {
        let (db, _tmp) = fresh_db();
        // No stored value: ON.
        assert!(replay_capture_enabled(db.conn()));
        app_preference::set(db.conn(), REPLAY_CAPTURE_KEY, "true").unwrap();
        assert!(replay_capture_enabled(db.conn()));
        for unreadable in ["false", "maybe", "", "TRUE", "1"] {
            app_preference::set(db.conn(), REPLAY_CAPTURE_KEY, unreadable).unwrap();
            assert!(
                !replay_capture_enabled(db.conn()),
                "{unreadable:?} must read as OFF"
            );
            assert!(!capture_replay_best_effort(db.conn(), &record(unreadable)));
        }
        // A read error (table missing) is OFF too.
        db.conn().execute_batch("DROP TABLE AppPreference").unwrap();
        assert!(!replay_capture_enabled(db.conn()));
    }

    #[test]
    fn stored_prompt_inputs_and_output_are_secret_redacted() {
        let (db, _tmp) = fresh_db();
        let mut secret = record("secret");
        secret.context_json = serde_json::json!({
            "answer": "my key is sk-live-abcdef123 and mail minji@example.com",
            "nested": ["password=hunter2hunter2"],
        })
        .to_string();
        secret.raw_output = Some("Bearer abcdef123456 token=ghp_abcdef1234".into());
        assert!(capture_replay_best_effort(db.conn(), &secret));
        let stored = supervision_replay::get_by_evaluation_id(db.conn(), "secret")
            .unwrap()
            .unwrap();
        for leaked in [
            "sk-live-abcdef123",
            "minji@example.com",
            "hunter2hunter2",
            "abcdef123456",
            "ghp_abcdef1234",
        ] {
            assert!(!stored.context_json.contains(leaked), "{leaked}");
            assert!(
                !stored.raw_output.as_deref().unwrap().contains(leaked),
                "{leaked}"
            );
        }
        assert!(stored.context_json.contains("my key is"));
    }

    #[test]
    fn capture_failure_is_swallowed() {
        let (db, _tmp) = fresh_db();
        assert!(capture_replay_best_effort(db.conn(), &record("dup")));
        // A duplicate evaluation id fails the insert but never errors out.
        assert!(!capture_replay_best_effort(db.conn(), &record("dup")));
    }
}
