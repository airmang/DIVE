use rusqlite::{params, Connection, OptionalExtension};

use crate::db::dao::{json_to_string, parse_json};
use crate::db::models::{
    NewObjection, NewPlanMutation, ObjectionRow, ObjectionSuggestionStatus, PlanMutationRow,
    PlanMutationType, ProjectSpecDelta, ScopeExpansionAssessment,
};
use crate::db::{now_ms, DbError};

fn mutation_type_as_str(value: PlanMutationType) -> &'static str {
    match value {
        PlanMutationType::AddStep => "add_step",
        PlanMutationType::ChangeStep => "change_step",
        PlanMutationType::RetireStep => "retire_step",
    }
}

fn parse_mutation_type(value: String) -> Result<PlanMutationType, DbError> {
    Ok(serde_json::from_value(serde_json::Value::String(value))?)
}

fn suggestion_status_as_str(value: ObjectionSuggestionStatus) -> &'static str {
    match value {
        ObjectionSuggestionStatus::None => "none",
        ObjectionSuggestionStatus::Offered => "offered",
        ObjectionSuggestionStatus::Accepted => "accepted",
        ObjectionSuggestionStatus::Dismissed => "dismissed",
    }
}

fn parse_suggestion_status(value: String) -> Result<ObjectionSuggestionStatus, DbError> {
    Ok(serde_json::from_value(serde_json::Value::String(value))?)
}

fn map_mutation_row(row: &rusqlite::Row<'_>) -> Result<PlanMutationRow, DbError> {
    Ok(PlanMutationRow {
        mutation_id: row.get(0)?,
        project_id: row.get(1)?,
        plan_id: row.get(2)?,
        r#type: parse_mutation_type(row.get(3)?)?,
        step_db_id: row.get(4)?,
        stable_step_id: row.get(5)?,
        reason: row.get(6)?,
        criterion_ids: serde_json::from_value(parse_json(row.get(7)?)?)?,
        prd_delta: serde_json::from_value::<ProjectSpecDelta>(parse_json(row.get(8)?)?)?,
        scope_expansion: serde_json::from_value::<ScopeExpansionAssessment>(parse_json(
            row.get(9)?,
        )?)?,
        created_at: row.get(10)?,
    })
}

fn query_mutation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanMutationRow> {
    map_mutation_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn map_objection_row(row: &rusqlite::Row<'_>) -> Result<ObjectionRow, DbError> {
    Ok(ObjectionRow {
        objection_id: row.get(0)?,
        project_id: row.get(1)?,
        plan_id: row.get(2)?,
        step_db_id: row.get(3)?,
        stable_step_id: row.get(4)?,
        text: row.get(5)?,
        linked_criterion_ids: serde_json::from_value(parse_json(row.get(6)?)?)?,
        suggestion_status: parse_suggestion_status(row.get(7)?)?,
        created_at: row.get(8)?,
    })
}

fn query_objection_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ObjectionRow> {
    map_objection_row(row).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
    })
}

pub fn insert_mutation(conn: &Connection, row: &NewPlanMutation) -> Result<(), DbError> {
    let criterion_ids = json_to_string(&serde_json::to_value(&row.criterion_ids)?)?;
    let prd_delta = json_to_string(&serde_json::to_value(&row.prd_delta)?)?;
    let scope_expansion = json_to_string(&serde_json::to_value(&row.scope_expansion)?)?;
    conn.execute(
        "INSERT INTO PlanMutation(mutation_id, project_id, plan_id, type, step_db_id, stable_step_id, reason, criterion_ids, prd_delta, scope_expansion, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.mutation_id,
            row.project_id,
            row.plan_id,
            mutation_type_as_str(row.r#type),
            row.step_db_id,
            row.stable_step_id,
            row.reason,
            criterion_ids,
            prd_delta,
            scope_expansion,
            now_ms(),
        ],
    )?;
    Ok(())
}

pub fn get_mutation(
    conn: &Connection,
    mutation_id: &str,
) -> Result<Option<PlanMutationRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT mutation_id, project_id, plan_id, type, step_db_id, stable_step_id, reason, criterion_ids, prd_delta, scope_expansion, created_at FROM PlanMutation WHERE mutation_id = ?",
            [mutation_id],
            query_mutation_row,
        )
        .optional()?)
}

pub fn list_mutations_by_plan(
    conn: &Connection,
    plan_id: i64,
) -> Result<Vec<PlanMutationRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT mutation_id, project_id, plan_id, type, step_db_id, stable_step_id, reason, criterion_ids, prd_delta, scope_expansion, created_at FROM PlanMutation WHERE plan_id = ? ORDER BY created_at, mutation_id",
    )?;
    let rows = stmt
        .query_map([plan_id], query_mutation_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn insert_objection(conn: &Connection, row: &NewObjection) -> Result<(), DbError> {
    let linked_criterion_ids = json_to_string(&serde_json::to_value(&row.linked_criterion_ids)?)?;
    conn.execute(
        "INSERT INTO Objection(objection_id, project_id, plan_id, step_db_id, stable_step_id, text, linked_criterion_ids, suggestion_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.objection_id,
            row.project_id,
            row.plan_id,
            row.step_db_id,
            row.stable_step_id,
            row.text,
            linked_criterion_ids,
            suggestion_status_as_str(row.suggestion_status),
            now_ms(),
        ],
    )?;
    Ok(())
}

pub fn list_objections_by_plan(
    conn: &Connection,
    plan_id: i64,
) -> Result<Vec<ObjectionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT objection_id, project_id, plan_id, step_db_id, stable_step_id, text, linked_criterion_ids, suggestion_status, created_at FROM Objection WHERE plan_id = ? ORDER BY created_at, objection_id",
    )?;
    let rows = stmt
        .query_map([plan_id], query_objection_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
