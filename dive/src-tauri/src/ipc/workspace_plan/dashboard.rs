//! Plan dashboard aggregation and activity-log derivation.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::collections::HashSet;

use crate::db::dao::{
    event_log as event_log_dao, plan as plan_dao, prd as prd_dao, project as project_dao,
    step as step_dao, step_session_mapping as mapping_dao,
};
use crate::db::models::{EventLogRow, PlanRow, ProjectRow, StepRow, StepSessionMappingRow};
use crate::dive::event_log as dive_event_log;
use crate::ipc::AppState;

use super::*;

pub fn workspace_plan_dashboard_impl(
    state: &AppState,
) -> Result<Vec<WorkspacePlanDashboardProject>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut projects = project_dao::list(db.conn()).map_err(|e| e.to_string())?;
    projects.sort_by_key(|project| std::cmp::Reverse(project.updated_at));

    projects
        .into_iter()
        .map(|project| {
            let plan =
                plan_dao::get_by_project(db.conn(), project.id).map_err(|e| e.to_string())?;
            dashboard_row_for_project(db.conn(), project, plan)
        })
        .collect()
}

pub fn workspace_plan_activity_impl(
    state: &AppState,
    plan_id: i64,
    limit: i64,
) -> Result<Vec<PlanActivityLogRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    plan_dao::get_by_id(db.conn(), plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found"))?;
    plan_activity_for_plan(db.conn(), plan_id, limit)
}

#[derive(Default)]
pub(super) struct PlanProgress {
    pub(super) step_count: i64,
    pub(super) ready_count: i64,
    pub(super) blocked_count: i64,
    pub(super) active_count: i64,
    pub(super) done_count: i64,
    shipped_count: i64,
    next_ready_steps: Vec<WorkspacePlanDashboardStep>,
    active_steps: Vec<WorkspacePlanDashboardStep>,
}

