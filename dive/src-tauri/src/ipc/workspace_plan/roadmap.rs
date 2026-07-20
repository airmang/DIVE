//! Opening and updating roadmap steps into build sessions.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use crate::db::dao::{
    card as card_dao, plan as plan_dao, session as session_dao, step as step_dao,
    step_session_mapping as mapping_dao, workmap as workmap_dao,
};
use crate::db::models::{
    CardState, NewCard, NewSession, NewStepSessionMapping, NewWorkmap, StepSessionMappingRow,
};
use crate::db::now_ms;
use crate::ipc::AppState;

use super::*;

pub fn roadmap_step_open_impl(
    state: &AppState,
    step_id: i64,
) -> Result<StepSessionMappingRow, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let step = step_dao::get_by_id(conn, step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {step_id} not found"))?;
    let plan = plan_dao::get_by_id(conn, step.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", step.plan_id))?;
    if plan.status != "approved" {
        return Err("step cannot be opened until the plan is approved".to_string());
    }
    if let Some(existing) = mapping_dao::get_by_step(conn, step_id).map_err(|e| e.to_string())? {
        return Ok(existing);
    }

    let steps = step_dao::list_active_by_plan(conn, step.plan_id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(conn, &steps)?;
    let done_ids = done_step_ids(&steps, &mappings);
    let blocked_dependencies = blocked_dependency_ids(&step, &done_ids);
    if !blocked_dependencies.is_empty() {
        let reason = format!(
            "step is blocked: waiting for {}",
            blocked_dependencies.join(", ")
        );
        if let Err(err) = append_plan_activity(
            conn,
            &plan,
            Some(&step),
            None,
            "plan_step_open_failed",
            "Step start blocked",
            Some(&reason),
        ) {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                step_id,
                "failed to append plan_step_open_failed activity"
            );
        }
        return Err(reason);
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let session_id = session_dao::insert(
        &tx,
        &NewSession {
            project_id: plan.project_id,
            title: step.title.clone(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .map_err(|e| e.to_string())?;
    let card_id = card_dao::insert(
        &tx,
        &NewCard {
            session_id,
            title: step.title.clone(),
            instruction: step.instruction_seed.clone(),
            assist_summary: None,
            acceptance_criteria: join_string_array(step.acceptance_criteria.as_ref()),
            retrospective: None,
            change_summary: None,
            state: CardState::Decomposed,
            verify_log: None,
            changed_files: None,
            test_command: None,
            approval_judgment: None,
            approval_provenance: None,
            position: 1,
        },
    )
    .map_err(|e| e.to_string())?;
    workmap_dao::upsert(
        &tx,
        &NewWorkmap {
            session_id,
            current_stage: "D".into(),
            collapsed: false,
            current_card_id: Some(card_id),
        },
    )
    .map_err(|e| e.to_string())?;
    let mapping_id = mapping_dao::insert(
        &tx,
        &NewStepSessionMapping {
            step_id,
            session_id: Some(session_id),
            card_id: Some(card_id),
            state_path: Some(step.step_id.clone()),
            status: "in_progress".into(),
            started_at: Some(now_ms()),
            completed_at: None,
            checkpoint_ids: Some(serde_json::json!([])),
            verification_status: None,
            verification_evidence: None,
            user_decision: None,
        },
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let mapping = mapping_dao::get_by_id(conn, mapping_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "mapping not found after insert".to_string())?;
    if let Err(err) = append_plan_activity(
        conn,
        &plan,
        Some(&step),
        Some(session_id),
        "plan_step_opened",
        "Step session started",
        None,
    ) {
        tracing::warn!(
            error = %crate::telemetry::redact_log_text(&err),
            session_id,
            "failed to append plan_step_opened activity"
        );
    }
    Ok(mapping)
}

pub fn roadmap_step_update_state_impl(
    state: &AppState,
    input: StepStateUpdateInput,
) -> Result<StepSessionMappingRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let step = step_dao::get_by_id(db.conn(), input.step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {} not found", input.step_id))?;
    let plan = plan_dao::get_by_id(db.conn(), step.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", step.plan_id))?;
    let mapping = mapping_dao::get_by_step(db.conn(), input.step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no mapping found for step {}", input.step_id))?;
    let status = input.status;
    let done = status == "done" || status == "shipped";
    let updated = NewStepSessionMapping {
        step_id: mapping.step_id,
        session_id: mapping.session_id,
        card_id: mapping.card_id,
        state_path: mapping.state_path,
        status,
        started_at: mapping.started_at,
        completed_at: if done {
            Some(now_ms())
        } else {
            mapping.completed_at
        },
        checkpoint_ids: mapping.checkpoint_ids,
        verification_status: input.verification_status.or(mapping.verification_status),
        verification_evidence: input.evidence.or(mapping.verification_evidence),
        user_decision: mapping.user_decision,
    };
    mapping_dao::update(db.conn(), mapping.id, &updated).map_err(|e| e.to_string())?;
    let mapping = mapping_dao::get_by_id(db.conn(), mapping.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "mapping not found after update".to_string())?;
    let message = step_state_activity_message(mapping.status.as_str());
    if let Err(err) = append_plan_activity(
        db.conn(),
        &plan,
        Some(&step),
        mapping.session_id,
        "plan_step_state_changed",
        &message,
        None,
    ) {
        tracing::warn!(
            error = %crate::telemetry::redact_log_text(&err),
            step_id = mapping.step_id,
            "failed to append plan_step_state_changed activity"
        );
    }
    Ok(mapping)
}
