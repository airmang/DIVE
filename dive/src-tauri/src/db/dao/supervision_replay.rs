//! Local replay corpus rows (`SupervisionReplay`, spec 015 FR-020/FR-021).
//!
//! Retention (D-015-02) is enforced on every insert: at most
//! `REPLAY_MAX_ROWS` rows, none older than `REPLAY_MAX_AGE_MS`.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::db::{now_ms, DbError};

pub const REPLAY_MAX_ROWS: i64 = 500;
pub const REPLAY_MAX_AGE_MS: i64 = 30 * 24 * 60 * 60 * 1000;
/// Raw model output is stored up to this many bytes (cut on a char boundary).
pub const REPLAY_RAW_OUTPUT_MAX_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplaySurface {
    Supervisor,
    Coach,
    PrdInterview,
}

impl ReplaySurface {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Supervisor => "supervisor",
            Self::Coach => "coach",
            Self::PrdInterview => "prd_interview",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewSupervisionReplay {
    pub evaluation_id: String,
    pub surface: ReplaySurface,
    pub session_id: Option<i64>,
    pub project_id: Option<i64>,
    pub prompt_version: String,
    pub policy_version: Option<String>,
    pub model: Option<String>,
    pub context_json: String,
    pub raw_output: Option<String>,
    pub validation_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisionReplayRow {
    pub id: i64,
    pub evaluation_id: String,
    pub surface: String,
    pub session_id: Option<i64>,
    pub project_id: Option<i64>,
    pub created_at: i64,
    pub prompt_version: String,
    pub policy_version: Option<String>,
    pub model: Option<String>,
    pub context_json: String,
    pub raw_output: Option<String>,
    pub raw_truncated: bool,
    pub validation_json: String,
}

/// `text` cut to at most `max_bytes` on a char boundary, and whether it was cut.
pub fn bound_raw_output(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

pub fn insert(conn: &Connection, row: &NewSupervisionReplay) -> Result<i64, DbError> {
    insert_with_retention(conn, row, now_ms(), REPLAY_MAX_ROWS, REPLAY_MAX_AGE_MS)
}

pub(crate) fn insert_with_retention(
    conn: &Connection,
    row: &NewSupervisionReplay,
    now: i64,
    max_rows: i64,
    max_age_ms: i64,
) -> Result<i64, DbError> {
    let (raw_output, raw_truncated) = match row.raw_output.as_deref() {
        Some(raw) => {
            let (bounded, truncated) = bound_raw_output(raw, REPLAY_RAW_OUTPUT_MAX_BYTES);
            (Some(bounded), truncated)
        }
        None => (None, false),
    };
    conn.execute(
        "INSERT INTO SupervisionReplay(evaluation_id, surface, session_id, project_id, created_at, prompt_version, policy_version, model, context_json, raw_output, raw_truncated, validation_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.evaluation_id,
            row.surface.as_str(),
            row.session_id,
            row.project_id,
            now,
            row.prompt_version,
            row.policy_version,
            row.model,
            row.context_json,
            raw_output,
            raw_truncated,
            row.validation_json,
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "DELETE FROM SupervisionReplay WHERE created_at < ?",
        [now - max_age_ms],
    )?;
    conn.execute(
        "DELETE FROM SupervisionReplay WHERE id NOT IN (
            SELECT id FROM SupervisionReplay ORDER BY created_at DESC, id DESC LIMIT ?
         )",
        [max_rows],
    )?;
    Ok(id)
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SupervisionReplayRow> {
    Ok(SupervisionReplayRow {
        id: row.get(0)?,
        evaluation_id: row.get(1)?,
        surface: row.get(2)?,
        session_id: row.get(3)?,
        project_id: row.get(4)?,
        created_at: row.get(5)?,
        prompt_version: row.get(6)?,
        policy_version: row.get(7)?,
        model: row.get(8)?,
        context_json: row.get(9)?,
        raw_output: row.get(10)?,
        raw_truncated: row.get(11)?,
        validation_json: row.get(12)?,
    })
}

const SELECT_COLUMNS: &str = "SELECT id, evaluation_id, surface, session_id, project_id, created_at, prompt_version, policy_version, model, context_json, raw_output, raw_truncated, validation_json FROM SupervisionReplay";

pub fn list_by_session(
    conn: &Connection,
    session_id: i64,
) -> Result<Vec<SupervisionReplayRow>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_COLUMNS} WHERE session_id = ? ORDER BY id"
    ))?;
    let rows = stmt
        .query_map([session_id], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_by_evaluation_id(
    conn: &Connection,
    evaluation_id: &str,
) -> Result<Option<SupervisionReplayRow>, DbError> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row(
            &format!("{SELECT_COLUMNS} WHERE evaluation_id = ?"),
            [evaluation_id],
            map_row,
        )
        .optional()?)
}

