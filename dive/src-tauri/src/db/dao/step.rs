use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{optional_json_to_string, parse_optional_json};
use crate::db::models::{NewStep, StepRow};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> Result<StepRow, DbError> {
    Ok(StepRow {
        id: row.get(0)?,
        plan_id: row.get(1)?,
        step_id: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        instruction_seed: row.get(5)?,
        expected_files: parse_optional_json(row.get(6)?)?,
        acceptance_criteria: parse_optional_json(row.get(7)?)?,
        verification_kind: row.get(8)?,
        verification_command: row.get(9)?,
        verification_manual_check: row.get(10)?,
        dependencies: parse_optional_json(row.get(11)?)?,
        parallel_group: row.get(12)?,
        position: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StepRow> {
    map_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewStep) -> Result<i64, DbError> {
    let now = now_ms();
    let expected_files = optional_json_to_string(row.expected_files.as_ref())?;
    let acceptance = optional_json_to_string(row.acceptance_criteria.as_ref())?;
    let dependencies = optional_json_to_string(row.dependencies.as_ref())?;
    conn.execute(
        "INSERT INTO Step(plan_id, step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, verification_kind, verification_command, verification_manual_check, dependencies, parallel_group, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![row.plan_id, row.step_id, row.title, row.summary, row.instruction_seed, expected_files, acceptance, row.verification_kind, row.verification_command, row.verification_manual_check, dependencies, row.parallel_group, row.position, now, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<StepRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, plan_id, step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, verification_kind, verification_command, verification_manual_check, dependencies, parallel_group, position, created_at, updated_at FROM Step WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}

pub fn get_by_plan_and_step_id(
    conn: &Connection,
    plan_id: i64,
    step_id: &str,
) -> Result<Option<StepRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, plan_id, step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, verification_kind, verification_command, verification_manual_check, dependencies, parallel_group, position, created_at, updated_at FROM Step WHERE plan_id = ? AND step_id = ?",
            params![plan_id, step_id],
            query_map_row,
        )
        .optional()?)
}

pub fn list_by_plan(conn: &Connection, plan_id: i64) -> Result<Vec<StepRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, plan_id, step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, verification_kind, verification_command, verification_manual_check, dependencies, parallel_group, position, created_at, updated_at FROM Step WHERE plan_id = ? ORDER BY position, id",
    )?;
    let rows = stmt
        .query_map([plan_id], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn update(conn: &Connection, id: i64, row: &NewStep) -> Result<(), DbError> {
    let expected_files = optional_json_to_string(row.expected_files.as_ref())?;
    let acceptance = optional_json_to_string(row.acceptance_criteria.as_ref())?;
    let dependencies = optional_json_to_string(row.dependencies.as_ref())?;
    conn.execute(
        "UPDATE Step SET plan_id = ?, step_id = ?, title = ?, summary = ?, instruction_seed = ?, expected_files = ?, acceptance_criteria = ?, verification_kind = ?, verification_command = ?, verification_manual_check = ?, dependencies = ?, parallel_group = ?, position = ?, updated_at = ? WHERE id = ?",
        params![row.plan_id, row.step_id, row.title, row.summary, row.instruction_seed, expected_files, acceptance, row.verification_kind, row.verification_command, row.verification_manual_check, dependencies, row.parallel_group, row.position, now_ms(), id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM Step WHERE id = ?", [id])?;
    Ok(())
}

pub fn next_position(conn: &Connection, plan_id: i64) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM Step WHERE plan_id = ?",
        [plan_id],
        |row| row.get(0),
    )?)
}

pub fn next_step_id(conn: &Connection, plan_id: i64) -> Result<String, DbError> {
    let steps = list_by_plan(conn, plan_id)?;
    let existing = steps
        .iter()
        .map(|step| step.step_id.as_str())
        .collect::<HashSet<_>>();
    let mut next = steps
        .iter()
        .filter_map(|step| {
            step.step_id
                .strip_prefix("step-")
                .and_then(|suffix| suffix.parse::<i64>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;

    loop {
        let candidate = format!("step-{next:03}");
        if !existing.contains(candidate.as_str()) {
            return Ok(candidate);
        }
        next += 1;
    }
}

pub fn validate_dependencies(conn: &Connection, plan_id: i64) -> Result<(), DbError> {
    let steps = list_by_plan(conn, plan_id)?;
    let valid_ids: std::collections::HashSet<String> =
        steps.iter().map(|s| s.step_id.clone()).collect();

    for step in &steps {
        if let Some(deps) = &step.dependencies {
            if let Some(arr) = deps.as_array() {
                for dep in arr {
                    if let Some(dep_id) = dep.as_str() {
                        if !valid_ids.contains(dep_id) {
                            return Err(DbError::Sqlite(rusqlite::Error::InvalidQuery));
                        }
                    }
                }
            }
        }
    }

    let mut adj: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for step in &steps {
        let mut deps = Vec::new();
        if let Some(d) = &step.dependencies {
            if let Some(arr) = d.as_array() {
                for dep in arr {
                    if let Some(s) = dep.as_str() {
                        deps.push(s.to_owned());
                    }
                }
            }
        }
        adj.insert(step.step_id.clone(), deps);
    }

    let mut visited = std::collections::HashSet::new();
    let mut rec_stack = std::collections::HashSet::new();

    fn has_cycle(
        node: &str,
        adj: &std::collections::HashMap<String, Vec<String>>,
        visited: &mut std::collections::HashSet<String>,
        rec_stack: &mut std::collections::HashSet<String>,
    ) -> bool {
        visited.insert(node.to_owned());
        rec_stack.insert(node.to_owned());

        if let Some(neighbors) = adj.get(node) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    if has_cycle(neighbor, adj, visited, rec_stack) {
                        return true;
                    }
                } else if rec_stack.contains(neighbor) {
                    return true;
                }
            }
        }

        rec_stack.remove(node);
        false
    }

    for step in &steps {
        if !visited.contains(&step.step_id)
            && has_cycle(&step.step_id, &adj, &mut visited, &mut rec_stack)
        {
            return Err(DbError::Sqlite(rusqlite::Error::InvalidQuery));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::plan as plan_dao;
    use crate::db::models::NewPlan;
    use crate::db::tests::{fresh_db, seed_project};
    use serde_json::json;

    fn new_step(plan_id: i64, step_id: &str, pos: i64) -> NewStep {
        NewStep {
            plan_id,
            step_id: step_id.into(),
            title: format!("Step {}", step_id),
            summary: None,
            instruction_seed: None,
            expected_files: Some(json!([])),
            acceptance_criteria: Some(json!([])),
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: Some(json!([])),
            parallel_group: None,
            position: pos,
        }
    }

    fn seed_plan(conn: &Connection, project_id: i64) -> i64 {
        plan_dao::insert(
            conn,
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "test".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "draft".into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let plan_id = seed_plan(db.conn(), pid);
        let id = insert(db.conn(), &new_step(plan_id, "step-001", 1)).unwrap();
        let row = get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(row.step_id, "step-001");
        assert_eq!(row.title, "Step step-001");

        let mut updated = new_step(plan_id, "step-001", 1);
        updated.title = "Updated".into();
        update(db.conn(), id, &updated).unwrap();
        assert_eq!(get_by_id(db.conn(), id).unwrap().unwrap().title, "Updated");

        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }

    #[test]
    fn list_by_plan_ordered() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let plan_id = seed_plan(db.conn(), pid);
        insert(db.conn(), &new_step(plan_id, "step-002", 2)).unwrap();
        insert(db.conn(), &new_step(plan_id, "step-001", 1)).unwrap();
        let rows = list_by_plan(db.conn(), plan_id).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].step_id, "step-001");
        assert_eq!(rows[1].step_id, "step-002");
    }

    #[test]
    fn validate_dependencies_rejects_missing() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let plan_id = seed_plan(db.conn(), pid);
        let mut step = new_step(plan_id, "step-002", 2);
        step.dependencies = Some(json!(["step-999"]));
        insert(db.conn(), &step).unwrap();
        assert!(validate_dependencies(db.conn(), plan_id).is_err());
    }

    #[test]
    fn validate_dependencies_rejects_cycle() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let plan_id = seed_plan(db.conn(), pid);
        let mut s1 = new_step(plan_id, "step-001", 1);
        s1.dependencies = Some(json!(["step-002"]));
        let mut s2 = new_step(plan_id, "step-002", 2);
        s2.dependencies = Some(json!(["step-001"]));
        insert(db.conn(), &s1).unwrap();
        insert(db.conn(), &s2).unwrap();
        assert!(validate_dependencies(db.conn(), plan_id).is_err());
    }

    #[test]
    fn validate_dependencies_accepts_valid() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let plan_id = seed_plan(db.conn(), pid);
        let s1 = new_step(plan_id, "step-001", 1);
        let mut s2 = new_step(plan_id, "step-002", 2);
        s2.dependencies = Some(json!(["step-001"]));
        insert(db.conn(), &s1).unwrap();
        insert(db.conn(), &s2).unwrap();
        assert!(validate_dependencies(db.conn(), plan_id).is_ok());
    }

    #[test]
    fn next_step_id_uses_next_numeric_suffix_and_skips_collisions() {
        let (db, _tmp) = fresh_db();
        let pid = seed_project(db.conn());
        let plan_id = seed_plan(db.conn(), pid);
        insert(db.conn(), &new_step(plan_id, "step-001", 1)).unwrap();
        insert(db.conn(), &new_step(plan_id, "step-003", 2)).unwrap();
        insert(db.conn(), &new_step(plan_id, "custom", 3)).unwrap();

        assert_eq!(next_step_id(db.conn(), plan_id).unwrap(), "step-004");
    }
}
