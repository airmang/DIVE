//! Tauri command wrappers for the workspace-plan IPC surface.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use tauri::State;

use crate::db::models::{
    InterviewRow, LiveProjectSpecDraftRow, PlanRow, ProjectSpec, ProjectSpecDelta,
    ProjectSpecDraft, StepRow, StepSessionMappingRow,
};
use crate::ipc::AppState;

use super::*;

#[tauri::command]
pub async fn workspace_plan_status(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<WorkspacePlanStatus, String> {
    workspace_plan_status_impl(&state, project_id)
}

#[tauri::command]
pub async fn workspace_prd_status(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<WorkspacePrdStatus, String> {
    workspace_prd_status_impl(&state, project_id)
}

#[tauri::command]
pub async fn workspace_prd_get(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<Option<ProjectSpec>, String> {
    workspace_prd_get_impl(&state, project_id)
}

#[tauri::command]
pub async fn workspace_prd_draft_get(
    state: State<'_, AppState>,
    project_id: i64,
    draft_id: Option<String>,
) -> Result<LiveProjectSpecDraftRow, String> {
    workspace_prd_draft_get_impl(&state, project_id, draft_id)
}

#[tauri::command]
pub async fn workspace_prd_draft_save(
    state: State<'_, AppState>,
    input: PrdDraftSaveInput,
) -> Result<LiveProjectSpecDraftRow, String> {
    workspace_prd_draft_save_impl(&state, input)
}

#[tauri::command]
pub async fn workspace_prd_interview_turn(
    state: State<'_, AppState>,
    project_id: i64,
    draft_id: String,
    answer: String,
    conversation: Option<Vec<PrdInterviewConversationTurnInput>>,
    provider: String,
    model: String,
) -> Result<PrdInterviewTurnOutput, String> {
    workspace_prd_interview_turn_impl(
        &state,
        PrdInterviewTurnInput {
            project_id,
            draft_id,
            answer,
            conversation: conversation.unwrap_or_default(),
            provider,
            model,
        },
    )
    .await
}

#[tauri::command]
pub async fn workspace_prd_save(
    state: State<'_, AppState>,
    project_id: i64,
    spec: ProjectSpecDraft,
    reason: String,
) -> Result<ProjectSpec, String> {
    workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec,
            reason,
        },
    )
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
pub async fn workspace_plan_current_draft(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<Option<(PlanRow, Vec<StepRow>)>, String> {
    workspace_plan_current_draft_impl(&state, project_id)
}

#[tauri::command]
pub async fn workspace_plan_approve(
    state: State<'_, AppState>,
    plan_id: i64,
    critique_resolution: Option<PlanCritiqueResolution>,
) -> Result<PlanRow, String> {
    workspace_plan_approve_impl(&state, plan_id, critique_resolution)
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
    mutation_reason: Option<String>,
    linked_criterion_ids: Option<Vec<String>>,
    prd_delta: Option<ProjectSpecDelta>,
) -> Result<StepRow, String> {
    workspace_plan_append_step_with_options_impl(
        &state,
        plan_id,
        draft,
        AppendStepOptions {
            mutation_reason,
            linked_criterion_ids: linked_criterion_ids.unwrap_or_default(),
            prd_delta,
        },
    )
}

#[tauri::command]
pub async fn workspace_plan_remove_step(
    state: State<'_, AppState>,
    plan_id: i64,
    step_db_id: i64,
    mutation_reason: Option<String>,
) -> Result<(), String> {
    workspace_plan_remove_step_impl(&state, plan_id, step_db_id, mutation_reason)
}

#[tauri::command]
pub async fn workspace_plan_supersede_step(
    state: State<'_, AppState>,
    plan_id: i64,
    target_step_db_id: i64,
    replacement: StepDraftInput,
    mutation_reason: Option<String>,
    linked_criterion_ids: Option<Vec<String>>,
    prd_delta: Option<ProjectSpecDelta>,
) -> Result<StepRow, String> {
    workspace_plan_supersede_step_impl(
        &state,
        plan_id,
        target_step_db_id,
        replacement,
        AppendStepOptions {
            mutation_reason,
            linked_criterion_ids: linked_criterion_ids.unwrap_or_default(),
            prd_delta,
        },
    )
}

#[tauri::command]
pub async fn workspace_plan_append_steps(
    state: State<'_, AppState>,
    plan_id: i64,
    drafts: Vec<MultiStepDraftInput>,
    mutation_reason: Option<String>,
    linked_criterion_ids: Option<Vec<String>>,
    prd_delta: Option<ProjectSpecDelta>,
) -> Result<Vec<StepRow>, String> {
    workspace_plan_append_steps_impl(
        &state,
        plan_id,
        drafts,
        AppendStepOptions {
            mutation_reason,
            linked_criterion_ids: linked_criterion_ids.unwrap_or_default(),
            prd_delta,
        },
    )
}

#[tauri::command]
pub async fn workspace_plan_challenge_step_rationale(
    state: State<'_, AppState>,
    input: StepRationaleChallengeInput,
) -> Result<StepRationaleChallengeOutput, String> {
    workspace_plan_challenge_step_rationale_impl(&state, input)
}

#[tauri::command]
pub async fn workspace_plan_respond_to_plan_adjustment_offer(
    state: State<'_, AppState>,
    input: PlanAdjustmentOfferResponseInput,
) -> Result<PlanAdjustmentOfferResponseOutput, String> {
    workspace_plan_respond_to_plan_adjustment_offer_impl(&state, input)
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
