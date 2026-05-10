use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{optional_json_to_string, parse_optional_json};
use crate::db::models::{NewPlan, PlanRow};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> Result<PlanRow, DbError> {
    Ok(PlanRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        interview_id: row.get(2)?,
        goal: row.get(3)?,
        intent_summary: row.get(4)?,
        scope: parse_optional_json(row.get(5)?)?,
        non_goals: parse_optional_json(row.get(6)?)?,
        constraints: parse_optional_json(row.get(7)?)?,
        acceptance_criteria: parse_optional_json(row.get(8)?)?,
        status: row.get(9)?,
        created_at: row.get(10)?,
        approved_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanRow> {
    map_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewPlan) -> Result<i64, DbError> {
    let now = now_ms();
    let scope = optional_json_to_string(row.scope.as_ref())?;
    let non_goals = optional_json_to_string(row.non_goals.as_ref())?;
    let constraints = optional_json_to_string(row.constraints.as_ref())?;
    let acceptance = optional_json_to_string(row.acceptance_criteria.as_ref())?;
    conn.execute(
        "INSERT INTO Plan(project_id, interview_id, goal, intent_summary, scope, non_goals, constraints, acceptance_criteria, status, created_at, approved_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![row.project_id, row.interview_id, row.goal, row.intent_summary, scope, non_goals, constraints, acceptance, row.status, now, Option::<i64>::None, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<PlanRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, project_id, interview_id, goal, intent_summary, scope, non_goals, constraints, acceptance_criteria, status, created_at, approved_at, updated_at FROM Plan WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}

pub fn get_by_project(conn: &Connection, project_id: i64) -> Result<Option<PlanRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, project_id, interview_id, goal, intent_summary, scope, non_goals, constraints, acceptance_criteria, status, created_at, approved_at, updated_at FROM Plan WHERE project_id = ?",
            [project_id],
            query_map_row,
        )
        .optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<PlanRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, interview_id, goal, intent_summary, scope, non_goals, constraints, acceptance_criteria, status, created_at, approved_at, updated_at FROM Plan ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn update(conn: &Connection, id: i64, row: &NewPlan) -> Result<(), DbError> {
    let scope = optional_json_to_string(row.scope.as_ref())?;
    let non_goals = optional_json_to_string(row.non_goals.as_ref())?;
    let constraints = optional_json_to_string(row.constraints.as_ref())?;
    let acceptance = optional_json_to_string(row.acceptance_criteria.as_ref())?;
    conn.execute(
        "UPDATE Plan SET project_id = ?, interview_id = ?, goal = ?, intent_summary = ?, scope = ?, non_goals = ?, constraints = ?, acceptance_criteria = ?, status = ?, updated_at = ? WHERE id = ?",
        params![row.project_id, row.interview_id, row.goal, row.intent_summary, scope, non_goals, constraints, acceptance, row.status, now_ms(), id],
    )?;
    Ok(())
}

pub fn approve(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE Plan SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?",
        params![now_ms(), now_ms(), id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Plan WHERE id = ?", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::{fresh_db, seed_project};
    use serde_json::json;

    fn new_plan(pid: i64) -> NewPlan {
        NewPlan {
            project_id: pid,
            interview_id: None,
            goal: "Build a todo app".into(),
            intent_summary: Some("Summary".into()),
            scope: Some(json!("scope")),
            non_goals: Some(json!("non_goals")),
            constraints: Some(json!("constraints")),
            acceptance_criteria: Some(json!("criteria")),
            status: "draft".into(),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let id = insert(db.conn(), &new_plan(pid)).unwrap();
        let row = get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(row.goal, "Build a todo app");
        assert_eq!(row.status, "draft");
        assert!(row.approved_at.is_none());

        approve(db.conn(), id).unwrap();
        let approved = get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(approved.status, "approved");
        assert!(approved.approved_at.is_some());

        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }

    #[test]
    fn get_by_project_unique() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        insert(db.conn(), &new_plan(pid)).unwrap();
        let row = get_by_project(db.conn(), pid).unwrap().unwrap();
        assert_eq!(row.goal, "Build a todo app");
    }
}
