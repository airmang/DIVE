use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{optional_json_to_string, parse_optional_json};
use crate::db::models::{NewStepSessionMapping, StepSessionMappingRow};
use crate::db::{now_ms, DbError};

fn map_row(row: &rusqlite::Row<'_>) -> Result<StepSessionMappingRow, DbError> {
    Ok(StepSessionMappingRow {
        id: row.get(0)?,
        step_id: row.get(1)?,
        session_id: row.get(2)?,
        card_id: row.get(3)?,
        state_path: row.get(4)?,
        status: row.get(5)?,
        started_at: row.get(6)?,
        completed_at: row.get(7)?,
        checkpoint_ids: parse_optional_json(row.get(8)?)?,
        verification_status: row.get(9)?,
        verification_evidence: row.get(10)?,
        user_decision: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn query_map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StepSessionMappingRow> {
    map_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert(conn: &Connection, row: &NewStepSessionMapping) -> Result<i64, DbError> {
    let now = now_ms();
    let checkpoint_ids = optional_json_to_string(row.checkpoint_ids.as_ref())?;
    conn.execute(
        "INSERT INTO StepSessionMapping(step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![row.step_id, row.session_id, row.card_id, row.state_path, row.status, row.started_at, row.completed_at, checkpoint_ids, row.verification_status, row.verification_evidence, row.user_decision, now, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<StepSessionMappingRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping WHERE id = ?",
            [id],
            query_map_row,
        )
        .optional()?)
}

pub fn get_by_step(
    conn: &Connection,
    step_id: i64,
) -> Result<Option<StepSessionMappingRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping WHERE step_id = ?",
            [step_id],
            query_map_row,
        )
        .optional()?)
}

pub fn get_by_card(
    conn: &Connection,
    card_id: i64,
) -> Result<Option<StepSessionMappingRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping WHERE card_id = ?",
            [card_id],
            query_map_row,
        )
        .optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<StepSessionMappingRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Fetch mappings for a set of step ids in one query (S-069 G2), replacing the
