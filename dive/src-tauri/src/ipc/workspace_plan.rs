use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::dao::{
    card as card_dao, interview as interview_dao, plan as plan_dao, session as session_dao,
    step as step_dao, step_session_mapping as mapping_dao, workmap as workmap_dao,
};
use crate::db::models::{
    CardState, InterviewRow, NewCard, NewInterview, NewPlan, NewSession, NewStep,
    NewStepSessionMapping, NewWorkmap, PlanRow, StepRow, StepSessionMappingRow,
};
use crate::db::now_ms;
use crate::ipc::AppState;
use crate::workspace_plan as workspace_plan_service;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspacePlanStatus {
    pub status: String,
    pub has_plan: bool,
    pub has_approved_plan: bool,
    pub plan_summary: Option<String>,
    pub plan_id: Option<i64>,
    pub step_count: i64,
    pub ready_count: i64,
    pub blocked_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepStateUpdateInput {
    pub step_id: i64,
    pub status: String,
    pub evidence: Option<String>,
    pub verification_status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepDraftInput {
    pub title: String,
    pub summary: String,
    pub instruction_seed: String,
    pub expected_files: Vec<String>,
    pub acceptance_criteria: Vec<String>,
    pub verification_command: Option<String>,
    pub verification_type: Option<String>,
    pub dependencies: Vec<String>,
    pub parallel_group: Option<i64>,
    pub position: i64,
    pub step_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDraftInput {
    pub goal: String,
    pub intent_summary: String,
    pub scope: Vec<String>,
    pub non_goals: Vec<String>,
    pub constraints: Vec<String>,
    pub acceptance_criteria: Vec<String>,
    pub steps: Vec<StepDraftInput>,
}

#[tauri::command]
pub async fn workspace_plan_status(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<WorkspacePlanStatus, String> {
    workspace_plan_status_impl(&state, project_id)
}

#[tauri::command]
pub async fn workspace_plan_start_interview(
    state: State<'_, AppState>,
    project_id: i64,
    goal: String,
) -> Result<InterviewRow, String> {
    workspace_plan_start_interview_impl(&state, project_id, goal)
}

#[tauri::command]
pub async fn workspace_plan_save_interview_answer(
    state: State<'_, AppState>,
    interview_id: i64,
    question: String,
    answer: String,
) -> Result<InterviewRow, String> {
    workspace_plan_save_interview_answer_impl(&state, interview_id, question, answer)
}

#[tauri::command]
pub async fn workspace_plan_submit_interview(
    state: State<'_, AppState>,
    interview_id: i64,
    intent_summary: String,
    unresolved_questions: Vec<String>,
) -> Result<InterviewRow, String> {
    workspace_plan_submit_interview_impl(&state, interview_id, intent_summary, unresolved_questions)
}

#[tauri::command]
pub async fn workspace_plan_generate_draft(
    state: State<'_, AppState>,
    interview_id: i64,
    plan_input: PlanDraftInput,
) -> Result<(PlanRow, Vec<StepRow>), String> {
    workspace_plan_generate_draft_impl(&state, interview_id, plan_input)
}

#[tauri::command]
pub async fn workspace_plan_approve(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<PlanRow, String> {
    workspace_plan_approve_impl(&state, plan_id)
}

#[tauri::command]
pub async fn workspace_plan_discard_plan(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<(), String> {
    workspace_plan_discard_plan_impl(&state, plan_id)
}

#[tauri::command]
pub async fn workspace_plan_list_steps(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<Vec<StepRow>, String> {
    workspace_plan_list_steps_impl(&state, plan_id)
}

#[tauri::command]
pub async fn workspace_plan_step_mappings(
    state: State<'_, AppState>,
    plan_id: i64,
) -> Result<Vec<StepSessionMappingRow>, String> {
    workspace_plan_step_mappings_impl(&state, plan_id)
}

#[tauri::command]
pub async fn roadmap_step_open(
    state: State<'_, AppState>,
    step_id: i64,
) -> Result<StepSessionMappingRow, String> {
    roadmap_step_open_impl(&state, step_id)
}

#[tauri::command]
pub async fn roadmap_step_update_state(
    state: State<'_, AppState>,
    input: StepStateUpdateInput,
) -> Result<StepSessionMappingRow, String> {
    roadmap_step_update_state_impl(&state, input)
}

pub fn workspace_plan_status_impl(
    state: &AppState,
    project_id: i64,
) -> Result<WorkspacePlanStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?;
    let Some(plan) = plan else {
        let interview =
            interview_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?;
        let status = interview
            .as_ref()
            .map(|row| match row.status.as_str() {
                "draft" => "interview_draft",
                "submitted" => "interview_submitted",
                "approved" => "interview_approved",
                _ => "needs_interview",
            })
            .unwrap_or("needs_interview");
        return Ok(WorkspacePlanStatus {
            status: status.to_string(),
            has_plan: false,
            has_approved_plan: false,
            plan_summary: None,
            plan_id: None,
            step_count: 0,
            ready_count: 0,
            blocked_count: 0,
        });
    };

    let steps = step_dao::list_by_plan(db.conn(), plan.id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(db.conn(), &steps)?;
    let done_step_ids = done_step_ids(&steps, &mappings);
    let mut ready_count = 0;
    let mut blocked_count = 0;
    for step in &steps {
        if mappings.iter().any(|mapping| mapping.step_id == step.id) {
            continue;
        }
        if dependencies_done(step, &done_step_ids) {
            ready_count += 1;
        } else {
            blocked_count += 1;
        }
    }

    Ok(WorkspacePlanStatus {
        status: if plan.status == "approved" {
            "approved".into()
        } else {
            "draft".into()
        },
        has_plan: true,
        has_approved_plan: plan.status == "approved",
        plan_summary: Some(plan.goal),
        plan_id: Some(plan.id),
        step_count: steps.len() as i64,
        ready_count,
        blocked_count,
    })
}

pub fn workspace_plan_start_interview_impl(
    state: &AppState,
    project_id: i64,
    goal: String,
) -> Result<InterviewRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(existing) =
        interview_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?
    {
        match existing.status.as_str() {
            "draft" | "submitted" => return Ok(existing),
            "discarded" => {
                interview_dao::delete(db.conn(), existing.id).map_err(|e| e.to_string())?;
            }
            _ => {
                return Err(format!(
                    "interview {} is already {}",
                    existing.id, existing.status
                ))
            }
        }
    }

    let interview_id = interview_dao::insert(
        db.conn(),
        &NewInterview {
            project_id,
            goal,
            questions: Some(serde_json::json!([])),
            unresolved_questions: Some(serde_json::json!([])),
            intent_summary: None,
            status: "draft".into(),
        },
    )
    .map_err(|e| e.to_string())?;
    interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "interview not found after insert".to_string())
}

pub fn workspace_plan_save_interview_answer_impl(
    state: &AppState,
    interview_id: i64,
    question: String,
    answer: String,
) -> Result<InterviewRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let interview = interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    let mut questions = interview
        .questions
        .as_ref()
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    questions.push(serde_json::json!({
        "question": question,
        "answer": answer,
    }));
    interview_dao::update(
        db.conn(),
        interview_id,
        &NewInterview {
            project_id: interview.project_id,
            goal: interview.goal,
            questions: Some(serde_json::Value::Array(questions)),
            unresolved_questions: interview.unresolved_questions,
            intent_summary: interview.intent_summary,
            status: interview.status,
        },
    )
    .map_err(|e| e.to_string())?;
    interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "interview not found after update".to_string())
}

pub fn workspace_plan_submit_interview_impl(
    state: &AppState,
    interview_id: i64,
    intent_summary: String,
    unresolved_questions: Vec<String>,
) -> Result<InterviewRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let interview = interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    if interview.status != "draft" {
        return Err(format!(
            "interview {interview_id} must be draft before submit"
        ));
    }
    interview_dao::update(
        db.conn(),
        interview_id,
        &NewInterview {
            project_id: interview.project_id,
            goal: interview.goal,
            questions: interview.questions,
            unresolved_questions: Some(serde_json::json!(unresolved_questions)),
            intent_summary: Some(intent_summary),
            status: "submitted".into(),
        },
    )
    .map_err(|e| e.to_string())?;
    interview_dao::get_by_id(db.conn(), interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "interview not found after submit".to_string())
}

pub fn workspace_plan_generate_draft_impl(
    state: &AppState,
    interview_id: i64,
    plan_input: PlanDraftInput,
) -> Result<(PlanRow, Vec<StepRow>), String> {
    validate_unique_step_ids(&plan_input.steps)?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let interview = interview_dao::get_by_id(conn, interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(existing) =
        plan_dao::get_by_project(&tx, interview.project_id).map_err(|e| e.to_string())?
    {
        if existing.status == "draft" {
            plan_dao::delete(&tx, existing.id).map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "project {} already has approved plan {}",
                interview.project_id, existing.id
            ));
        }
    }

    let plan_id = plan_dao::insert(
        &tx,
        &NewPlan {
            project_id: interview.project_id,
            interview_id: Some(interview.id),
            goal: plan_input.goal,
            intent_summary: Some(plan_input.intent_summary),
            scope: Some(serde_json::json!(plan_input.scope)),
            non_goals: Some(serde_json::json!(plan_input.non_goals)),
            constraints: Some(serde_json::json!(plan_input.constraints)),
            acceptance_criteria: Some(serde_json::json!(plan_input.acceptance_criteria)),
            status: "draft".into(),
        },
    )
    .map_err(|e| e.to_string())?;

    for step in plan_input.steps {
        step_dao::insert(
            &tx,
            &NewStep {
                plan_id,
                step_id: step.step_id,
                title: step.title,
                summary: Some(step.summary),
                instruction_seed: Some(step.instruction_seed),
                expected_files: Some(serde_json::json!(step.expected_files)),
                acceptance_criteria: Some(serde_json::json!(step.acceptance_criteria)),
                verification_kind: step.verification_type,
                verification_command: step.verification_command,
                verification_manual_check: None,
                dependencies: Some(serde_json::json!(step.dependencies)),
                parallel_group: step.parallel_group.map(|group| group.to_string()),
                position: step.position,
            },
        )
        .map_err(|e| e.to_string())?;
    }
    step_dao::validate_dependencies(&tx, plan_id).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let plan = plan_dao::get_by_id(conn, plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "plan not found after draft generation".to_string())?;
    let steps = step_dao::list_by_plan(conn, plan_id).map_err(|e| e.to_string())?;
    Ok((plan, steps))
}

pub fn workspace_plan_approve_impl(state: &AppState, plan_id: i64) -> Result<PlanRow, String> {
    let project_root = state.project_root_required()?;
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        workspace_plan_service::approve_plan_and_export(db.conn(), plan_id, &project_root)
            .map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(db.conn(), plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found after approve"))?;
        if let Some(interview_id) = plan.interview_id {
            if let Some(interview) =
                interview_dao::get_by_id(db.conn(), interview_id).map_err(|e| e.to_string())?
            {
                if interview.status == "submitted" {
                    interview_dao::update(
                        db.conn(),
                        interview.id,
                        &NewInterview {
                            project_id: interview.project_id,
                            goal: interview.goal,
                            questions: interview.questions,
                            unresolved_questions: interview.unresolved_questions,
                            intent_summary: interview.intent_summary,
                            status: "approved".into(),
                        },
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    plan_dao::get_by_id(db.conn(), plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found after approve"))
}

pub fn workspace_plan_discard_plan_impl(state: &AppState, plan_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_id(db.conn(), plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found"))?;
    if plan.status == "approved" {
        return Err("approved plans cannot be discarded".to_string());
    }
    plan_dao::delete(db.conn(), plan_id).map_err(|e| e.to_string())
}

pub fn workspace_plan_list_steps_impl(
    state: &AppState,
    plan_id: i64,
) -> Result<Vec<StepRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    step_dao::list_by_plan(db.conn(), plan_id).map_err(|e| e.to_string())
}

pub fn workspace_plan_step_mappings_impl(
    state: &AppState,
    plan_id: i64,
) -> Result<Vec<StepSessionMappingRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let steps = step_dao::list_by_plan(db.conn(), plan_id).map_err(|e| e.to_string())?;
    mappings_for_steps(db.conn(), &steps)
}

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

    let steps = step_dao::list_by_plan(conn, step.plan_id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(conn, &steps)?;
    if !dependencies_done(&step, &done_step_ids(&steps, &mappings)) {
        return Err("step is blocked: dependencies not completed".to_string());
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
            state_path: Some(step.step_id),
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

    mapping_dao::get_by_id(conn, mapping_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "mapping not found after insert".to_string())
}

pub fn roadmap_step_update_state_impl(
    state: &AppState,
    input: StepStateUpdateInput,
) -> Result<StepSessionMappingRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mapping = mapping_dao::get_by_step(db.conn(), input.step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no mapping found for step {}", input.step_id))?;
    let done = input.status == "done" || input.status == "shipped";
    let updated = NewStepSessionMapping {
        step_id: mapping.step_id,
        session_id: mapping.session_id,
        card_id: mapping.card_id,
        state_path: mapping.state_path,
        status: input.status,
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
    mapping_dao::get_by_id(db.conn(), mapping.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "mapping not found after update".to_string())
}

fn mappings_for_steps(
    conn: &rusqlite::Connection,
    steps: &[StepRow],
) -> Result<Vec<StepSessionMappingRow>, String> {
    let mut mappings = Vec::new();
    for step in steps {
        if let Some(mapping) = mapping_dao::get_by_step(conn, step.id).map_err(|e| e.to_string())? {
            mappings.push(mapping);
        }
    }
    Ok(mappings)
}

fn done_step_ids(steps: &[StepRow], mappings: &[StepSessionMappingRow]) -> HashSet<String> {
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

fn dependencies_done(step: &StepRow, done_step_ids: &HashSet<String>) -> bool {
    step.dependencies
        .as_ref()
        .and_then(|deps| deps.as_array())
        .map(|deps| {
            deps.iter().all(|dep| {
                dep.as_str()
                    .map(|dep_id| done_step_ids.contains(dep_id))
                    .unwrap_or(true)
            })
        })
        .unwrap_or(true)
}

fn validate_unique_step_ids(steps: &[StepDraftInput]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for step in steps {
        if !ids.insert(step.step_id.as_str()) {
            return Err(format!("duplicate step_id: {}", step.step_id));
        }
    }
    Ok(())
}

fn join_string_array(value: Option<&serde_json::Value>) -> Option<String> {
    let items = value?
        .as_array()?
        .iter()
        .filter_map(|item| item.as_str())
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items.join("\n"))
    }
}
