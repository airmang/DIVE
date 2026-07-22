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
    // A mapping with session_id = NULL is a zombie: the schema's
    // `ON DELETE SET NULL` fires on StepSessionMapping when its Session is
    // deleted (and the mapping's Card cascade-deletes with it), leaving a
    // row that still reports 'in_progress' but has no live session or card
    // to resume. Returning it as-is silently no-ops step start and rejects
    // step chat forever with no repair path — treat it as "no live session"
    // and fall through to open a fresh one, same as a first-time open.
    let zombie_mapping = match mapping_dao::get_by_step(conn, step_id).map_err(|e| e.to_string())? {
        Some(existing) if existing.session_id.is_some() => return Ok(existing),
        Some(existing) => Some(existing),
        None => None,
    };

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
    // StepSessionMapping.step_id is UNIQUE, so a repair must UPDATE the
    // zombie's existing row rather than INSERT a second one for this step.
    // Verification fields recorded before the session was deleted are worth
    // more than the stale session/card pointers, so they're carried forward
    // instead of being wiped by the repair.
    let mapping_id = match &zombie_mapping {
        Some(zombie) => {
            mapping_dao::update(
                &tx,
                zombie.id,
                &NewStepSessionMapping {
                    step_id,
                    session_id: Some(session_id),
                    card_id: Some(card_id),
                    state_path: Some(step.step_id.clone()),
                    status: "in_progress".into(),
                    started_at: Some(now_ms()),
                    completed_at: None,
                    checkpoint_ids: Some(serde_json::json!([])),
                    verification_status: zombie.verification_status.clone(),
                    verification_evidence: zombie.verification_evidence.clone(),
                    user_decision: zombie.user_decision.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
            zombie.id
        }
        None => mapping_dao::insert(
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
        .map_err(|e| e.to_string())?,
    };
    tx.commit().map_err(|e| e.to_string())?;

    let mapping = mapping_dao::get_by_id(conn, mapping_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "mapping not found after open".to_string())?;
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

#[cfg(test)]
mod zombie_mapping_tests {
    use super::*;
    use crate::db::dao::{project as project_dao, session as session_dao};
    use crate::db::models::{NewPlan, NewProject, NewStep};
    use serde_json::json;

    fn seed_approved_plan_with_step(state: &AppState, project_root: &std::path::Path) -> i64 {
        let db = state.db.lock().unwrap();
        let project_id = project_dao::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: project_root.to_string_lossy().into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let plan_id = plan_dao::insert(
            db.conn(),
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "Build the thing".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "approved".into(),
            },
        )
        .unwrap();
        step_dao::insert(
            db.conn(),
            &NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "Step".into(),
                summary: Some("Summary".into()),
                instruction_seed: Some("Seed".into()),
                expected_files: Some(json!([])),
                acceptance_criteria: Some(json!(["Criterion"])),
                step_kind: Default::default(),
                verification_kind: Some("manual".into()),
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(json!([])),
                parallel_group: None,
                position: 1,
            },
        )
        .unwrap()
    }

    /// Regression for the P1 finding: deleting a step's mapped session leaves
    /// a zombie StepSessionMapping (session_id/card_id NULLed by the schema's
    /// `ON DELETE SET NULL`/cascade, status still 'in_progress'). Before the
    /// fix, `roadmap_step_open_impl` returned that dead row as-is forever.
    #[test]
    fn roadmap_step_open_repairs_zombie_mapping_after_session_delete() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();
        let step_db_id = seed_approved_plan_with_step(&state, tmp.path());

        let first = roadmap_step_open_impl(&state, step_db_id).unwrap();
        let original_session_id = first.session_id.expect("fresh open creates a session");

        // Simulate the mapped session being deleted out from under the step.
        {
            let db = state.db.lock().unwrap();
            db.conn()
                .execute("DELETE FROM Session WHERE id = ?", [original_session_id])
                .unwrap();
        }
        {
            let db = state.db.lock().unwrap();
            let zombie = mapping_dao::get_by_step(db.conn(), step_db_id)
                .unwrap()
                .unwrap();
            assert_eq!(
                zombie.status, "in_progress",
                "the mapping row itself must survive the session delete"
            );
            assert!(
                zombie.session_id.is_none(),
                "session_id must be NULLed by the FK's ON DELETE SET NULL"
            );
            assert!(
                zombie.card_id.is_none(),
                "card_id must be NULLed once its Card cascade-deletes with the session"
            );
        }

        let repaired = roadmap_step_open_impl(&state, step_db_id).unwrap();
        assert!(
            repaired.session_id.is_some(),
            "roadmap_step_open must recover an openable state, not return the dead mapping"
        );
        assert_eq!(repaired.status, "in_progress");
        {
            // SQLite's rowid can legitimately recycle the just-deleted
            // session's id (no AUTOINCREMENT column here), so the meaningful
            // check is that the repaired mapping points at a real, live
            // Session row — not that the numeric id changed.
            let db = state.db.lock().unwrap();
            let live_session = session_dao::get_by_id(db.conn(), repaired.session_id.unwrap())
                .unwrap()
                .expect("repair must mint a session row that actually exists");
            assert_eq!(live_session.status, "active");
        }

        let db = state.db.lock().unwrap();
        // Exactly one mapping row for the step: repair must UPDATE the zombie
        // in place — StepSessionMapping.step_id is UNIQUE, so a second INSERT
        // for this step would fail.
        let current = mapping_dao::get_by_step(db.conn(), step_db_id)
            .unwrap()
            .unwrap();
        assert_eq!(current.id, repaired.id);
        assert_eq!(current.id, first.id);
    }
}