/// per-step `get_by_step` N+1 in `mappings_for_steps`. `StepSessionMapping` has
/// `UNIQUE(step_id)`, so this returns at most one row per id — the same set the
/// per-step loop produced. Callers key by `step_id` and do not depend on order.
pub fn list_by_step_ids(
    conn: &Connection,
    step_ids: &[i64],
) -> Result<Vec<StepSessionMappingRow>, DbError> {
    if step_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(step_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping WHERE step_id IN ({placeholders}) ORDER BY id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(step_ids.iter()), query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_by_session(
    conn: &Connection,
    session_id: i64,
) -> Result<Vec<StepSessionMappingRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping WHERE session_id = ? ORDER BY id",
    )?;
    let rows = stmt
        .query_map([session_id], query_map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn update(conn: &Connection, id: i64, row: &NewStepSessionMapping) -> Result<(), DbError> {
    let checkpoint_ids = optional_json_to_string(row.checkpoint_ids.as_ref())?;
    conn.execute(
        "UPDATE StepSessionMapping SET step_id = ?, session_id = ?, card_id = ?, state_path = ?, status = ?, started_at = ?, completed_at = ?, checkpoint_ids = ?, verification_status = ?, verification_evidence = ?, user_decision = ?, updated_at = ? WHERE id = ?",
        params![row.step_id, row.session_id, row.card_id, row.state_path, row.status, row.started_at, row.completed_at, checkpoint_ids, row.verification_status, row.verification_evidence, row.user_decision, now_ms(), id],
    )?;
    Ok(())
}

pub fn update_status(conn: &Connection, id: i64, status: &str) -> Result<(), DbError> {
    conn.execute(
        "UPDATE StepSessionMapping SET status = ?, updated_at = ? WHERE id = ?",
        params![status, now_ms(), id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM StepSessionMapping WHERE id = ?", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::dao::{plan as plan_dao, step as step_dao};
    use crate::db::models::{NewPlan, NewStep};
    use crate::db::tests::{fresh_db, seed_project};
    use serde_json::json;

    fn seed_plan_step(conn: &Connection) -> (i64, i64) {
        let pid = seed_project(conn);
        let plan_id = plan_dao::insert(
            conn,
            &NewPlan {
                project_id: pid,
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
        .unwrap();
        let step_id = step_dao::insert(
            conn,
            &NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "Test Step".into(),
                summary: None,
                instruction_seed: None,
                expected_files: Some(json!([])),
                acceptance_criteria: Some(json!([])),
                step_kind: Default::default(),
                verification_kind: None,
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(json!([])),
                parallel_group: None,
                position: 1,
            },
        )
        .unwrap();
        (plan_id, step_id)
    }

    fn new_mapping(step_id: i64) -> NewStepSessionMapping {
        NewStepSessionMapping {
            step_id,
            session_id: None,
            card_id: None,
            state_path: Some("step-001".into()),
            status: "planned".into(),
            started_at: None,
            completed_at: None,
            checkpoint_ids: Some(json!([])),
            verification_status: None,
            verification_evidence: None,
            user_decision: None,
        }
    }

    #[test]
    fn crud_roundtrip() {
        let (db, _tmp) = fresh_db();
        let (_, step_id) = seed_plan_step(db.conn());
        let id = insert(db.conn(), &new_mapping(step_id)).unwrap();
        let row = get_by_id(db.conn(), id).unwrap().unwrap();
        assert_eq!(row.status, "planned");
        assert_eq!(row.step_id, step_id);

        update_status(db.conn(), id, "in_progress").unwrap();
        assert_eq!(
            get_by_id(db.conn(), id).unwrap().unwrap().status,
            "in_progress"
        );

        delete(db.conn(), id).unwrap();
        assert!(get_by_id(db.conn(), id).unwrap().is_none());
    }

    #[test]
    fn get_by_step_unique() {
        let (db, _tmp) = fresh_db();
        let (_, step_id) = seed_plan_step(db.conn());
        insert(db.conn(), &new_mapping(step_id)).unwrap();
        let row = get_by_step(db.conn(), step_id).unwrap().unwrap();
        assert_eq!(row.status, "planned");
    }

    // S-069 G2: the batched `list_by_step_ids` must return exactly the same set
    // as looping `get_by_step` per step — including excluding unmapped steps and
    // ignoring non-existent ids — with the empty-slice fast path returning none.
    #[test]
    fn list_by_step_ids_matches_per_step_lookup() {
        let (db, _tmp) = fresh_db();
        let (plan_id, first_step) = seed_plan_step(db.conn());
        let add_step = |sid: &str, pos: i64| {
            step_dao::insert(
                db.conn(),
                &NewStep {
                    plan_id,
                    step_id: sid.into(),
                    title: "T".into(),
                    summary: None,
                    instruction_seed: None,
                    expected_files: Some(json!([])),
                    acceptance_criteria: Some(json!([])),
                    step_kind: Default::default(),
                    verification_kind: None,
                    verification_command: None,
                    verification_manual_check: None,
                    dependencies: Some(json!([])),
                    parallel_group: None,
                    position: pos,
                },
            )
            .unwrap()
        };
        let second_step = add_step("step-002", 2);
        let third_step = add_step("step-003", 3);
        // Map only the first and third steps; the second is left unmapped.
        insert(db.conn(), &new_mapping(first_step)).unwrap();
        insert(db.conn(), &new_mapping(third_step)).unwrap();

        assert!(list_by_step_ids(db.conn(), &[]).unwrap().is_empty());

        let ids = [first_step, second_step, third_step, 999_999];
        let mut batched: Vec<i64> = list_by_step_ids(db.conn(), &ids)
            .unwrap()
            .into_iter()
            .map(|m| m.step_id)
            .collect();
        batched.sort_unstable();
        let mut reference: Vec<i64> = ids
            .iter()
            .filter_map(|id| get_by_step(db.conn(), *id).unwrap())
            .map(|m| m.step_id)
            .collect();
        reference.sort_unstable();

        assert_eq!(batched, reference);
        assert_eq!(batched, vec![first_step, third_step]);
    }
}
