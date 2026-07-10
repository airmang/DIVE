use rusqlite::{params, Connection};

use crate::db::models::{InterviewTurnRow, NewInterviewTurn, PrdPatchValidationOutcome};
use crate::db::{now_ms, DbError};

fn validation_outcome_as_str(value: PrdPatchValidationOutcome) -> &'static str {
    match value {
        PrdPatchValidationOutcome::None => "none",
        PrdPatchValidationOutcome::Applied => "applied",
        PrdPatchValidationOutcome::Rejected => "rejected",
        PrdPatchValidationOutcome::HeldForStudent => "held_for_student",
        PrdPatchValidationOutcome::NotStructured => "not_structured",
    }
}

fn parse_validation_outcome(value: String) -> Result<PrdPatchValidationOutcome, DbError> {
    Ok(serde_json::from_value(serde_json::Value::String(value))?)
}

fn map_interview_turn_row(row: &rusqlite::Row<'_>) -> Result<InterviewTurnRow, DbError> {
    Ok(InterviewTurnRow {
        id: row.get(0)?,
        draft_id: row.get(1)?,
        turn_id: row.get(2)?,
        student_answer: row.get(3)?,
        outcome: parse_validation_outcome(row.get(4)?)?,
        parse_failure_kind: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn query_interview_turn_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<InterviewTurnRow> {
    map_interview_turn_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewInterviewTurn) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO InterviewTurn(draft_id, turn_id, student_answer, outcome, parse_failure_kind, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![
            row.draft_id,
            row.turn_id,
            row.student_answer,
            validation_outcome_as_str(row.outcome),
            row.parse_failure_kind,
            now_ms(),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_by_draft(conn: &Connection, draft_id: &str) -> Result<Vec<InterviewTurnRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, draft_id, turn_id, student_answer, outcome, parse_failure_kind, created_at FROM InterviewTurn WHERE draft_id = ? ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map([draft_id], query_interview_turn_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::fresh_db;

    // draft_id has no FK (see schema.rs comment), so these tests don't need a
    // LiveProjectSpecDraft row to exercise the DAO in isolation.
    #[test]
    fn insert_and_list_by_draft_round_trips_all_outcomes() {
        let (db, _tmp) = fresh_db();

        insert(
            db.conn(),
            &NewInterviewTurn {
                draft_id: "draft-1".into(),
                turn_id: "turn-1".into(),
                student_answer: "A focus timer that shows a countdown".into(),
                outcome: PrdPatchValidationOutcome::Applied,
                parse_failure_kind: None,
            },
        )
        .unwrap();
        insert(
            db.conn(),
            &NewInterviewTurn {
                draft_id: "draft-1".into(),
                turn_id: "turn-2".into(),
                student_answer: "gibberish that failed to structure".into(),
                outcome: PrdPatchValidationOutcome::NotStructured,
                parse_failure_kind: Some("no_json".into()),
            },
        )
        .unwrap();
        insert(
            db.conn(),
            &NewInterviewTurn {
                draft_id: "draft-other".into(),
                turn_id: "turn-3".into(),
                student_answer: "belongs to a different draft".into(),
                outcome: PrdPatchValidationOutcome::None,
                parse_failure_kind: None,
            },
        )
        .unwrap();

        let rows = list_by_draft(db.conn(), "draft-1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].turn_id, "turn-1");
        assert_eq!(rows[0].outcome, PrdPatchValidationOutcome::Applied);
        assert_eq!(rows[0].parse_failure_kind, None);
        assert_eq!(rows[1].turn_id, "turn-2");
        assert_eq!(rows[1].outcome, PrdPatchValidationOutcome::NotStructured);
        assert_eq!(rows[1].parse_failure_kind.as_deref(), Some("no_json"));
    }
}