pub fn count(conn: &Connection) -> Result<i64, DbError> {
    Ok(
        conn.query_row("SELECT COUNT(*) FROM SupervisionReplay", [], |row| {
            row.get(0)
        })?,
    )
}

/// Delete every replay row; returns how many were removed.
pub fn clear(conn: &Connection) -> Result<usize, DbError> {
    Ok(conn.execute("DELETE FROM SupervisionReplay", [])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project_session};

    fn row(evaluation_id: &str, session_id: Option<i64>) -> NewSupervisionReplay {
        NewSupervisionReplay {
            evaluation_id: evaluation_id.into(),
            surface: ReplaySurface::Supervisor,
            session_id,
            project_id: None,
            prompt_version: "1.0.0+256c9520".into(),
            policy_version: Some("1.0.0".into()),
            model: Some("mock-model".into()),
            context_json: "{}".into(),
            raw_output: Some("{\"provoke\":true}".into()),
            validation_json: "{}".into(),
        }
    }

    #[test]
    fn insert_round_trips_and_bounds_raw_output() {
        let (db, _tmp) = fresh_db();
        let (_, session_id) = seed_project_session(db.conn());
        let mut long = row("eval-long", Some(session_id));
        long.raw_output = Some("가".repeat(REPLAY_RAW_OUTPUT_MAX_BYTES));
        insert(db.conn(), &row("eval-1", Some(session_id))).unwrap();
        insert(db.conn(), &long).unwrap();

        let stored = get_by_evaluation_id(db.conn(), "eval-1").unwrap().unwrap();
        assert_eq!(stored.surface, "supervisor");
        assert_eq!(stored.raw_output.as_deref(), Some("{\"provoke\":true}"));
        assert!(!stored.raw_truncated);
        let stored = get_by_evaluation_id(db.conn(), "eval-long")
            .unwrap()
            .unwrap();
        let raw = stored.raw_output.unwrap();
        assert!(stored.raw_truncated);
        assert!(raw.len() <= REPLAY_RAW_OUTPUT_MAX_BYTES);
        assert!(raw.chars().all(|ch| ch == '가'));
        assert_eq!(list_by_session(db.conn(), session_id).unwrap().len(), 2);
        // evaluation_id is unique.
        assert!(insert(db.conn(), &row("eval-1", None)).is_err());
    }

    #[test]
    fn retention_keeps_newest_rows_within_the_age_cap() {
        let (db, _tmp) = fresh_db();
        let day = 24 * 60 * 60 * 1000;
        insert_with_retention(db.conn(), &row("old", None), 0, 3, 30 * day).unwrap();
        for (index, id) in ["a", "b", "c", "d"].iter().enumerate() {
            insert_with_retention(
                db.conn(),
                &row(id, None),
                31 * day + index as i64,
                3,
                30 * day,
            )
            .unwrap();
        }
        // "old" aged out; of a..d only the newest three remain.
        let remaining = ["old", "a", "b", "c", "d"]
            .iter()
            .filter(|id| get_by_evaluation_id(db.conn(), id).unwrap().is_some())
            .copied()
            .collect::<Vec<_>>();
        assert_eq!(remaining, vec!["b", "c", "d"]);
        assert_eq!(count(db.conn()).unwrap(), 3);
        assert_eq!(clear(db.conn()).unwrap(), 3);
        assert_eq!(count(db.conn()).unwrap(), 0);
    }

    #[test]
    fn deleting_a_session_removes_its_replay_rows() {
        let (db, _tmp) = fresh_db();
        let (_, session_id) = seed_project_session(db.conn());
        insert(db.conn(), &row("eval-s", Some(session_id))).unwrap();
        crate::db::dao::session::delete(db.conn(), session_id).unwrap();
        assert_eq!(count(db.conn()).unwrap(), 0);
    }
}