fn dashboard_row_for_project(
    conn: &rusqlite::Connection,
    project: ProjectRow,
    plan: Option<PlanRow>,
) -> Result<WorkspacePlanDashboardProject, String> {
    let Some(plan) = plan else {
        return Ok(WorkspacePlanDashboardProject {
            project_id: project.id,
            project_name: project.name,
            project_path: project.path,
            project_updated_at: project.updated_at,
            plan_id: None,
            plan_goal: None,
            plan_status: None,
            step_count: 0,
            ready_count: 0,
            blocked_count: 0,
            active_count: 0,
            done_count: 0,
            shipped_count: 0,
            next_ready_steps: Vec::new(),
            active_steps: Vec::new(),
            last_activity: None,
            project_spec: None,
        });
    };

    let steps = step_dao::list_active_by_plan(conn, plan.id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(conn, &steps)?;
    let progress = derive_plan_progress(&steps, &mappings);
    let last_activity = latest_plan_activity(conn, plan.id)?;
    let project_spec = prd_dao::latest_version(conn, plan.project_id)
        .map_err(|e| e.to_string())?
        .map(|row| row.snapshot);

    Ok(WorkspacePlanDashboardProject {
        project_id: project.id,
        project_name: project.name,
        project_path: project.path,
        project_updated_at: project.updated_at,
        plan_id: Some(plan.id),
        plan_goal: Some(plan.goal),
        plan_status: Some(plan.status),
        step_count: progress.step_count,
        ready_count: progress.ready_count,
        blocked_count: progress.blocked_count,
        active_count: progress.active_count,
        done_count: progress.done_count,
        shipped_count: progress.shipped_count,
        next_ready_steps: progress.next_ready_steps,
        active_steps: progress.active_steps,
        last_activity,
        project_spec,
    })
}

pub(super) fn derive_plan_progress(
    steps: &[StepRow],
    mappings: &[StepSessionMappingRow],
) -> PlanProgress {
    let done_ids = done_step_ids(steps, mappings);
    let mapping_by_step_id = mappings
        .iter()
        .map(|mapping| (mapping.step_id, mapping))
        .collect::<std::collections::HashMap<_, _>>();
    let mut progress = PlanProgress {
        step_count: steps.len() as i64,
        ..PlanProgress::default()
    };

    for step in steps {
        if let Some(mapping) = mapping_by_step_id.get(&step.id) {
            match mapping.status.as_str() {
                "done" => progress.done_count += 1,
                "shipped" => progress.shipped_count += 1,
                "blocked" => progress.blocked_count += 1,
                _ => {
                    progress.active_count += 1;
                    progress.active_steps.push(dashboard_step(
                        step,
                        mapping.status.as_str(),
                        Some(mapping),
                    ));
                }
            }
            continue;
        }

        if dependencies_done(step, &done_ids) {
            progress.ready_count += 1;
            progress
                .next_ready_steps
                .push(dashboard_step(step, "ready", None));
        } else {
            progress.blocked_count += 1;
        }
    }

    progress
}

fn dashboard_step(
    step: &StepRow,
    status: &str,
    mapping: Option<&StepSessionMappingRow>,
) -> WorkspacePlanDashboardStep {
    WorkspacePlanDashboardStep {
        step_db_id: step.id,
        stable_step_id: step.step_id.clone(),
        title: step.title.clone(),
        position: step.position,
        status: status.to_string(),
        session_id: mapping.and_then(|mapping| mapping.session_id),
        card_id: mapping.and_then(|mapping| mapping.card_id),
    }
}

pub(super) fn append_plan_activity(
    conn: &rusqlite::Connection,
    plan: &PlanRow,
    step: Option<&StepRow>,
    session_id: Option<i64>,
    event_type: &str,
    message: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    dive_event_log::append_to_conn(
        conn,
        session_id,
        event_type,
        serde_json::json!({
            "project_id": plan.project_id,
            "plan_id": plan.id,
            "step_id": step.map(|step| step.id),
            "stable_step_id": step.map(|step| step.step_id.clone()),
            "step_title": step.map(|step| step.title.clone()),
            "message": message,
            "reason": reason,
        }),
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn latest_plan_activity(
    conn: &rusqlite::Connection,
    plan_id: i64,
) -> Result<Option<PlanActivityLogRow>, String> {
    Ok(plan_activity_for_plan(conn, plan_id, 1)?.into_iter().next())
}

fn plan_activity_for_plan(
    conn: &rusqlite::Connection,
    plan_id: i64,
    limit: i64,
) -> Result<Vec<PlanActivityLogRow>, String> {
    // S-069 G2: filter/sort/limit in SQL (`list_plan_events`) instead of loading
    // the entire append-only EventLog and filtering in Rust once per project.
    // The DAO already applies `type GLOB 'plan_*' AND plan_id = ?` and
    // `ORDER BY created_at DESC, id DESC LIMIT`, so `plan_activity_from_event`
    // (re-checking the same predicate) never drops a row here — it only maps
    // each event onto the activity-log projection.
    let limit = if limit <= 0 { 20 } else { limit.min(100) };
    let rows = event_log_dao::list_plan_events(conn, plan_id, limit)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|row| plan_activity_from_event(row, Some(plan_id)))
        .collect::<Vec<_>>();
    Ok(rows)
}

fn plan_activity_from_event(
    row: EventLogRow,
    required_plan_id: Option<i64>,
) -> Option<PlanActivityLogRow> {
    if !row.r#type.starts_with("plan_") {
        return None;
    }
    let plan_id = row.payload.get("plan_id")?.as_i64()?;
    if required_plan_id.is_some_and(|required| required != plan_id) {
        return None;
    }

    Some(PlanActivityLogRow {
        id: row.id,
        plan_id,
        event_type: row.r#type,
        message: payload_string(&row.payload, "message").unwrap_or_else(|| "Plan activity".into()),
        step_id: row.payload.get("step_id").and_then(|value| value.as_i64()),
        stable_step_id: payload_string(&row.payload, "stable_step_id"),
        step_title: payload_string(&row.payload, "step_title"),
        reason: payload_string(&row.payload, "reason"),
        created_at: row.created_at,
    })
}

fn payload_string(payload: &serde_json::Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

pub(super) fn step_state_activity_message(status: &str) -> String {
    match status {
        "done" => "Step marked done".into(),
        "shipped" => "Step marked shipped".into(),
        "in_progress" => "Step marked in progress".into(),
        other => format!("Step marked {other}"),
    }
}

pub(super) fn mappings_for_steps(
    conn: &rusqlite::Connection,
    steps: &[StepRow],
) -> Result<Vec<StepSessionMappingRow>, String> {
    // S-069 G2: one `IN (...)` query instead of a `get_by_step` call per step.
    // Re-projected back into `steps` order so the returned Vec is identical to
    // the former per-step loop — some callers (`workspace_plan_step_mappings`)
    // return it straight to the frontend, where array order is observable.
    let step_ids: Vec<i64> = steps.iter().map(|step| step.id).collect();
    let mut by_step: std::collections::HashMap<i64, StepSessionMappingRow> =
        mapping_dao::list_by_step_ids(conn, &step_ids)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|mapping| (mapping.step_id, mapping))
            .collect();
    Ok(steps
        .iter()
        .filter_map(|step| by_step.remove(&step.id))
        .collect())
}

pub(super) fn done_step_ids(
    steps: &[StepRow],
    mappings: &[StepSessionMappingRow],
) -> HashSet<String> {
    mappings
        .iter()
        .filter(|mapping| mapping.status == "done" || mapping.status == "shipped")
        .filter_map(|mapping| {
            steps
                .iter()
                .find(|step| step.id == mapping.step_id)
                .map(|step| step.step_id.clone())
        })
        .collect()
}

pub(super) fn dependencies_done(step: &StepRow, done_step_ids: &HashSet<String>) -> bool {
    blocked_dependency_ids(step, done_step_ids).is_empty()
}

pub(super) fn blocked_dependency_ids(
    step: &StepRow,
    done_step_ids: &HashSet<String>,
) -> Vec<String> {
    step.dependencies
        .as_ref()
        .and_then(|deps| deps.as_array())
        .map(|deps| {
            deps.iter()
                .filter_map(|dep| dep.as_str())
                .filter(|dep_id| !done_step_ids.contains(*dep_id))
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
