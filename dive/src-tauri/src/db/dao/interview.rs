use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{optional_json_to_string, parse_optional_json};
use crate::db::models::{InterviewRow, NewInterview};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> Result<InterviewRow, DbError> {
    Ok(InterviewRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        goal: row.get(2)?,
        questions: parse_optional_json(row.get(3)?)?,
        unresolved_questions: parse_optional_json(row.get(4)?)?,
        intent_summary: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<InterviewRow> {
    map_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewInterview) -> Result<i64, DbError> {
    let now = now_ms();
    let questions = optional_json_to_string(row.questions.as_ref())?;
    let unresolved = optional_json_to_string(row.unresolved_questions.as_ref())?;
    conn.execute(
        "INSERT INTO Interview(project_id, goal, questions, unresolved_questions, intent_summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![row.project_id, row.goal, questions, unresolved, row.intent_summary, row.status, now, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<InterviewRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, project_id, goal, questions, unresolved_questions, intent_summary, status, created_at, updated_at FROM Interview WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}

pub fn get_by_project(conn: &Connection, project_id: i64) -> Result<Option<InterviewRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, project_id, goal, questions, unresolved_questions, intent_summary, status, created_at, updated_at FROM Interview WHERE project_id = ?",
            [project_id],
            query_map_row,
        )
        .optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<InterviewRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, goal, questions, unresolved_questions, intent_summary, status, created_at, updated_at FROM Interview ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn update(conn: &Connection, id: i64, row: &NewInterview) -> Result<(), DbError> {
    let questions = optional_json_to_string(row.questions.as_ref())?;
    let unresolved = optional_json_to_string(row.unresolved_questions.as_ref())?;
    conn.execute(
        "UPDATE Interview SET project_id = ?, goal = ?, questions = ?, unresolved_questions = ?, intent_summary = ?, status = ?, updated_at = ? WHERE id = ?",
        params![row.project_id, row.goal, questions, unresolved, row.intent_summary, row.status, now_ms(), id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Interview WHERE id = ?", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project};
    use serde_json::json;

    fn new_interview(pid: i64) -> NewInterview {
        NewInterview {
            project_id: pid,
            goal: "Build a todo app".into(),
            questions: Some(json!([{"question":"Q1","answer":"A1"}])),
            unresolved_questions: Some(json!([])),
            intent_summary: Some("Summary".into()),
            status: "draft".into(),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let id = insert(db.conn(), &new_interview(pid)).unwrap();
        let row = get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(row.goal, "Build a todo app");
        assert_eq!(row.status, "draft");

        let mut updated = new_interview(pid);
        updated.status = "submitted".into();
        update(db.conn(), id, &updated).unwrap();
        assert_eq!(
            get_by_id(db.conn(), id).unwrap().unwrap().status,
            "submitted"
        );

        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }

    #[test]
    fn get_by_project_unique() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        insert(db.conn(), &new_interview(pid)).unwrap();
        let row = get_by_project(db.conn(), pid).unwrap().unwrap();
        assert_eq!(row.goal, "Build a todo app");
    }

    #[test]
    fn foreign_key_rejects_missing_project() {
        let (db, _tmp) = fresh_db();
        let err = insert(db.conn(), &new_interview(999)).unwrap_err();
        assert!(matches!(
            err,
            DbError::Sqlite(rusqlite::Error::SqliteFailure(_, _))
        ));
    }
}
