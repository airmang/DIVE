use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::dao::{
    card as card_dao, event_log as event_log_dao, interview as interview_dao, plan as plan_dao,
    project as project_dao, session as session_dao, step as step_dao,
    step_session_mapping as mapping_dao, workmap as workmap_dao,
};
use crate::db::models::{
    CardState, EventLogRow, InterviewRow, NewCard, NewInterview, NewPlan, NewSession, NewStep,
    NewStepSessionMapping, NewWorkmap, PlanRow, ProjectRow, StepRow, StepSessionMappingRow,
};
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::dive::plan_router::{
    self, PlanRouterContext, PlanRouterDecision, PlanRouterStepContext, RouterStepDraft,
};
use crate::ipc::AppState;
use crate::workspace_plan as workspace_plan_service;

const ROUTE_CANCELLED_MESSAGE: &str = "route chat cancelled";
const MAX_PLAN_STEPS: usize = 8;
const MAX_STEP_EXPECTED_FILES: usize = 8;
const MAX_STEP_ACCEPTANCE_CRITERIA: usize = 8;
const MAX_VERIFICATION_COMMAND_WORDS: usize = 24;
const BROAD_SCOPE_MARKERS: &[&str] = &[
    "desktop app",
    "full app",
    "full-stack",
    "full stack",
    "crud",
    "calendar",
    "notification",
    "auth",
    "database",
    "end-to-end",
    "end to end",
    "데스크톱 앱",
    "전체 앱",
    "전체 기능",
    "일정",
    "캘린더",
    "알림",
    "인증",
    "데이터베이스",
    "완성",
];

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
    pub active_count: i64,
    pub done_count: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspacePlanDashboardStep {
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub title: String,
    pub position: i64,
    pub status: String,
    pub session_id: Option<i64>,
    pub card_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanActivityLogRow {
    pub id: i64,
    pub plan_id: i64,
    pub event_type: String,
    pub message: String,
    pub step_id: Option<i64>,
    pub stable_step_id: Option<String>,
    pub step_title: Option<String>,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspacePlanDashboardProject {
    pub project_id: i64,
    pub project_name: String,
    pub project_path: String,
    pub project_updated_at: i64,
    pub plan_id: Option<i64>,
    pub plan_goal: Option<String>,
    pub plan_status: Option<String>,
    pub step_count: i64,
    pub ready_count: i64,
    pub blocked_count: i64,
    pub active_count: i64,
    pub done_count: i64,
    pub shipped_count: i64,
    pub next_ready_steps: Vec<WorkspacePlanDashboardStep>,
    pub active_steps: Vec<WorkspacePlanDashboardStep>,
    pub last_activity: Option<PlanActivityLogRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepStateUpdateInput {
    pub step_id: i64,
    pub status: String,
    pub evidence: Option<String>,
    pub verification_status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RouteDecision {
    AddStep {
        draft: Box<StepDraftInput>,
        reason: String,
    },
    Chat {
        reason: String,
    },
    Skip {
        reason: String,
    },
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
pub async fn workspace_plan_dashboard(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspacePlanDashboardProject>, String> {
    workspace_plan_dashboard_impl(&state)
}

#[tauri::command]
pub async fn workspace_plan_activity(
    state: State<'_, AppState>,
    plan_id: i64,
    limit: i64,
) -> Result<Vec<PlanActivityLogRow>, String> {
    workspace_plan_activity_impl(&state, plan_id, limit)
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
    replace_approved: Option<bool>,
) -> Result<(PlanRow, Vec<StepRow>), String> {
    workspace_plan_generate_draft_impl(
        &state,
        interview_id,
        plan_input,
        replace_approved.unwrap_or(false),
    )
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
pub async fn workspace_plan_route_chat(
    state: State<'_, AppState>,
    project_id: i64,
    prompt: String,
    route_request_id: Option<String>,
) -> Result<RouteDecision, String> {
    workspace_plan_route_chat_impl(&state, project_id, prompt, route_request_id).await
}

#[tauri::command]
pub async fn workspace_plan_route_cancel(
    state: State<'_, AppState>,
    route_request_id: String,
) -> Result<(), String> {
    workspace_plan_route_cancel_impl(&state, route_request_id)
}

#[tauri::command]
pub async fn workspace_plan_append_step(
    state: State<'_, AppState>,
    plan_id: i64,
    draft: StepDraftInput,
) -> Result<StepRow, String> {
    workspace_plan_append_step_impl(&state, plan_id, draft)
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
            active_count: 0,
            done_count: 0,
        });
    };

    let steps = step_dao::list_by_plan(db.conn(), plan.id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(db.conn(), &steps)?;
    let progress = derive_plan_progress(&steps, &mappings);

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
        step_count: progress.step_count,
        ready_count: progress.ready_count,
        blocked_count: progress.blocked_count,
        active_count: progress.active_count,
        done_count: progress.done_count,
    })
}

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
    mut plan_input: PlanDraftInput,
    replace_approved: bool,
) -> Result<(PlanRow, Vec<StepRow>), String> {
    validate_plan_draft(&plan_input)?;
    for step in &mut plan_input.steps {
        sanitize_step_verification(step);
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let interview = interview_dao::get_by_id(conn, interview_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("interview {interview_id} not found"))?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(existing) =
        plan_dao::get_by_project(&tx, interview.project_id).map_err(|e| e.to_string())?
    {
        // A draft is always replaced silently. An approved plan is only replaced
        // when the caller explicitly opted in (the UI confirms first, since this
        // discards the approved plan and its steps — Step/StepSessionMapping
        // cascade on the Plan delete). Without opt-in we still refuse, so the UI
        // can detect the case and prompt instead of silently destroying work.
        if existing.status == "draft" || replace_approved {
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
    let plan = plan_dao::get_by_id(db.conn(), plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found after approve"))?;
    let _ = append_plan_activity(
        db.conn(),
        &plan,
        None,
        None,
        "plan_approved",
        "Plan approved",
        None,
    );
    Ok(plan)
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

pub async fn workspace_plan_route_chat_impl(
    state: &AppState,
    project_id: i64,
    prompt: String,
    route_request_id: Option<String>,
) -> Result<RouteDecision, String> {
    let cancel = register_route_cancel(state, route_request_id.as_deref())?;
    let result = workspace_plan_route_chat_inner(state, project_id, prompt, cancel.clone()).await;
    if let Some(route_request_id) = route_request_id {
        let mut guard = state.route_cancels.lock().map_err(|e| e.to_string())?;
        guard.remove(&route_request_id);
    }
    result
}

pub fn workspace_plan_route_cancel_impl(
    state: &AppState,
    route_request_id: String,
) -> Result<(), String> {
    let guard = state.route_cancels.lock().map_err(|e| e.to_string())?;
    if let Some(token) = guard.get(&route_request_id) {
        token.store(true, Ordering::SeqCst);
    }
    Ok(())
}

async fn workspace_plan_route_chat_inner(
    state: &AppState,
    project_id: i64,
    prompt: String,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<RouteDecision, String> {
    let status = workspace_plan_status_impl(state, project_id)?;
    let Some(plan_id) = status.plan_id else {
        return Ok(RouteDecision::Skip {
            reason: "approved plan not found".into(),
        });
    };
    if !status.has_approved_plan {
        return Ok(RouteDecision::Skip {
            reason: "approved plan not found".into(),
        });
    }

    check_route_cancel(cancel.as_ref())?;
    let runtime = if let Some(cancel) = cancel.clone() {
        tokio::select! {
            result = state.ensure_provider_runtime() => result?,
            _ = wait_for_route_cancel(cancel) => return Err(ROUTE_CANCELLED_MESSAGE.into()),
        }
    } else {
        state.ensure_provider_runtime().await?
    };
    check_route_cancel(cancel.as_ref())?;
    let ctx = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(db.conn(), plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found"))?;
        let steps = step_dao::list_by_plan(db.conn(), plan_id).map_err(|e| e.to_string())?;
        let mappings = mappings_for_steps(db.conn(), &steps)?;
        build_router_context(&plan, &steps, &mappings)
    };

    let decision = plan_router::decide_cancelable(
        runtime.provider.as_ref(),
        runtime.model,
        prompt,
        ctx,
        cancel,
    )
    .await?;
    match decision {
        PlanRouterDecision::Chat { reason } => Ok(RouteDecision::Chat { reason }),
        PlanRouterDecision::AddStep { draft, reason } => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let draft = step_draft_input_from_router(db.conn(), plan_id, *draft)?;
            if let Some(existing) = find_duplicate_step(db.conn(), plan_id, &draft)? {
                return Ok(RouteDecision::Chat {
                    reason: format!(
                        "already covered by {}: {}",
                        existing.step_id, existing.title
                    ),
                });
            }
            Ok(RouteDecision::AddStep {
                draft: Box::new(draft),
                reason,
            })
        }
    }
}

fn register_route_cancel(
    state: &AppState,
    route_request_id: Option<&str>,
) -> Result<Option<Arc<AtomicBool>>, String> {
    let Some(route_request_id) = route_request_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let token = Arc::new(AtomicBool::new(false));
    let mut guard = state.route_cancels.lock().map_err(|e| e.to_string())?;
    guard.insert(route_request_id.to_string(), token.clone());
    Ok(Some(token))
}

fn check_route_cancel(cancel: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    if cancel
        .map(|token| token.load(Ordering::SeqCst))
        .unwrap_or(false)
    {
        Err(ROUTE_CANCELLED_MESSAGE.into())
    } else {
        Ok(())
    }
}

async fn wait_for_route_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

pub fn workspace_plan_append_step_impl(
    state: &AppState,
    plan_id: i64,
    mut draft: StepDraftInput,
) -> Result<StepRow, String> {
    validate_append_draft(&draft)?;
    sanitize_step_verification(&mut draft);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_id(&tx, plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {plan_id} not found"))?;
    if plan.status != "approved" {
        return Err("plan must be approved before appending steps".into());
    }
    let existing_count = step_dao::list_by_plan(&tx, plan_id)
        .map_err(|e| e.to_string())?
        .len();
    if existing_count >= MAX_PLAN_STEPS {
        return Err(format!(
            "plan exceeds DIVE execution envelope: at most {MAX_PLAN_STEPS} steps are allowed"
        ));
    }

    validate_draft_dependencies(&tx, plan_id, &draft.dependencies)?;
    if let Some(existing) = find_duplicate_step(&tx, plan_id, &draft)? {
        return Err(format!(
            "step already exists: {} ({})",
            existing.step_id, existing.title
        ));
    }
    let step_id = step_dao::next_step_id(&tx, plan_id).map_err(|e| e.to_string())?;
    let position = step_dao::next_position(&tx, plan_id).map_err(|e| e.to_string())?;
    let inserted_id = step_dao::insert(
        &tx,
        &NewStep {
            plan_id,
            step_id,
            title: draft.title,
            summary: Some(draft.summary),
            instruction_seed: Some(draft.instruction_seed),
            expected_files: Some(serde_json::json!(draft.expected_files)),
            acceptance_criteria: Some(serde_json::json!(draft.acceptance_criteria)),
            verification_kind: draft.verification_type,
            verification_command: draft.verification_command,
            verification_manual_check: None,
            dependencies: Some(serde_json::json!(draft.dependencies)),
            parallel_group: draft.parallel_group.map(|group| group.to_string()),
            position,
        },
    )
    .map_err(|e| e.to_string())?;
    step_dao::validate_dependencies(&tx, plan_id).map_err(|e| e.to_string())?;
    let row = step_dao::get_by_id(&tx, inserted_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "step not found after insert".to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let _ = append_plan_activity(
        conn,
        &plan,
        Some(&row),
        None,
        "plan_step_appended",
        "Step appended to plan",
        None,
    );
    Ok(row)
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
    let done_ids = done_step_ids(&steps, &mappings);
    let blocked_dependencies = blocked_dependency_ids(&step, &done_ids);
    if !blocked_dependencies.is_empty() {
        let reason = format!(
            "step is blocked: waiting for {}",
            blocked_dependencies.join(", ")
        );
        let _ = append_plan_activity(
            conn,
            &plan,
            Some(&step),
            None,
            "plan_step_open_failed",
            "Step start blocked",
            Some(&reason),
        );
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
    let _ = append_plan_activity(
        conn,
        &plan,
        Some(&step),
        Some(session_id),
        "plan_step_opened",
        "Step session started",
        None,
    );
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
    let _ = append_plan_activity(
        db.conn(),
        &plan,
        Some(&step),
        mapping.session_id,
        "plan_step_state_changed",
        &message,
        None,
    );
    Ok(mapping)
}

#[derive(Default)]
struct PlanProgress {
    step_count: i64,
    ready_count: i64,
    blocked_count: i64,
    active_count: i64,
    done_count: i64,
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
        });
    };

    let steps = step_dao::list_by_plan(conn, plan.id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(conn, &steps)?;
    let progress = derive_plan_progress(&steps, &mappings);
    let last_activity = latest_plan_activity(conn, plan.id)?;

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
    })
}

fn derive_plan_progress(steps: &[StepRow], mappings: &[StepSessionMappingRow]) -> PlanProgress {
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

fn append_plan_activity(
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
    let limit = if limit <= 0 {
        20
    } else {
        limit.min(100) as usize
    };
    let mut rows = event_log_dao::list(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|row| plan_activity_from_event(row, Some(plan_id)))
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    rows.truncate(limit);
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

fn step_state_activity_message(status: &str) -> String {
    match status {
        "done" => "Step marked done".into(),
        "shipped" => "Step marked shipped".into(),
        "in_progress" => "Step marked in progress".into(),
        other => format!("Step marked {other}"),
    }
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
    blocked_dependency_ids(step, done_step_ids).is_empty()
}

fn blocked_dependency_ids(step: &StepRow, done_step_ids: &HashSet<String>) -> Vec<String> {
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

fn validate_unique_step_ids(steps: &[StepDraftInput]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for step in steps {
        if !ids.insert(step.step_id.as_str()) {
            return Err(format!("duplicate step_id: {}", step.step_id));
        }
    }
    Ok(())
}

fn validate_plan_draft(plan_input: &PlanDraftInput) -> Result<(), String> {
    if plan_input.steps.is_empty() {
        return Err("plan must include at least one step".into());
    }
    if plan_input.steps.len() > MAX_PLAN_STEPS {
        return Err(format!(
            "plan exceeds DIVE execution envelope: at most {MAX_PLAN_STEPS} steps are allowed"
        ));
    }
    validate_unique_step_ids(&plan_input.steps)?;
    for step in &plan_input.steps {
        validate_step_envelope(step)?;
    }
    Ok(())
}

fn validate_step_envelope(step: &StepDraftInput) -> Result<(), String> {
    if step.expected_files.len() > MAX_STEP_EXPECTED_FILES {
        return Err(format!(
            "step '{}' exceeds DIVE execution envelope: at most {MAX_STEP_EXPECTED_FILES} expected files per step",
            step.step_id
        ));
    }
    if step.acceptance_criteria.len() > MAX_STEP_ACCEPTANCE_CRITERIA {
        return Err(format!(
            "step '{}' exceeds DIVE execution envelope: at most {MAX_STEP_ACCEPTANCE_CRITERIA} acceptance criteria per step",
            step.step_id
        ));
    }
    let scope_score = broad_scope_score(step);
    if scope_score >= 2 && step.expected_files.len() >= 4 {
        return Err(format!(
            "step '{}' is too broad for the DIVE execution envelope; split it into smaller file-focused steps",
            step.step_id
        ));
    }
    Ok(())
}

fn broad_scope_score(step: &StepDraftInput) -> usize {
    let mut text = format!(
        "{}\n{}\n{}\n{}",
        step.title,
        step.summary,
        step.instruction_seed,
        step.acceptance_criteria.join("\n")
    )
    .to_ascii_lowercase();
    for item in &step.expected_files {
        text.push('\n');
        text.push_str(&item.to_ascii_lowercase());
    }
    BROAD_SCOPE_MARKERS
        .iter()
        .filter(|marker| text.contains(&marker.to_ascii_lowercase()))
        .count()
}

/// Whether a verification_command fits DIVE's no-shell, single-command, 60s
/// execution envelope. Used to *sanitize* (drop) rather than reject: a model
/// emitting a shell-y command should not block the whole plan from generating.
fn verification_command_is_envelope_safe(command: &str) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return true;
    }
    const FORBIDDEN_CHARS: &[char] = &['|', '&', ';', '<', '>', '(', ')', '$', '`', '\n', '\r'];
    if command.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return false;
    }
    if command.split_whitespace().count() > MAX_VERIFICATION_COMMAND_WORDS {
        return false;
    }
    let executable = command
        .split_whitespace()
        .next()
        .unwrap_or("")
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    !matches!(
        executable.as_str(),
        "bash" | "sh" | "zsh" | "fish" | "cmd" | "powershell" | "pwsh"
    )
}

/// If a step's verification_command does not fit the execution envelope, drop it
/// and downgrade verification to manual instead of rejecting the whole plan. The
/// command is never executed once dropped, so this is safe; honest-verify
/// already surfaces a manual/unverified step as "not externally verified",
/// keeping the supervision signal honest while letting the plan generate on the
/// first try. Returns true when the command was sanitized away.
fn sanitize_step_verification(step: &mut StepDraftInput) -> bool {
    let needs_sanitize = step
        .verification_command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .is_some_and(|command| !verification_command_is_envelope_safe(command));
    if needs_sanitize {
        step.verification_command = None;
        step.verification_type = Some("manual".to_string());
    }
    needs_sanitize
}

fn build_router_context(
    plan: &PlanRow,
    steps: &[StepRow],
    mappings: &[StepSessionMappingRow],
) -> PlanRouterContext {
    let done_ids = done_step_ids(steps, mappings);
    PlanRouterContext {
        goal: plan.goal.clone(),
        intent_summary: plan.intent_summary.clone(),
        scope: json_string_array(plan.scope.as_ref()),
        acceptance_criteria: json_string_array(plan.acceptance_criteria.as_ref()),
        steps: steps
            .iter()
            .map(|step| {
                let status = mappings
                    .iter()
                    .find(|mapping| mapping.step_id == step.id)
                    .map(|mapping| mapping.status.clone())
                    .unwrap_or_else(|| {
                        if dependencies_done(step, &done_ids) {
                            "ready".into()
                        } else {
                            "blocked".into()
                        }
                    });
                PlanRouterStepContext {
                    step_id: step.step_id.clone(),
                    title: step.title.clone(),
                    status,
                    dependencies: json_string_array(step.dependencies.as_ref()),
                }
            })
            .collect(),
    }
}

fn step_draft_input_from_router(
    conn: &rusqlite::Connection,
    plan_id: i64,
    draft: RouterStepDraft,
) -> Result<StepDraftInput, String> {
    Ok(StepDraftInput {
        title: draft.title,
        summary: draft.summary,
        instruction_seed: draft.instruction_seed,
        expected_files: draft.expected_files,
        acceptance_criteria: draft.acceptance_criteria,
        verification_command: draft.verification_command,
        verification_type: draft.verification_type,
        dependencies: draft.dependencies,
        parallel_group: draft.parallel_group,
        position: step_dao::next_position(conn, plan_id).map_err(|e| e.to_string())?,
        step_id: step_dao::next_step_id(conn, plan_id).map_err(|e| e.to_string())?,
    })
}

fn find_duplicate_step(
    conn: &rusqlite::Connection,
    plan_id: i64,
    draft: &StepDraftInput,
) -> Result<Option<StepRow>, String> {
    let draft_title = normalize_step_text(&draft.title);
    let draft_instruction = normalize_step_text(&draft.instruction_seed);
    let draft_summary = normalize_step_text(&draft.summary);

    for step in step_dao::list_by_plan(conn, plan_id).map_err(|e| e.to_string())? {
        let title_matches =
            !draft_title.is_empty() && draft_title == normalize_step_text(&step.title);
        let instruction_matches = step
            .instruction_seed
            .as_deref()
            .map(normalize_step_text)
            .is_some_and(|existing| !draft_instruction.is_empty() && existing == draft_instruction);
        let summary_matches = step
            .summary
            .as_deref()
            .map(normalize_step_text)
            .is_some_and(|existing| !draft_summary.is_empty() && existing == draft_summary);
        if title_matches || instruction_matches || summary_matches {
            return Ok(Some(step));
        }
    }
    Ok(None)
}

fn normalize_step_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|ch| ch.is_alphanumeric())
        .collect()
}

fn validate_append_draft(draft: &StepDraftInput) -> Result<(), String> {
    if draft.title.trim().is_empty() {
        return Err("step title is required".into());
    }
    if draft.summary.trim().is_empty() {
        return Err("step summary is required".into());
    }
    if draft.instruction_seed.trim().is_empty() {
        return Err("step instruction_seed is required".into());
    }
    validate_step_envelope(draft)?;
    Ok(())
}

fn validate_draft_dependencies(
    conn: &rusqlite::Connection,
    plan_id: i64,
    dependencies: &[String],
) -> Result<(), String> {
    let existing = step_dao::list_by_plan(conn, plan_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|step| step.step_id)
        .collect::<HashSet<_>>();
    for dependency in dependencies {
        if !existing.contains(dependency) {
            return Err(format!("invalid dependency: {dependency}"));
        }
    }
    Ok(())
}

fn json_string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default()
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

#[cfg(test)]
mod envelope_tests {
    use super::*;

    fn focused_step() -> StepDraftInput {
        StepDraftInput {
            title: "Add quiz question state".into(),
            summary: "Store current question and selected answer.".into(),
            instruction_seed: "Implement the current-question state in src/App.tsx only.".into(),
            expected_files: vec!["src/App.tsx".into()],
            acceptance_criteria: vec!["Selecting an answer updates visible state.".into()],
            verification_command: Some("pnpm test".into()),
            verification_type: Some("command".into()),
            dependencies: Vec::new(),
            parallel_group: None,
            position: 1,
            step_id: "step-001".into(),
        }
    }

    #[test]
    fn envelope_allows_small_file_focused_step() {
        assert!(validate_step_envelope(&focused_step()).is_ok());
    }

    #[test]
    fn envelope_rejects_broad_desktop_crud_calendar_step() {
        let mut step = focused_step();
        step.step_id = "step-broad".into();
        step.title = "일정 관리 데스크톱 앱 완성".into();
        step.summary = "CRUD, 알림, 캘린더, 데이터베이스를 한 번에 구현한다.".into();
        step.instruction_seed =
            "Build the full desktop app with calendar CRUD, notification reminders, and database persistence."
                .into();
        step.expected_files = vec![
            "src/App.tsx".into(),
            "src/calendar.ts".into(),
            "src/database.ts".into(),
            "src/notifications.ts".into(),
        ];

        let err = validate_step_envelope(&step).unwrap_err();
        assert!(err.contains("too broad"));
    }

    #[test]
    fn envelope_accepts_step_with_shell_verification_command() {
        // A shell-y verification_command must no longer reject the whole step;
        // it is sanitized away at persist time (see sanitize tests below).
        let mut step = focused_step();
        step.verification_command = Some("bash -lc 'pnpm test'".into());
        assert!(validate_step_envelope(&step).is_ok());
    }

    #[test]
    fn sanitize_drops_shell_verification_and_downgrades_to_manual() {
        let mut step = focused_step();
        step.verification_command = Some("bash -lc 'pnpm test'".into());
        assert!(sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command, None);
        assert_eq!(step.verification_type.as_deref(), Some("manual"));
    }

    #[test]
    fn sanitize_drops_piped_command() {
        let mut step = focused_step();
        step.verification_command = Some("cat foo | grep bar".into());
        assert!(sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command, None);
        assert_eq!(step.verification_type.as_deref(), Some("manual"));
    }

    #[test]
    fn sanitize_keeps_envelope_safe_command() {
        let mut step = focused_step();
        step.verification_command = Some("pnpm test".into());
        assert!(!sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command.as_deref(), Some("pnpm test"));
        assert_eq!(step.verification_type.as_deref(), Some("command"));
    }
}
