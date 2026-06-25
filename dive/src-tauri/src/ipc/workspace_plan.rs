use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::db::dao::{
    card as card_dao, event_log as event_log_dao, interview as interview_dao, plan as plan_dao,
    plan_mutation as plan_mutation_dao, prd as prd_dao, project as project_dao,
    session as session_dao, step as step_dao, step_session_mapping as mapping_dao,
    workmap as workmap_dao,
};
use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus, CardState,
    EventLogRow, InterviewRow, LiveProjectSpecDraftRow, NewCard, NewInterview,
    NewLiveProjectSpecDraft, NewObjection, NewPlan, NewPlanMutation, NewProjectSpecVersion,
    NewSession, NewStep, NewStepSessionMapping, NewWorkmap, ObjectionSuggestionStatus,
    PlanMutationType, PlanRow, PrdPatch, PrdPatchOperation, ProjectRow, ProjectSpec,
    ProjectSpecDelta, ProjectSpecDraft, ProjectSpecStatus, ProjectSpecVersionRow,
    ScopeExpansionAssessment, StepRow, StepSessionMappingRow,
};
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::dive::plan_router::{
    self, PlanRouterContext, PlanRouterDecision, PlanRouterStepContext, RouterStepDraft,
};
use crate::ipc::AppState;
use crate::providers::{with_retry, ChatEvent, ChatRequest, FinishReason, Message, ToolChoice};
use crate::workspace_plan as workspace_plan_service;

const ROUTE_CANCELLED_MESSAGE: &str = "route chat cancelled";
const MAX_PLAN_STEPS: usize = 8;
const MAX_STEP_EXPECTED_FILES: usize = 8;
const MAX_STEP_ACCEPTANCE_CRITERIA: usize = 8;
const MAX_VERIFICATION_COMMAND_WORDS: usize = 24;
const MAX_PRD_PATCH_OPERATIONS: usize = 20;
const MAX_PRD_PATCH_TEXT_CHARS: usize = 1200;
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
    pub prd_status: WorkspacePrdStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePrdStatus {
    pub status: String,
    pub project_spec_id: Option<String>,
    pub current_version: Option<i64>,
    pub draft_id: Option<String>,
    pub base_version: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdInterviewTurnInput {
    pub project_id: i64,
    pub draft_id: String,
    pub answer: String,
    #[serde(default)]
    pub conversation: Vec<PrdInterviewConversationTurnInput>,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdInterviewConversationTurnInput {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrdInterviewTurnOutput {
    pub turn_id: String,
    pub assistant_message: String,
    pub patch: Option<PrdPatch>,
    pub validation_outcome: String,
    pub applied_field_paths: Vec<String>,
    pub rejected_reasons: Vec<String>,
    pub live_draft: LiveProjectSpecDraftRow,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdDraftSaveInput {
    pub project_id: i64,
    pub draft: LiveProjectSpecDraftRow,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdSaveInput {
    pub project_id: i64,
    pub spec: ProjectSpecDraft,
    pub reason: String,
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
    pub project_spec: Option<ProjectSpec>,
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
#[serde(untagged)]
pub enum AcceptanceCriterionInput {
    Text(String),
    Object(AcceptanceCriterion),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepDraftInput {
    pub title: String,
    pub summary: String,
    pub instruction_seed: String,
    pub expected_files: Vec<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
    #[serde(default)]
    pub linked_criterion_ids: Vec<String>,
    #[serde(default)]
    pub rationale: Option<String>,
    pub verification_command: Option<String>,
    pub verification_type: Option<String>,
    pub dependencies: Vec<String>,
    pub parallel_group: Option<i64>,
    pub position: i64,
    pub step_id: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppendStepOptions {
    #[serde(default)]
    pub mutation_reason: Option<String>,
    #[serde(default)]
    pub linked_criterion_ids: Vec<String>,
    #[serde(default)]
    pub prd_delta: Option<ProjectSpecDelta>,
}

/// S-033: a stable reference to an existing plan step, resolved at the IPC
/// layer so the frontend can render/confirm a remove or supersede proposal.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepRefPayload {
    pub step_id: String,
    pub db_id: i64,
    pub title: String,
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
    /// S-033: ask one criterion-linked question before drafting. Non-mutating;
    /// the answer feeds a subsequent draft.
    Clarify {
        question: String,
        candidate_intent: String,
        suggested_criterion_ids: Vec<String>,
        reason: String,
    },
    /// S-033: a reviewable proposal to retire an existing active step.
    RemoveStep {
        target: StepRefPayload,
        reason: String,
    },
    /// S-033: a reviewable proposal to replace an existing active step.
    SupersedeStep {
        target: StepRefPayload,
        replacement: Box<StepDraftInput>,
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
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
    pub steps: Vec<StepDraftInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRationaleChallengeInput {
    pub plan_id: i64,
    pub step_db_id: i64,
    pub text: String,
    #[serde(default)]
    pub linked_criterion_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepRationaleChallengeOutput {
    pub objection_id: String,
    pub suggestion_status: String,
    pub offer_id: String,
    pub offer_kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_seed: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanAdjustmentOfferResponse {
    Accepted,
    Dismissed,
}

impl PlanAdjustmentOfferResponse {
    fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }

    fn suggestion_status(self) -> ObjectionSuggestionStatus {
        match self {
            Self::Accepted => ObjectionSuggestionStatus::Accepted,
            Self::Dismissed => ObjectionSuggestionStatus::Dismissed,
        }
    }

    fn event_type(self) -> &'static str {
        match self {
            Self::Accepted => dive_event_log::PLAN_ADJUSTMENT_ACCEPTED_EVENT,
            Self::Dismissed => dive_event_log::PLAN_ADJUSTMENT_DISMISSED_EVENT,
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdjustmentOfferResponseInput {
    pub plan_id: i64,
    pub step_db_id: i64,
    pub objection_id: String,
    pub offer_id: String,
    pub response: PlanAdjustmentOfferResponse,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdjustmentOfferResponseOutput {
    pub objection_id: String,
    pub offer_id: String,
    pub suggestion_status: String,
}

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

pub fn workspace_plan_status_impl(
    state: &AppState,
    project_id: i64,
) -> Result<WorkspacePlanStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let prd_status = workspace_prd_status_from_conn(db.conn(), project_id)?;
    let plan = plan_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?;
    let Some(plan) = plan else {
        if prd_status.status != "minimal" {
            let status = if prd_status.status == "draft" {
                "prd_draft"
            } else {
                "needs_prd"
            };
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
                prd_status,
            });
        }
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
            prd_status,
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
        prd_status,
    })
}

pub fn workspace_prd_status_impl(
    state: &AppState,
    project_id: i64,
) -> Result<WorkspacePrdStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workspace_prd_status_from_conn(db.conn(), project_id)
}

pub fn workspace_prd_get_impl(
    state: &AppState,
    project_id: i64,
) -> Result<Option<ProjectSpec>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(prd_dao::latest_version(db.conn(), project_id)
        .map_err(|e| e.to_string())?
        .map(|row| row.snapshot))
}

pub fn workspace_prd_draft_get_impl(
    state: &AppState,
    project_id: i64,
    draft_id: Option<String>,
) -> Result<LiveProjectSpecDraftRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    project_dao::get_by_id(db.conn(), project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", project_id))?;
    load_or_create_prd_draft(
        db.conn(),
        project_id,
        draft_id.as_deref().unwrap_or_default(),
    )
}

pub fn workspace_prd_draft_save_impl(
    state: &AppState,
    input: PrdDraftSaveInput,
) -> Result<LiveProjectSpecDraftRow, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    project_dao::get_by_id(conn, input.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", input.project_id))?;
    let mut draft = input.draft;
    draft.project_id = input.project_id;
    draft.spec.project_id = input.project_id;
    if draft.draft_id.trim().is_empty() {
        draft.draft_id = format!("prd-draft-{}", input.project_id);
    }
    draft.updated_at = now_ms();
    persist_live_prd_draft(conn, &draft)?;
    Ok(draft)
}

pub fn workspace_prd_save_impl(
    state: &AppState,
    input: PrdSaveInput,
) -> Result<ProjectSpec, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    project_dao::get_by_id(conn, input.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", input.project_id))?;
    let save_reason = normalize_prd_save_reason(&input.reason);
    let latest = prd_dao::latest_version(conn, input.project_id).map_err(|e| e.to_string())?;
    let snapshot = project_spec_from_save_input(input, latest.as_ref(), &save_reason)?;
    if !is_confirmable_project_spec(&snapshot) {
        return Err("minimal PRD requires a goal and at least one acceptance criterion".into());
    }
    let previous_version = latest.as_ref().map(|row| row.version);
    let reason = save_reason;
    let delta_summary = prd_delta_summary(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let changed_fields =
        changed_project_spec_fields(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let added_criterion_ids =
        added_criterion_ids(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let retired_criterion_ids =
        retired_criterion_ids(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let criterion_ids = snapshot
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<Vec<_>>();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    prd_dao::insert_version(
        &tx,
        &NewProjectSpecVersion {
            project_spec_id: snapshot.project_spec_id.clone(),
            project_id: snapshot.project_id,
            version: snapshot.current_version,
            previous_version,
            snapshot: snapshot.clone(),
            reason: reason.clone(),
            delta_summary: delta_summary.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    prd_dao::delete_draft(&tx, snapshot.project_id).map_err(|e| e.to_string())?;

    if previous_version.is_none() {
        dive_event_log::append_to_conn(
            &tx,
            None,
            dive_event_log::PRD_AUTHORED_EVENT,
            dive_event_log::prd_authored_payload(
                snapshot.project_id,
                snapshot.project_spec_id.clone(),
                snapshot.current_version,
                criterion_ids,
                summarize_prd(&snapshot),
            ),
        )
        .map_err(|e| e.to_string())?;
    } else {
        dive_event_log::append_to_conn(
            &tx,
            None,
            dive_event_log::PRD_EDITED_EVENT,
            dive_event_log::prd_edited_payload(
                snapshot.project_id,
                snapshot.project_spec_id.clone(),
                previous_version.unwrap_or(0),
                snapshot.current_version,
                reason,
                changed_fields,
                added_criterion_ids,
                retired_criterion_ids,
            ),
        )
        .map_err(|e| e.to_string())?;
    }
    dive_event_log::append_to_conn(
        &tx,
        None,
        dive_event_log::PRD_VERSION_CREATED_EVENT,
        dive_event_log::prd_version_created_payload(
            snapshot.project_id,
            snapshot.project_spec_id.clone(),
            snapshot.current_version,
            previous_version,
            delta_summary,
        ),
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

pub async fn workspace_prd_interview_turn_impl(
    state: &AppState,
    input: PrdInterviewTurnInput,
) -> Result<PrdInterviewTurnOutput, String> {
    if input.provider.trim().is_empty() {
        return Err("provider is required for PRD interview turn".into());
    }
    if input.model.trim().is_empty() {
        return Err("model is required for PRD interview turn".into());
    }
    let base_draft = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::get_by_id(db.conn(), input.project_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("project {} not found", input.project_id))?;
        load_or_create_prd_draft(db.conn(), input.project_id, &input.draft_id)?
    };

    let runtime = state.ensure_provider_runtime().await?;
    let raw = run_prd_interview_turn(
        runtime.provider.as_ref(),
        input.model.clone(),
        &base_draft,
        &input.conversation,
        &input.answer,
    )
    .await?;
    let turn_id = format!("prd-turn-{}", now_ms());
    let parsed = parse_prd_turn_response(&raw, &turn_id);
    let assistant_message = parsed
        .assistant_message
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_default();
    let patch = parsed.patch;

    let mut output = PrdInterviewTurnOutput {
        turn_id: turn_id.clone(),
        assistant_message,
        patch: patch.clone(),
        validation_outcome: "none".into(),
        applied_field_paths: Vec::new(),
        rejected_reasons: Vec::new(),
        live_draft: base_draft,
    };

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let current_draft = load_or_create_prd_draft(conn, input.project_id, &input.draft_id)?;
    if let Some(patch) = patch {
        let operation_kinds = patch
            .operations
            .iter()
            .map(|operation| operation.op.clone())
            .collect::<Vec<_>>();
        dive_event_log::append_to_conn(
            conn,
            None,
            dive_event_log::PRD_PATCH_PROPOSED_EVENT,
            dive_event_log::prd_patch_proposed_payload(
                input.project_id,
                project_spec_id_for_draft(&current_draft),
                current_draft.draft_id.clone(),
                turn_id.clone(),
                patch.patch_id.clone(),
                operation_kinds,
                patch.rationale.clone(),
            ),
        )
        .map_err(|e| e.to_string())?;

        let applied = apply_prd_patch_to_draft(current_draft, &patch);
        output.validation_outcome = applied.validation_outcome.clone();
        output.applied_field_paths = applied.applied_field_paths.clone();
        output.rejected_reasons = applied.rejected_reasons.clone();
        output.live_draft = applied.draft.clone();
        persist_live_prd_draft(conn, &applied.draft)?;

        if applied.validation_outcome == "applied" {
            dive_event_log::append_to_conn(
                conn,
                None,
                dive_event_log::PRD_PATCH_APPLIED_EVENT,
                dive_event_log::prd_patch_applied_payload(
                    input.project_id,
                    project_spec_id_for_draft(&applied.draft),
                    applied.draft.draft_id.clone(),
                    turn_id,
                    patch.patch_id,
                    applied.applied_field_paths,
                    applied.criterion_ids_assigned,
                    applied.student_edited_fields_respected,
                ),
            )
            .map_err(|e| e.to_string())?;
        } else if applied.validation_outcome == "rejected"
            || applied.validation_outcome == "held_for_student"
        {
            dive_event_log::append_to_conn(
                conn,
                None,
                dive_event_log::PRD_PATCH_REJECTED_EVENT,
                dive_event_log::prd_patch_rejected_payload(
                    input.project_id,
                    project_spec_id_for_draft(&applied.draft),
                    applied.draft.draft_id,
                    turn_id,
                    patch.patch_id,
                    applied.rejected_reasons,
                    applied.validation_outcome == "held_for_student",
                ),
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        persist_live_prd_draft(conn, &output.live_draft)?;
    }
    Ok(output)
}

fn workspace_prd_status_from_conn(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<WorkspacePrdStatus, String> {
    project_dao::get_by_id(conn, project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {project_id} not found"))?;
    let latest = prd_dao::latest_version(conn, project_id).map_err(|e| e.to_string())?;
    let draft = prd_dao::get_draft(conn, project_id).map_err(|e| e.to_string())?;
    if let Some(row) = latest
        .as_ref()
        .filter(|row| is_minimal_project_spec(&row.snapshot))
    {
        return Ok(WorkspacePrdStatus {
            status: "minimal".into(),
            project_spec_id: Some(row.project_spec_id.clone()),
            current_version: Some(row.version),
            draft_id: draft.as_ref().map(|row| row.draft_id.clone()),
            base_version: draft.as_ref().and_then(|row| row.base_version),
        });
    }
    if let Some(row) = draft {
        return Ok(WorkspacePrdStatus {
            status: "draft".into(),
            project_spec_id: row.spec.project_spec_id.clone(),
            current_version: row.spec.current_version,
            draft_id: Some(row.draft_id),
            base_version: row.base_version,
        });
    }
    if let Some(row) = latest {
        return Ok(WorkspacePrdStatus {
            status: "draft".into(),
            project_spec_id: Some(row.project_spec_id),
            current_version: Some(row.version),
            draft_id: None,
            base_version: None,
        });
    }
    Ok(WorkspacePrdStatus {
        status: "missing".into(),
        project_spec_id: None,
        current_version: None,
        draft_id: None,
        base_version: None,
    })
}

fn project_spec_from_save_input(
    input: PrdSaveInput,
    latest: Option<&ProjectSpecVersionRow>,
    reason: &str,
) -> Result<ProjectSpec, String> {
    let now = now_ms();
    let version = latest.map(|row| row.version + 1).unwrap_or(1);
    let project_spec_id = input
        .spec
        .project_spec_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| latest.map(|row| row.project_spec_id.clone()))
        .unwrap_or_else(|| format!("prd-{}", input.project_id));
    let acceptance_criteria = normalize_acceptance_criteria(
        input.spec.acceptance_criteria,
        version,
        criterion_source_for_reason(reason),
    );
    Ok(ProjectSpec {
        project_spec_id,
        project_id: input.project_id,
        current_version: version,
        goal: input.spec.goal.trim().to_string(),
        intent_summary: input
            .spec
            .intent_summary
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        scope: compact_unique_strings(input.spec.scope),
        non_goals: compact_unique_strings(input.spec.non_goals),
        constraints: compact_unique_strings(input.spec.constraints),
        acceptance_criteria,
        status: input.spec.status,
        created_at: latest
            .map(|row| row.snapshot.created_at)
            .filter(|created_at| *created_at > 0)
            .unwrap_or(now),
        updated_at: now,
    })
}

fn normalize_prd_save_reason(reason: &str) -> String {
    match reason {
        "interview" | "student_edit" | "ai_assist" | "plan_mutation" => reason.to_string(),
        _ => "student_edit".into(),
    }
}

fn criterion_source_for_reason(reason: &str) -> AcceptanceCriterionSource {
    match reason {
        "interview" | "ai_assist" => AcceptanceCriterionSource::Interview,
        "plan_mutation" => AcceptanceCriterionSource::PlanMutation,
        _ => AcceptanceCriterionSource::StudentEdit,
    }
}

fn compact_unique_strings(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for raw in values {
        let value = raw.trim();
        if !value.is_empty() && !out.iter().any(|existing| existing == value) {
            out.push(value.to_string());
        }
    }
    out
}

fn normalize_acceptance_criteria(
    criteria: Vec<AcceptanceCriterion>,
    version: i64,
    fallback_source: AcceptanceCriterionSource,
) -> Vec<AcceptanceCriterion> {
    let mut out = Vec::new();
    let mut used_ids = HashSet::new();
    for mut criterion in criteria {
        let text = criterion.text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        criterion.text = text;
        criterion.criterion_id = criterion.criterion_id.trim().to_string();
        if !is_valid_acceptance_criterion_id(&criterion.criterion_id)
            || used_ids.contains(&criterion.criterion_id)
        {
            criterion.criterion_id = allocate_acceptance_criterion_id(&out);
        }
        used_ids.insert(criterion.criterion_id.clone());
        if criterion.created_in_version <= 0 {
            criterion.created_in_version = version;
        }
        if criterion.status != AcceptanceCriterionStatus::Retired {
            criterion.status = AcceptanceCriterionStatus::Active;
            criterion.retired_in_version = None;
        }
        if matches!(criterion.source, AcceptanceCriterionSource::Migration)
            && fallback_source != AcceptanceCriterionSource::Migration
        {
            criterion.source = fallback_source;
        }
        out.push(criterion);
    }
    out
}

fn criterion_input_text(input: &AcceptanceCriterionInput) -> Option<String> {
    match input {
        AcceptanceCriterionInput::Text(value) => {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        }
        AcceptanceCriterionInput::Object(criterion) => {
            let value = criterion.text.trim();
            (!value.is_empty()).then(|| value.to_string())
        }
    }
}

fn criterion_input_to_object(
    input: &AcceptanceCriterionInput,
    existing: &[AcceptanceCriterion],
    version: i64,
    fallback_source: AcceptanceCriterionSource,
) -> Option<AcceptanceCriterion> {
    match input {
        AcceptanceCriterionInput::Text(text) => {
            let text = text.trim();
            if text.is_empty() {
                return None;
            }
            if let Some(existing) = existing.iter().find(|criterion| {
                criterion.status == AcceptanceCriterionStatus::Active
                    && criterion.text.trim() == text
            }) {
                return Some(existing.clone());
            }
            Some(AcceptanceCriterion {
                criterion_id: String::new(),
                text: text.to_string(),
                source: fallback_source,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: version,
                retired_in_version: None,
            })
        }
        AcceptanceCriterionInput::Object(criterion) => Some(criterion.clone()),
    }
}

fn normalize_criterion_inputs(
    inputs: &[AcceptanceCriterionInput],
    existing: &[AcceptanceCriterion],
    version: i64,
    fallback_source: AcceptanceCriterionSource,
) -> Vec<AcceptanceCriterion> {
    normalize_acceptance_criteria(
        inputs
            .iter()
            .filter_map(|input| {
                criterion_input_to_object(input, existing, version, fallback_source)
            })
            .collect(),
        version,
        fallback_source,
    )
}

fn compact_linked_criterion_ids(ids: &[String]) -> Vec<String> {
    compact_unique_strings(ids.to_vec())
}

fn criterion_by_id(
    criteria: &[AcceptanceCriterion],
    criterion_id: &str,
) -> Option<AcceptanceCriterion> {
    criteria
        .iter()
        .find(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && criterion.criterion_id == criterion_id
        })
        .cloned()
}

fn step_traceability_error(step: &StepDraftInput) -> Option<String> {
    let mut missing = Vec::new();
    if compact_linked_criterion_ids(&step.linked_criterion_ids).is_empty() {
        missing.push("linkedCriterionIds");
    }
    if step
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        missing.push("rationale");
    }
    (!missing.is_empty()).then(|| {
        format!(
            "generated step '{}' requires {}",
            step.step_id,
            missing.join(" and ")
        )
    })
}

fn validate_generated_step_traceability(
    plan_input: &PlanDraftInput,
    project_prd: &ProjectSpec,
) -> Result<(), String> {
    let active_ids: HashSet<&str> = project_prd
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
        .map(|criterion| criterion.criterion_id.as_str())
        .collect();
    for step in &plan_input.steps {
        if let Some(err) = step_traceability_error(step) {
            return Err(err);
        }
        for criterion_id in compact_linked_criterion_ids(&step.linked_criterion_ids) {
            if !active_ids.contains(criterion_id.as_str()) {
                return Err(format!(
                    "generated step '{}' linkedCriterionIds contains unknown criterion '{}'",
                    step.step_id, criterion_id
                ));
            }
        }
    }
    Ok(())
}

fn step_criteria_payload(
    step: &StepDraftInput,
    project_prd: &ProjectSpec,
) -> Result<Value, String> {
    let linked_criterion_ids = compact_linked_criterion_ids(&step.linked_criterion_ids);
    let draft_criteria = normalize_criterion_inputs(
        &step.acceptance_criteria,
        &project_prd.acceptance_criteria,
        project_prd.current_version,
        AcceptanceCriterionSource::Migration,
    );
    let mut criteria = Vec::new();
    for criterion_id in &linked_criterion_ids {
        let criterion = criterion_by_id(&project_prd.acceptance_criteria, criterion_id)
            .or_else(|| criterion_by_id(&draft_criteria, criterion_id))
            .ok_or_else(|| {
                format!(
                    "generated step '{}' linkedCriterionIds contains unknown criterion '{}'",
                    step.step_id, criterion_id
                )
            })?;
        criteria.push(criterion);
    }
    let rationale = step
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("generated step '{}' requires rationale", step.step_id))?;
    Ok(json!({
        "criteria": criteria,
        "linkedCriterionIds": linked_criterion_ids,
        "rationale": rationale,
    }))
}

fn append_step_criteria_payload(
    step: &StepDraftInput,
    latest_prd: Option<&ProjectSpecVersionRow>,
) -> Result<Value, String> {
    let linked_criterion_ids = compact_linked_criterion_ids(&step.linked_criterion_ids);
    let rationale = step
        .rationale
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if linked_criterion_ids.is_empty() && rationale.is_none() {
        return Ok(serde_json::json!(step.acceptance_criteria));
    }

    let (existing_criteria, version) = latest_prd
        .map(|row| (row.snapshot.acceptance_criteria.as_slice(), row.version))
        .unwrap_or((&[] as &[AcceptanceCriterion], 1));
    let draft_criteria = normalize_criterion_inputs(
        &step.acceptance_criteria,
        existing_criteria,
        version,
        AcceptanceCriterionSource::Migration,
    );
    let mut criteria = Vec::new();
    if linked_criterion_ids.is_empty() {
        criteria = draft_criteria;
    } else {
        for criterion_id in &linked_criterion_ids {
            let criterion = latest_prd
                .and_then(|row| criterion_by_id(&row.snapshot.acceptance_criteria, criterion_id))
                .or_else(|| criterion_by_id(&draft_criteria, criterion_id))
                .ok_or_else(|| {
                    format!(
                        "appended step linkedCriterionIds contains unknown criterion '{}'",
                        criterion_id
                    )
                })?;
            criteria.push(criterion);
        }
    }

    let mut payload = json!({
        "criteria": criteria,
        "linkedCriterionIds": linked_criterion_ids,
    });
    if let Some(rationale) = rationale {
        if let Value::Object(map) = &mut payload {
            map.insert("rationale".into(), Value::String(rationale));
        }
    }
    Ok(payload)
}

fn plan_generated_criterion_coverage(
    project_prd: &ProjectSpec,
    step_links: &[(String, Vec<String>)],
) -> Value {
    let linked_ids = step_links
        .iter()
        .flat_map(|(_, ids)| ids.iter().cloned())
        .collect::<HashSet<_>>();
    let active_criterion_ids = project_prd
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<Vec<_>>();
    let covered_criterion_ids = active_criterion_ids
        .iter()
        .filter(|criterion_id| linked_ids.contains(*criterion_id))
        .cloned()
        .collect::<Vec<_>>();
    let uncovered_criterion_ids = active_criterion_ids
        .iter()
        .filter(|criterion_id| !linked_ids.contains(*criterion_id))
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "total_criterion_count": active_criterion_ids.len(),
        "covered_criterion_ids": covered_criterion_ids,
        "uncovered_criterion_ids": uncovered_criterion_ids,
        "step_links": step_links
            .iter()
            .map(|(stable_step_id, linked_criterion_ids)| {
                json!({
                    "stable_step_id": stable_step_id,
                    "linked_criterion_ids": linked_criterion_ids,
                })
            })
            .collect::<Vec<_>>(),
    })
}

#[derive(Debug, Clone)]
struct AppendPrdUpdate {
    project_spec_id: String,
    from_version: i64,
    to_version: i64,
    delta: ProjectSpecDelta,
    delta_summary: Value,
}

fn empty_project_spec_delta(from_version: i64, to_version: i64) -> ProjectSpecDelta {
    ProjectSpecDelta {
        from_version,
        to_version,
        added_criteria: Vec::new(),
        retired_criterion_ids: Vec::new(),
        scope_changes: Vec::new(),
        non_goal_changes: Vec::new(),
    }
}

fn normalize_plan_mutation_delta(
    provided: Option<&ProjectSpecDelta>,
    from_version: i64,
    to_version: i64,
) -> ProjectSpecDelta {
    let mut delta = provided
        .cloned()
        .unwrap_or_else(|| empty_project_spec_delta(from_version, to_version));
    delta.from_version = from_version;
    delta.to_version = to_version;
    delta.scope_changes = compact_unique_strings(delta.scope_changes);
    delta.non_goal_changes = compact_unique_strings(delta.non_goal_changes);
    delta.retired_criterion_ids = compact_unique_strings(delta.retired_criterion_ids);
    delta.added_criteria = normalize_acceptance_criteria(
        delta.added_criteria,
        to_version.max(1),
        AcceptanceCriterionSource::PlanMutation,
    );
    for criterion in &mut delta.added_criteria {
        criterion.source = AcceptanceCriterionSource::PlanMutation;
        criterion.status = AcceptanceCriterionStatus::Active;
        criterion.created_in_version = to_version.max(1);
        criterion.retired_in_version = None;
    }
    delta
}

fn persist_prd_delta_for_plan_mutation(
    conn: &rusqlite::Connection,
    project_id: i64,
    latest_prd: Option<&ProjectSpecVersionRow>,
    provided_delta: Option<&ProjectSpecDelta>,
) -> Result<AppendPrdUpdate, String> {
    let Some(latest_prd) = latest_prd else {
        let from_version = provided_delta.map(|delta| delta.from_version).unwrap_or(0);
        let to_version = provided_delta
            .map(|delta| delta.to_version)
            .unwrap_or(from_version);
        let delta = normalize_plan_mutation_delta(provided_delta, from_version, to_version);
        let delta_summary = delta_summary_for_plan_mutation(&delta);
        return Ok(AppendPrdUpdate {
            project_spec_id: format!("prd-{project_id}"),
            from_version,
            to_version,
            delta,
            delta_summary,
        });
    };

    let from_version = latest_prd.version;
    let to_version = from_version + 1;
    let delta = normalize_plan_mutation_delta(provided_delta, from_version, to_version);
    let mut next = latest_prd.snapshot.clone();
    next.current_version = to_version;
    next.updated_at = now_ms();

    for mut criterion in delta.added_criteria.clone() {
        if criterion.text.trim().is_empty() {
            continue;
        }
        if !is_valid_acceptance_criterion_id(criterion.criterion_id.trim())
            || next
                .acceptance_criteria
                .iter()
                .any(|existing| existing.criterion_id == criterion.criterion_id)
        {
            criterion.criterion_id = allocate_acceptance_criterion_id(&next.acceptance_criteria);
        }
        criterion.source = AcceptanceCriterionSource::PlanMutation;
        criterion.status = AcceptanceCriterionStatus::Active;
        criterion.created_in_version = to_version;
        criterion.retired_in_version = None;
        next.acceptance_criteria.push(criterion);
    }

    let retired_ids = delta
        .retired_criterion_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    for criterion in &mut next.acceptance_criteria {
        if retired_ids.contains(criterion.criterion_id.as_str())
            && criterion.status == AcceptanceCriterionStatus::Active
        {
            criterion.status = AcceptanceCriterionStatus::Retired;
            criterion.retired_in_version = Some(to_version);
        }
    }
    for scope_change in &delta.scope_changes {
        next.scope = append_unique_string(next.scope, scope_change);
    }
    for non_goal_change in &delta.non_goal_changes {
        next.non_goals = append_unique_string(next.non_goals, non_goal_change);
    }

    let delta_summary = delta_summary_for_plan_mutation(&delta);
    prd_dao::insert_version(
        conn,
        &NewProjectSpecVersion {
            project_spec_id: next.project_spec_id.clone(),
            project_id,
            version: to_version,
            previous_version: Some(from_version),
            snapshot: next.clone(),
            reason: "plan_mutation".into(),
            delta_summary: delta_summary.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    let added_ids = delta
        .added_criteria
        .iter()
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<Vec<_>>();
    dive_event_log::append_to_conn(
        conn,
        None,
        dive_event_log::PRD_EDITED_EVENT,
        dive_event_log::prd_edited_payload(
            project_id,
            next.project_spec_id.clone(),
            from_version,
            to_version,
            "plan_mutation",
            changed_fields_for_plan_mutation_delta(&delta),
            added_ids,
            delta.retired_criterion_ids.clone(),
        ),
    )
    .map_err(|e| e.to_string())?;
    dive_event_log::append_to_conn(
        conn,
        None,
        dive_event_log::PRD_VERSION_CREATED_EVENT,
        dive_event_log::prd_version_created_payload(
            project_id,
            next.project_spec_id.clone(),
            to_version,
            Some(from_version),
            delta_summary.clone(),
        ),
    )
    .map_err(|e| e.to_string())?;
    Ok(AppendPrdUpdate {
        project_spec_id: next.project_spec_id,
        from_version,
        to_version,
        delta,
        delta_summary,
    })
}

fn changed_fields_for_plan_mutation_delta(delta: &ProjectSpecDelta) -> Vec<String> {
    let mut fields = Vec::new();
    if !delta.scope_changes.is_empty() {
        fields.push("scope".into());
    }
    if !delta.non_goal_changes.is_empty() {
        fields.push("nonGoals".into());
    }
    if !delta.added_criteria.is_empty() || !delta.retired_criterion_ids.is_empty() {
        fields.push("acceptanceCriteria".into());
    }
    fields
}

fn delta_summary_for_plan_mutation(delta: &ProjectSpecDelta) -> Value {
    json!({
        "changedFields": changed_fields_for_plan_mutation_delta(delta),
        "criterionIdsAdded": delta
            .added_criteria
            .iter()
            .map(|criterion| criterion.criterion_id.clone())
            .collect::<Vec<_>>(),
        "criterionIdsRetired": delta.retired_criterion_ids,
        "scopeChanges": delta.scope_changes,
        "nonGoalChanges": delta.non_goal_changes,
    })
}

pub fn assess_scope_expansion_for_append(
    project_spec: &ProjectSpec,
    draft: &StepDraftInput,
    linked_criterion_ids: &[String],
    prd_delta: Option<&ProjectSpecDelta>,
) -> ScopeExpansionAssessment {
    let mut reason_codes = Vec::new();
    let mut evidence_refs = Vec::new();
    if compact_linked_criterion_ids(linked_criterion_ids).is_empty() {
        push_unique(&mut reason_codes, "missing_criterion_link".into());
        push_unique(&mut evidence_refs, "step.linkedCriterionIds".into());
    }

    if let Some(delta) = prd_delta {
        for (index, scope_change) in delta.scope_changes.iter().enumerate() {
            if !scope_change_is_covered_by_prd(scope_change, project_spec) {
                push_unique(&mut reason_codes, "new_scope_area".into());
                push_unique(
                    &mut evidence_refs,
                    format!("prdDelta.scopeChanges[{index}]"),
                );
            }
        }
    }

    for (index, expected_file) in draft.expected_files.iter().enumerate() {
        if target_file_matches_non_goal(expected_file, project_spec) {
            push_unique(&mut reason_codes, "target_outside_scope".into());
            push_unique(&mut evidence_refs, format!("step.expectedFiles[{index}]"));
        }
    }

    ScopeExpansionAssessment {
        expanded: !reason_codes.is_empty(),
        reason_codes,
        evidence_refs,
    }
}

fn scope_change_is_covered_by_prd(scope_change: &str, project_spec: &ProjectSpec) -> bool {
    let change = normalized_scope_text(scope_change);
    if change.is_empty() {
        return true;
    }
    project_spec
        .scope
        .iter()
        .any(|item| scope_texts_overlap(&change, item))
        || project_spec
            .acceptance_criteria
            .iter()
            .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
            .any(|criterion| scope_texts_overlap(&change, &criterion.text))
}

fn target_file_matches_non_goal(expected_file: &str, project_spec: &ProjectSpec) -> bool {
    let target = normalized_scope_text(expected_file);
    if target.is_empty() {
        return false;
    }
    project_spec
        .non_goals
        .iter()
        .any(|non_goal| scope_texts_overlap(&target, non_goal))
}

fn scope_texts_overlap(normalized_left: &str, right: &str) -> bool {
    let right = normalized_scope_text(right);
    if normalized_left.is_empty() || right.is_empty() {
        return false;
    }
    normalized_left.contains(&right) || right.contains(normalized_left)
}

fn normalized_scope_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_minimal_project_spec(spec: &ProjectSpec) -> bool {
    !spec.goal.trim().is_empty()
        && spec.acceptance_criteria.iter().any(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && !criterion.text.trim().is_empty()
        })
}

fn is_confirmable_project_spec(spec: &ProjectSpec) -> bool {
    is_minimal_project_spec(spec)
}

fn is_minimal_project_spec_draft(spec: &ProjectSpecDraft) -> bool {
    !spec.goal.trim().is_empty()
        && spec.acceptance_criteria.iter().any(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && !criterion.text.trim().is_empty()
        })
}

fn is_confirmable_project_spec_draft(spec: &ProjectSpecDraft) -> bool {
    is_minimal_project_spec_draft(spec)
}

fn allocate_acceptance_criterion_id(criteria: &[AcceptanceCriterion]) -> String {
    let mut max = 0_i64;
    for criterion in criteria {
        if let Some(raw) = criterion.criterion_id.strip_prefix("AC-") {
            if let Ok(value) = raw.parse::<i64>() {
                if value > 0 {
                    max = max.max(value);
                }
            }
        }
    }
    format!("AC-{:03}", max + 1)
}

fn is_valid_acceptance_criterion_id(criterion_id: &str) -> bool {
    criterion_id
        .strip_prefix("AC-")
        .and_then(|raw| raw.parse::<i64>().ok())
        .map(|value| value > 0)
        .unwrap_or(false)
}

fn changed_project_spec_fields(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Vec<String> {
    let Some(previous) = previous else {
        return vec![
            "goal".into(),
            "intentSummary".into(),
            "scope".into(),
            "nonGoals".into(),
            "constraints".into(),
            "acceptanceCriteria".into(),
        ];
    };
    let mut fields = Vec::new();
    if previous.goal != next.goal {
        fields.push("goal".into());
    }
    if previous.intent_summary != next.intent_summary {
        fields.push("intentSummary".into());
    }
    if previous.scope != next.scope {
        fields.push("scope".into());
    }
    if previous.non_goals != next.non_goals {
        fields.push("nonGoals".into());
    }
    if previous.constraints != next.constraints {
        fields.push("constraints".into());
    }
    if previous.acceptance_criteria != next.acceptance_criteria {
        fields.push("acceptanceCriteria".into());
    }
    fields
}

fn added_criterion_ids(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Vec<String> {
    let previous_ids = previous
        .map(|spec| {
            spec.acceptance_criteria
                .iter()
                .map(|criterion| criterion.criterion_id.as_str())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    next.acceptance_criteria
        .iter()
        .filter(|criterion| !previous_ids.contains(criterion.criterion_id.as_str()))
        .map(|criterion| criterion.criterion_id.clone())
        .collect()
}

fn retired_criterion_ids(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Vec<String> {
    let next_retired = next
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Retired)
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<HashSet<_>>();
    let Some(previous) = previous else {
        return next_retired.into_iter().collect();
    };
    previous
        .acceptance_criteria
        .iter()
        .filter(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && next_retired.contains(&criterion.criterion_id)
        })
        .map(|criterion| criterion.criterion_id.clone())
        .collect()
}

fn prd_delta_summary(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Value {
    json!({
        "changedFields": changed_project_spec_fields(previous, next),
        "criterionIdsAdded": added_criterion_ids(previous, next),
        "criterionIdsRetired": retired_criterion_ids(previous, next),
        "goalChanged": previous.map(|spec| spec.goal.as_str()) != Some(next.goal.as_str()),
    })
}

fn summarize_prd(spec: &ProjectSpec) -> String {
    format!(
        "{} criterion(s), {} scope item(s)",
        spec.acceptance_criteria
            .iter()
            .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
            .count(),
        spec.scope.len()
    )
}

fn load_or_create_prd_draft(
    conn: &rusqlite::Connection,
    project_id: i64,
    draft_id: &str,
) -> Result<LiveProjectSpecDraftRow, String> {
    if let Some(row) = prd_dao::get_draft(conn, project_id).map_err(|e| e.to_string())? {
        return Ok(row);
    }
    let latest = prd_dao::latest_version(conn, project_id).map_err(|e| e.to_string())?;
    let now = now_ms();
    let spec = latest
        .as_ref()
        .map(|row| ProjectSpecDraft {
            project_spec_id: Some(row.snapshot.project_spec_id.clone()),
            project_id,
            current_version: Some(row.version),
            goal: row.snapshot.goal.clone(),
            intent_summary: row.snapshot.intent_summary.clone(),
            scope: row.snapshot.scope.clone(),
            non_goals: row.snapshot.non_goals.clone(),
            constraints: row.snapshot.constraints.clone(),
            acceptance_criteria: row.snapshot.acceptance_criteria.clone(),
            status: row.snapshot.status,
        })
        .unwrap_or_else(|| ProjectSpecDraft {
            project_spec_id: Some(format!("prd-{project_id}")),
            project_id,
            current_version: None,
            goal: String::new(),
            intent_summary: None,
            scope: Vec::new(),
            non_goals: Vec::new(),
            constraints: Vec::new(),
            acceptance_criteria: Vec::new(),
            status: ProjectSpecStatus::Draft,
        });
    Ok(LiveProjectSpecDraftRow {
        draft_id: if draft_id.trim().is_empty() {
            format!("prd-draft-{project_id}")
        } else {
            draft_id.trim().to_string()
        },
        project_id,
        base_version: latest.map(|row| row.version),
        spec,
        dirty_fields: Vec::new(),
        student_edited_fields: Vec::new(),
        last_patch_id: None,
        updated_at: now,
    })
}

fn persist_live_prd_draft(
    conn: &rusqlite::Connection,
    draft: &LiveProjectSpecDraftRow,
) -> Result<(), String> {
    prd_dao::upsert_draft(
        conn,
        &NewLiveProjectSpecDraft {
            draft_id: draft.draft_id.clone(),
            project_id: draft.project_id,
            base_version: draft.base_version,
            spec: draft.spec.clone(),
            dirty_fields: draft.dirty_fields.clone(),
            student_edited_fields: draft.student_edited_fields.clone(),
            last_patch_id: draft.last_patch_id.clone(),
        },
    )
    .map_err(|e| e.to_string())
}

fn project_spec_id_for_draft(draft: &LiveProjectSpecDraftRow) -> String {
    draft
        .spec
        .project_spec_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("prd-{}", draft.project_id))
}

async fn run_prd_interview_turn(
    provider: &dyn crate::providers::LlmProvider,
    model: String,
    draft: &LiveProjectSpecDraftRow,
    conversation: &[PrdInterviewConversationTurnInput],
    answer: &str,
) -> Result<String, String> {
    let req = ChatRequest {
        model,
        messages: vec![
            Message::System {
                content: build_prd_interview_system_prompt(),
            },
            Message::User {
                content: build_prd_interview_user_prompt(draft, conversation, answer),
            },
        ],
        tools: None,
        tool_choice: Some(ToolChoice::None),
        temperature: Some(0.2),
        max_tokens: Some(900),
        stream: true,
    };
    let mut stream = with_retry(
        || {
            let req = req.clone();
            provider.chat(req)
        },
        2,
        Duration::from_millis(350),
    )
    .await
    .map_err(|e| e.to_string())?;
    let mut text = String::new();
    let mut finish_reason = FinishReason::Stop;
    while let Some(event) = stream.next().await {
        match event {
            ChatEvent::TextDelta(delta) => text.push_str(&delta),
            ChatEvent::Done {
                finish_reason: done,
            } => {
                finish_reason = done;
                break;
            }
            ChatEvent::Error(err) => return Err(err),
            ChatEvent::ReasoningDelta(_)
            | ChatEvent::ToolCallStart { .. }
            | ChatEvent::ToolCallDelta { .. }
            | ChatEvent::ToolCallEnd { .. }
            | ChatEvent::Usage { .. } => {}
        }
    }
    if finish_reason == FinishReason::Error {
        return Err("PRD interview provider finished with an error".into());
    }
    Ok(text)
}

fn build_prd_interview_system_prompt() -> String {
    [
        "You are helping a novice author a real project PRD inside DIVE through a relaxed conversation.",
        "Assume the student has never written a PRD and does not know what PRD fields mean.",
        "You own the interview flow: gently lead the student from vague idea to a complete-enough PRD.",
        "Do not run a fixed checklist, quiz, or wizard. Do not ask the student to fill PRD fields.",
        "Use the same language as the student's answer unless the draft clearly uses another language.",
        "On every turn, infer useful PRD details from casual wording and update the draft with a patch when evidence is present.",
        "If something important is missing, ask at most one concrete follow-up question in ordinary product language.",
        "Do not ask jargon questions like 'what are the acceptance criteria?' or 'what is the scope?'. Ask about visible outcomes, first version, users, constraints, or what can wait.",
        "assistantMessage should briefly reflect what you captured, explain the next useful angle, then continue warmly.",
        "Prefer concrete user outcomes and observable done states over PRD jargon.",
        "A PRD is complete enough when it has a goal and at least one observable done state. Capture intended user/use context, first-version scope, constraints, or exclusions when they surface, but do not make them prerequisites.",
        "When the draft is complete enough, stop asking required questions; tell the student it is ready to confirm.",
        "Return a short conversational assistantMessage and an optional JSON patch.",
        "The patch may only use these operation names: set_goal, set_intent_summary, append_scope, append_non_goal, append_constraint, append_acceptance_criterion, revise_acceptance_criterion_text.",
        "Each patch operation object MUST use the key \"op\" for the operation name; do not use \"operation\".",
        "For append_acceptance_criterion and revise_acceptance_criterion_text, put the criterion wording in \"text\".",
        "Do not invent IDs for new criteria; DIVE assigns AC IDs.",
        "Use concise JSON with shape {\"assistantMessage\":\"...\",\"patch\":{\"operations\":[...],\"rationale\":\"...\"}}.",
    ]
    .join("\n")
}

fn build_prd_interview_user_prompt(
    draft: &LiveProjectSpecDraftRow,
    conversation: &[PrdInterviewConversationTurnInput],
    answer: &str,
) -> String {
    let draft_json = serde_json::to_string(&draft.spec).unwrap_or_else(|_| "{}".into());
    let missing_confirmable = missing_confirmable_prd_fields(&draft.spec).join(", ");
    let next_focus = prd_interview_next_focus(&draft.spec);
    let conversation = format_prd_interview_conversation(conversation);
    format!(
        "Current live PRD draft JSON:\n{draft_json}\n\nMissing fields required before PRD confirmation, if any: {missing_confirmable}\n\nSuggested next interview focus: {next_focus}\n\nRecent interview conversation, oldest to newest:\n{conversation}\n\nLatest student answer:\n{answer}\n\nReturn the conversational response plus optional PrdPatch JSON. Use the recent conversation as evidence when the live draft has not caught up yet. Do not repeat a question that the student has already answered in the conversation. If the answer is vague, still capture any likely goal, user, first-version boundary, constraint, or observable done state that is grounded in the answer. If the suggested focus is ready_to_save, say the PRD has enough information to confirm and point the student to the PRD confirmation action instead of asking a new required question, offering another wording pass, or asking whether to save."
    )
}

fn format_prd_interview_conversation(conversation: &[PrdInterviewConversationTurnInput]) -> String {
    let turns = conversation
        .iter()
        .filter_map(|turn| {
            let text = turn.text.trim();
            if text.is_empty() {
                return None;
            }
            let role = match turn.role.as_str() {
                "assistant" => "Assistant",
                "student" => "Student",
                _ => return None,
            };
            Some(format!("{role}: {text}"))
        })
        .rev()
        .take(12)
        .collect::<Vec<_>>();
    if turns.is_empty() {
        return "None yet.".into();
    }
    turns.into_iter().rev().collect::<Vec<_>>().join("\n")
}

fn missing_confirmable_prd_fields(spec: &ProjectSpecDraft) -> Vec<&'static str> {
    let mut fields = Vec::new();
    if spec.goal.trim().is_empty() {
        fields.push("goal");
    }
    if spec
        .acceptance_criteria
        .iter()
        .all(|criterion| criterion.text.trim().is_empty())
    {
        fields.push("observable done state");
    }
    if fields.is_empty() {
        fields.push("none");
    }
    fields
}

fn prd_interview_next_focus(spec: &ProjectSpecDraft) -> &'static str {
    if spec.goal.trim().is_empty() {
        return "clarify_goal_in_plain_language: ask who needs this, in what situation, and what problem it should solve";
    }
    if spec
        .acceptance_criteria
        .iter()
        .all(|criterion| criterion.text.trim().is_empty())
    {
        return "capture_observable_done_state: ask what the student would see when the project is working";
    }
    if !is_confirmable_project_spec_draft(spec) {
        return "tighten_confirmation_fields: ask one short question about the missing confirmation field";
    }
    "ready_to_save: the draft is complete enough; point to the PRD confirmation action"
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdTurnResponse {
    assistant_message: Option<String>,
    patch: Option<RawPrdPatch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdPatch {
    operations: Vec<RawPrdPatchOperation>,
    rationale: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrdPatchOperation {
    #[serde(alias = "operation")]
    op: String,
    value: Option<String>,
    text: Option<String>,
    #[serde(alias = "criterion_id")]
    criterion_id: Option<String>,
}

impl RawPrdPatchOperation {
    fn into_prd_operation(self) -> PrdPatchOperation {
        let RawPrdPatchOperation {
            op,
            value,
            text,
            criterion_id,
        } = self;
        let value = match op.as_str() {
            "set_goal" | "set_intent_summary" | "append_scope" | "append_non_goal"
            | "append_constraint" => value.or_else(|| text.clone()),
            _ => value,
        };
        let text = match op.as_str() {
            "append_acceptance_criterion" | "revise_acceptance_criterion_text" => {
                text.or_else(|| value.clone())
            }
            _ => text,
        };
        PrdPatchOperation {
            op,
            value,
            text,
            criterion_id,
        }
    }
}

impl RawPrdPatch {
    fn into_prd_patch(self, turn_id: &str) -> PrdPatch {
        PrdPatch {
            patch_id: format!("prd-patch-{}", now_ms()),
            operations: self
                .operations
                .into_iter()
                .map(RawPrdPatchOperation::into_prd_operation)
                .collect(),
            rationale: self.rationale,
            source_turn_id: turn_id.to_string(),
        }
    }
}

fn parse_prd_turn_response(raw: &str, turn_id: &str) -> ParsedPrdTurn {
    let Some(json_text) = extract_prd_turn_json_candidate(raw) else {
        return ParsedPrdTurn {
            assistant_message: clean_prd_assistant_message(raw),
            patch: None,
        };
    };
    if let Ok(response) = serde_json::from_str::<RawPrdTurnResponse>(json_text) {
        return ParsedPrdTurn {
            assistant_message: response.assistant_message.and_then(|message| {
                clean_prd_assistant_message(&strip_prd_json_payloads(&message))
            }),
            patch: response.patch.map(|patch| patch.into_prd_patch(turn_id)),
        };
    }
    if let Ok(patch) = serde_json::from_str::<RawPrdPatch>(json_text) {
        return ParsedPrdTurn {
            assistant_message: clean_prd_assistant_message(&raw.replace(json_text, "")),
            patch: Some(patch.into_prd_patch(turn_id)),
        };
    }
    ParsedPrdTurn {
        assistant_message: clean_prd_assistant_message(&strip_prd_json_payloads(raw)),
        patch: None,
    }
}

struct ParsedPrdTurn {
    assistant_message: Option<String>,
    patch: Option<PrdPatch>,
}

fn extract_prd_turn_json_candidate(raw: &str) -> Option<&str> {
    let spans = json_object_spans(raw);
    for (start, end) in spans.iter().copied() {
        let candidate = &raw[start..end];
        if serde_json::from_str::<RawPrdTurnResponse>(candidate).is_ok()
            || serde_json::from_str::<RawPrdPatch>(candidate).is_ok()
        {
            return Some(candidate);
        }
    }
    spans
        .iter()
        .copied()
        .find(|(start, end)| raw[*start..*end].contains("\"operations\""))
        .map(|(start, end)| &raw[start..end])
}

fn json_object_spans(raw: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut depth = 0usize;
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in raw.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(start_index) = start.take() {
                        spans.push((start_index, index + ch.len_utf8()));
                    }
                }
            }
            _ => {}
        }
    }

    spans
}

fn strip_prd_json_payloads(raw: &str) -> String {
    let spans = json_object_spans(raw);
    if spans.is_empty() {
        return raw.to_string();
    }
    let mut cleaned = String::with_capacity(raw.len());
    let mut cursor = 0;
    for (start, end) in spans {
        if start > cursor {
            cleaned.push_str(&raw[cursor..start]);
        }
        cursor = end;
    }
    if cursor < raw.len() {
        cleaned.push_str(&raw[cursor..]);
    }
    cleaned
}

fn clean_prd_assistant_message(raw: &str) -> Option<String> {
    let without_fences = raw
        .replace("```json", "")
        .replace("```JSON", "")
        .replace("```", "");
    let before_patch = without_fences
        .find("\"patch\"")
        .map(|index| &without_fences[..index])
        .unwrap_or(without_fences.as_str());
    let cleaned = before_patch
        .trim()
        .trim_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '"' | ',' | ':' | '{' | '}' | '[' | ']' | '`')
        })
        .trim();
    if cleaned.is_empty()
        || cleaned.contains("\"operations\"")
        || cleaned.contains("\"operation\"")
        || cleaned.contains("\"assistantMessage\"")
    {
        None
    } else {
        Some(cleaned.to_string())
    }
}

struct PrdPatchApplyResult {
    draft: LiveProjectSpecDraftRow,
    validation_outcome: String,
    applied_field_paths: Vec<String>,
    rejected_reasons: Vec<String>,
    criterion_ids_assigned: Vec<String>,
    student_edited_fields_respected: Vec<String>,
}

fn apply_prd_patch_to_draft(
    draft: LiveProjectSpecDraftRow,
    patch: &PrdPatch,
) -> PrdPatchApplyResult {
    let validation_errors = validate_prd_patch_for_draft(patch, &draft);
    if !validation_errors.is_empty() {
        return PrdPatchApplyResult {
            draft,
            validation_outcome: "rejected".into(),
            applied_field_paths: Vec::new(),
            rejected_reasons: validation_errors,
            criterion_ids_assigned: Vec::new(),
            student_edited_fields_respected: Vec::new(),
        };
    }

    let mut next = draft;
    next.spec.scope = compact_unique_strings(next.spec.scope);
    next.spec.non_goals = compact_unique_strings(next.spec.non_goals);
    next.spec.constraints = compact_unique_strings(next.spec.constraints);
    next.last_patch_id = Some(patch.patch_id.clone());
    next.updated_at = now_ms();
    let mut applied_field_paths = Vec::new();
    let mut held_field_paths = Vec::new();
    let mut criterion_ids_assigned = Vec::new();
    let mut student_edited_fields_respected = Vec::new();

    for operation in &patch.operations {
        let field_path = field_path_for_prd_operation(operation);
        if let Some(conflict) =
            conflicts_with_student_edit(&field_path, &next.student_edited_fields)
        {
            push_unique(&mut held_field_paths, field_path_root(&field_path));
            push_unique(&mut student_edited_fields_respected, conflict);
            continue;
        }

        match operation.op.as_str() {
            "set_goal" => {
                next.spec.goal = prd_operation_text(operation)
                    .unwrap_or_default()
                    .to_string();
                push_unique(&mut applied_field_paths, "goal".into());
            }
            "set_intent_summary" => {
                next.spec.intent_summary = prd_operation_text(operation).map(str::to_string);
                push_unique(&mut applied_field_paths, "intentSummary".into());
            }
            "append_scope" => {
                if let Some(value) = prd_operation_text(operation) {
                    next.spec.scope = append_unique_string(next.spec.scope, value);
                    push_unique(&mut applied_field_paths, "scope".into());
                }
            }
            "append_non_goal" => {
                if let Some(value) = prd_operation_text(operation) {
                    next.spec.non_goals = append_unique_string(next.spec.non_goals, value);
                    push_unique(&mut applied_field_paths, "nonGoals".into());
                }
            }
            "append_constraint" => {
                if let Some(value) = prd_operation_text(operation) {
                    next.spec.constraints = append_unique_string(next.spec.constraints, value);
                    push_unique(&mut applied_field_paths, "constraints".into());
                }
            }
            "append_acceptance_criterion" => {
                if let Some(text) = prd_operation_text(operation) {
                    let criterion_id =
                        allocate_acceptance_criterion_id(&next.spec.acceptance_criteria);
                    next.spec.acceptance_criteria.push(AcceptanceCriterion {
                        criterion_id: criterion_id.clone(),
                        text: text.to_string(),
                        source: AcceptanceCriterionSource::Interview,
                        status: AcceptanceCriterionStatus::Active,
                        created_in_version: next.spec.current_version.unwrap_or(1),
                        retired_in_version: None,
                    });
                    push_unique(&mut criterion_ids_assigned, criterion_id);
                    push_unique(&mut applied_field_paths, "acceptanceCriteria".into());
                }
            }
            "revise_acceptance_criterion_text" => {
                if let (Some(criterion_id), Some(text)) = (
                    operation.criterion_id.as_ref(),
                    prd_operation_text(operation),
                ) {
                    for criterion in &mut next.spec.acceptance_criteria {
                        if criterion.criterion_id == *criterion_id {
                            criterion.text = text.to_string();
                        }
                    }
                    push_unique(
                        &mut applied_field_paths,
                        format!("acceptanceCriteria.{criterion_id}.text"),
                    );
                }
            }
            _ => {}
        }
    }

    for field in &applied_field_paths {
        push_unique(&mut next.dirty_fields, field_path_root(field));
    }

    let validation_outcome = if !held_field_paths.is_empty() {
        "held_for_student"
    } else if !applied_field_paths.is_empty() {
        "applied"
    } else {
        "none"
    }
    .to_string();
    let rejected_reasons = if validation_outcome == "held_for_student" {
        vec!["student_edit_conflict".into()]
    } else {
        Vec::new()
    };

    PrdPatchApplyResult {
        draft: next,
        validation_outcome,
        applied_field_paths,
        rejected_reasons,
        criterion_ids_assigned,
        student_edited_fields_respected,
    }
}

fn validate_prd_patch_for_draft(patch: &PrdPatch, draft: &LiveProjectSpecDraftRow) -> Vec<String> {
    let mut reasons = Vec::new();
    if patch.operations.len() > MAX_PRD_PATCH_OPERATIONS {
        push_unique(&mut reasons, "too_many_operations".into());
    }
    for operation in &patch.operations {
        if !is_supported_prd_operation(operation.op.as_str()) {
            push_unique(&mut reasons, "unsupported_operation".into());
            continue;
        }
        let text = prd_operation_text(operation);
        if text
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            push_unique(&mut reasons, "missing_text".into());
            continue;
        }
        let text = text.unwrap();
        if text.chars().count() > MAX_PRD_PATCH_TEXT_CHARS {
            push_unique(&mut reasons, "text_too_large".into());
        }
        if looks_secret_like(text) {
            push_unique(&mut reasons, "secret_like_text".into());
        }
        if operation.op == "revise_acceptance_criterion_text" {
            let Some(criterion_id) = operation.criterion_id.as_ref() else {
                push_unique(&mut reasons, "criterion_not_found".into());
                continue;
            };
            if !draft
                .spec
                .acceptance_criteria
                .iter()
                .any(|criterion| criterion.criterion_id == *criterion_id)
            {
                push_unique(&mut reasons, "criterion_not_found".into());
            }
        }
    }
    reasons
}

fn is_supported_prd_operation(op: &str) -> bool {
    matches!(
        op,
        "set_goal"
            | "set_intent_summary"
            | "append_scope"
            | "append_non_goal"
            | "append_constraint"
            | "append_acceptance_criterion"
            | "revise_acceptance_criterion_text"
    )
}

fn prd_operation_text(operation: &PrdPatchOperation) -> Option<&str> {
    operation
        .value
        .as_deref()
        .or(operation.text.as_deref())
        .map(str::trim)
}

fn field_path_for_prd_operation(operation: &PrdPatchOperation) -> String {
    match operation.op.as_str() {
        "set_goal" => "goal".into(),
        "set_intent_summary" => "intentSummary".into(),
        "append_scope" => "scope".into(),
        "append_non_goal" => "nonGoals".into(),
        "append_constraint" => "constraints".into(),
        "append_acceptance_criterion" => "acceptanceCriteria".into(),
        "revise_acceptance_criterion_text" => operation
            .criterion_id
            .as_ref()
            .map(|id| format!("acceptanceCriteria.{id}.text"))
            .unwrap_or_else(|| "acceptanceCriteria".into()),
        _ => "unknown".into(),
    }
}

fn field_path_root(path: &str) -> String {
    path.split('.').next().unwrap_or(path).to_string()
}

fn conflicts_with_student_edit(
    field_path: &str,
    student_edited_fields: &[String],
) -> Option<String> {
    let root = field_path_root(field_path);
    student_edited_fields
        .iter()
        .find(|field| field.as_str() == field_path || field.as_str() == root)
        .cloned()
}

fn append_unique_string(mut values: Vec<String>, value: &str) -> Vec<String> {
    let value = value.trim();
    if !value.is_empty() && !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
    values
}

fn looks_secret_like(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("sk-")
        || lower.contains("api_key")
        || lower.contains("api-key")
        || lower.contains("token =")
        || lower.contains("token:")
        || lower.contains("secret =")
        || lower.contains("secret:")
        || lower.contains("bearer ")
}

fn push_unique(items: &mut Vec<String>, value: String) {
    if !items.contains(&value) {
        items.push(value);
    }
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
    let project_prd = prd_dao::latest_version(conn, interview.project_id)
        .map_err(|e| e.to_string())?
        .map(|row| row.snapshot);
    if !project_prd
        .as_ref()
        .map(is_minimal_project_spec)
        .unwrap_or(false)
    {
        return Err("minimal PRD is required before generating a plan draft".into());
    }
    let project_prd = project_prd.expect("minimal PRD checked above");
    validate_generated_step_traceability(&plan_input, &project_prd)?;
    let plan_acceptance_criteria = normalize_criterion_inputs(
        &plan_input.acceptance_criteria,
        &project_prd.acceptance_criteria,
        project_prd.current_version,
        AcceptanceCriterionSource::Migration,
    );
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
            acceptance_criteria: Some(serde_json::json!(plan_acceptance_criteria)),
            status: "draft".into(),
        },
    )
    .map_err(|e| e.to_string())?;

    let step_count = plan_input.steps.len();
    let mut step_criterion_links: Vec<(String, Vec<String>)> = Vec::new();
    for step in plan_input.steps {
        let acceptance_criteria = step_criteria_payload(&step, &project_prd)?;
        step_criterion_links.push((
            step.step_id.clone(),
            json_linked_criterion_ids(Some(&acceptance_criteria)),
        ));
        step_dao::insert(
            &tx,
            &NewStep {
                plan_id,
                step_id: step.step_id,
                title: step.title,
                summary: Some(step.summary),
                instruction_seed: Some(step.instruction_seed),
                expected_files: Some(serde_json::json!(step.expected_files)),
                acceptance_criteria: Some(acceptance_criteria),
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
    let criterion_coverage = plan_generated_criterion_coverage(&project_prd, &step_criterion_links);
    dive_event_log::append_to_conn(
        &tx,
        None,
        dive_event_log::PLAN_GENERATED_EVENT,
        dive_event_log::plan_generated_payload(
            interview.project_id,
            plan_id,
            project_prd.project_spec_id.clone(),
            project_prd.current_version,
            step_count,
            criterion_coverage,
            "interview",
        ),
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let plan = plan_dao::get_by_id(conn, plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "plan not found after draft generation".to_string())?;
    let steps = step_dao::list_by_plan(conn, plan_id).map_err(|e| e.to_string())?;
    Ok((plan, steps))
}

pub fn workspace_plan_current_draft_impl(
    state: &AppState,
    project_id: i64,
) -> Result<Option<(PlanRow, Vec<StepRow>)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let Some(plan) = plan_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if plan.status != "draft" {
        return Ok(None);
    }
    let steps = step_dao::list_by_plan(db.conn(), plan.id).map_err(|e| e.to_string())?;
    Ok(Some((plan, steps)))
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

    let decision = match plan_router::decide_cancelable(
        runtime.provider.as_ref(),
        runtime.model,
        prompt,
        ctx,
        cancel,
    )
    .await
    {
        Ok(decision) => decision,
        Err(err) if err == ROUTE_CANCELLED_MESSAGE => return Err(err),
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "workspace plan route failed open to normal chat"
            );
            return Ok(RouteDecision::Skip {
                reason: "router unavailable; continuing as normal chat".into(),
            });
        }
    };
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
        PlanRouterDecision::Clarify {
            question,
            candidate_intent,
            suggested_criterion_ids,
            reason,
        } => Ok(RouteDecision::Clarify {
            question,
            candidate_intent,
            suggested_criterion_ids,
            reason,
        }),
        PlanRouterDecision::Remove {
            target_step_id,
            reason,
        } => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            match resolve_active_step_ref(db.conn(), plan_id, &target_step_id)? {
                Some(target) => Ok(RouteDecision::RemoveStep { target, reason }),
                None => Ok(RouteDecision::Skip {
                    reason: format!("router referenced unknown active step {target_step_id}"),
                }),
            }
        }
        PlanRouterDecision::Supersede {
            target_step_id,
            replacement,
            reason,
        } => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let Some(target) = resolve_active_step_ref(db.conn(), plan_id, &target_step_id)? else {
                return Ok(RouteDecision::Skip {
                    reason: format!("router referenced unknown active step {target_step_id}"),
                });
            };
            let replacement = step_draft_input_from_router(db.conn(), plan_id, *replacement)?;
            Ok(RouteDecision::SupersedeStep {
                target,
                replacement: Box::new(replacement),
                reason,
            })
        }
    }
}

/// S-033: resolve a router-emitted `target_step_id` to a stable step reference,
/// but only when it names an existing **active** step in the plan. Returns
/// `None` for unknown or already-removed/superseded steps so the router can
/// never fabricate a mutation against a non-existent target.
fn resolve_active_step_ref(
    conn: &rusqlite::Connection,
    plan_id: i64,
    step_id: &str,
) -> Result<Option<StepRefPayload>, String> {
    let Some(row) =
        step_dao::get_by_plan_and_step_id(conn, plan_id, step_id).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if row.status != "active" {
        return Ok(None);
    }
    Ok(Some(StepRefPayload {
        step_id: row.step_id,
        db_id: row.id,
        title: row.title,
    }))
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
    draft: StepDraftInput,
) -> Result<StepRow, String> {
    workspace_plan_append_step_with_options_impl(
        state,
        plan_id,
        draft,
        AppendStepOptions::default(),
    )
}

pub fn workspace_plan_append_step_with_options_impl(
    state: &AppState,
    plan_id: i64,
    mut draft: StepDraftInput,
    options: AppendStepOptions,
) -> Result<StepRow, String> {
    let option_linked_criterion_ids = compact_linked_criterion_ids(&options.linked_criterion_ids);
    if !option_linked_criterion_ids.is_empty() {
        draft.linked_criterion_ids = option_linked_criterion_ids;
    } else {
        draft.linked_criterion_ids = compact_linked_criterion_ids(&draft.linked_criterion_ids);
    }
    let mutation_reason = options
        .mutation_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
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
    let latest_prd = prd_dao::latest_version(&tx, plan.project_id).map_err(|e| e.to_string())?;
    let scope_expansion = latest_prd
        .as_ref()
        .map(|row| {
            assess_scope_expansion_for_append(
                &row.snapshot,
                &draft,
                &draft.linked_criterion_ids,
                options.prd_delta.as_ref(),
            )
        })
        .unwrap_or_else(|| ScopeExpansionAssessment {
            expanded: false,
            reason_codes: Vec::new(),
            evidence_refs: Vec::new(),
        });
    let step_id = step_dao::next_step_id(&tx, plan_id).map_err(|e| e.to_string())?;
    let position = step_dao::next_position(&tx, plan_id).map_err(|e| e.to_string())?;
    let acceptance_criteria = append_step_criteria_payload(&draft, latest_prd.as_ref())?;
    let inserted_id = step_dao::insert(
        &tx,
        &NewStep {
            plan_id,
            step_id,
            title: draft.title.clone(),
            summary: Some(draft.summary.clone()),
            instruction_seed: Some(draft.instruction_seed.clone()),
            expected_files: Some(serde_json::json!(draft.expected_files.clone())),
            acceptance_criteria: Some(acceptance_criteria),
            verification_kind: draft.verification_type.clone(),
            verification_command: draft.verification_command.clone(),
            verification_manual_check: None,
            dependencies: Some(serde_json::json!(draft.dependencies.clone())),
            parallel_group: draft.parallel_group.map(|group| group.to_string()),
            position,
        },
    )
    .map_err(|e| e.to_string())?;
    step_dao::validate_dependencies(&tx, plan_id).map_err(|e| e.to_string())?;
    let row = step_dao::get_by_id(&tx, inserted_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "step not found after insert".to_string())?;
    let prd_update = persist_prd_delta_for_plan_mutation(
        &tx,
        plan.project_id,
        latest_prd.as_ref(),
        options.prd_delta.as_ref(),
    )?;
    let mutation_id = format!("mut-{}-{}", row.step_id, now_ms());
    plan_mutation_dao::insert_mutation(
        &tx,
        &NewPlanMutation {
            mutation_id: mutation_id.clone(),
            project_id: plan.project_id,
            plan_id: plan.id,
            r#type: PlanMutationType::AddStep,
            step_db_id: Some(row.id),
            stable_step_id: Some(row.step_id.clone()),
            reason: mutation_reason.clone(),
            criterion_ids: draft.linked_criterion_ids.clone(),
            prd_delta: prd_update.delta.clone(),
            scope_expansion: scope_expansion.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    let mut payload = dive_event_log::plan_step_appended_payload(
        mutation_id,
        prd_update.project_spec_id,
        prd_update.from_version,
        prd_update.to_version,
        draft.linked_criterion_ids.clone(),
        serde_json::to_value(&scope_expansion).unwrap_or_else(|_| json!({})),
        prd_update.delta_summary,
    );
    if let Value::Object(map) = &mut payload {
        map.insert("project_id".into(), json!(plan.project_id));
        map.insert("plan_id".into(), json!(plan.id));
        map.insert("step_id".into(), json!(row.id));
        map.insert("stable_step_id".into(), json!(row.step_id.clone()));
        map.insert("step_title".into(), json!(row.title.clone()));
        map.insert("message".into(), json!("Step appended to plan"));
        map.insert("reason".into(), json!(mutation_reason));
    }
    dive_event_log::append_to_conn(&tx, None, dive_event_log::PLAN_STEP_APPENDED_EVENT, payload)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let project_root = state.project_root_required()?;
    workspace_plan_service::artifacts::export_plan_artifacts(conn, plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(row)
}

const RATIONALE_OFFER_KIND: &str = "redecompose_step";
const RATIONALE_OFFER_MESSAGE: &str =
    "계획 영역에서 이 단계를 다시 나누는 제안을 검토할 수 있어요.";

fn rationale_offer_id(objection_id: &str) -> String {
    format!("offer:{objection_id}")
}

fn rationale_offer_seed(step_title: &str, objection_text: &str) -> String {
    format!("'{step_title}' 단계 재분해 검토: {}", objection_text.trim())
}

pub fn workspace_plan_challenge_step_rationale_impl(
    state: &AppState,
    input: StepRationaleChallengeInput,
) -> Result<StepRationaleChallengeOutput, String> {
    let text = input.text.trim().to_string();
    if text.is_empty() {
        return Err("objection text is required".into());
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_id(&tx, input.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", input.plan_id))?;
    let step = step_dao::get_by_id(&tx, input.step_db_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {} not found", input.step_db_id))?;
    if step.plan_id != plan.id {
        return Err(format!(
            "step {} does not belong to plan {}",
            step.id, plan.id
        ));
    }
    let linked_criterion_ids = {
        let provided = compact_linked_criterion_ids(&input.linked_criterion_ids);
        if provided.is_empty() {
            json_linked_criterion_ids(step.acceptance_criteria.as_ref())
        } else {
            provided
        }
    };
    let objection_id = format!("obj-{}-{}", step.step_id, now_ms());
    let offer_id = rationale_offer_id(&objection_id);
    let suggested_seed = rationale_offer_seed(&step.title, &text);
    plan_mutation_dao::insert_objection(
        &tx,
        &NewObjection {
            objection_id: objection_id.clone(),
            project_id: plan.project_id,
            plan_id: plan.id,
            step_db_id: step.id,
            stable_step_id: step.step_id.clone(),
            text: text.clone(),
            linked_criterion_ids: linked_criterion_ids.clone(),
            suggestion_status: ObjectionSuggestionStatus::Offered,
        },
    )
    .map_err(|e| e.to_string())?;
    let mut payload = dive_event_log::plan_step_rationale_challenged_payload(
        plan.project_id,
        plan.id,
        step.id,
        step.step_id.clone(),
        linked_criterion_ids,
        objection_id.clone(),
        text,
        "offered",
    );
    if let Value::Object(map) = &mut payload {
        map.insert(
            "message".into(),
            Value::String("Step rationale challenged".into()),
        );
        map.insert("step_title".into(), Value::String(step.title.clone()));
    }
    dive_event_log::append_to_conn(
        &tx,
        None,
        dive_event_log::PLAN_STEP_RATIONALE_CHALLENGED_EVENT,
        payload,
    )
    .map_err(|e| e.to_string())?;
    let offer_payload = dive_event_log::plan_adjustment_offered_payload(
        plan.project_id,
        plan.id,
        step.id,
        step.step_id.clone(),
        objection_id.clone(),
        offer_id.clone(),
        RATIONALE_OFFER_KIND,
        RATIONALE_OFFER_MESSAGE,
    );
    dive_event_log::append_to_conn(
        &tx,
        None,
        dive_event_log::PLAN_ADJUSTMENT_OFFERED_EVENT,
        offer_payload,
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let project_root = state.project_root_required()?;
    workspace_plan_service::artifacts::export_plan_artifacts(conn, plan.id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(StepRationaleChallengeOutput {
        objection_id,
        suggestion_status: "offered".into(),
        offer_id,
        offer_kind: RATIONALE_OFFER_KIND.into(),
        message: RATIONALE_OFFER_MESSAGE.into(),
        suggested_seed: Some(suggested_seed),
    })
}

pub fn workspace_plan_respond_to_plan_adjustment_offer_impl(
    state: &AppState,
    input: PlanAdjustmentOfferResponseInput,
) -> Result<PlanAdjustmentOfferResponseOutput, String> {
    let response = input.response;
    let status = response.suggestion_status();
    let event_type = response.event_type();
    if input.offer_id != rationale_offer_id(&input.objection_id) {
        return Err("offer does not match objection".into());
    }

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let objection = plan_mutation_dao::get_objection(&tx, &input.objection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("objection {} not found", input.objection_id))?;
    if objection.plan_id != input.plan_id || objection.step_db_id != input.step_db_id {
        return Err("offer context does not match objection".into());
    }
    if objection.suggestion_status == ObjectionSuggestionStatus::None {
        return Err("objection has no plan-adjustment offer".into());
    }
    let updated =
        plan_mutation_dao::update_objection_suggestion_status(&tx, &input.objection_id, status)
            .map_err(|e| e.to_string())?;
    let payload = dive_event_log::plan_adjustment_response_payload(
        updated.project_id,
        updated.plan_id,
        updated.step_db_id,
        updated.stable_step_id.clone(),
        updated.objection_id.clone(),
        input.offer_id.clone(),
        response.as_str(),
    );
    dive_event_log::append_to_conn(&tx, None, event_type, payload).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let project_root = state.project_root_required()?;
    workspace_plan_service::artifacts::export_plan_artifacts(conn, updated.plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(PlanAdjustmentOfferResponseOutput {
        objection_id: updated.objection_id,
        offer_id: input.offer_id,
        suggestion_status: response.as_str().to_string(),
    })
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
            project_spec: None,
        });
    };

    let steps = step_dao::list_by_plan(conn, plan.id).map_err(|e| e.to_string())?;
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
    let acceptance_text = step
        .acceptance_criteria
        .iter()
        .filter_map(criterion_input_text)
        .collect::<Vec<_>>()
        .join("\n");
    let mut text = format!(
        "{}\n{}\n{}\n{}",
        step.title, step.summary, step.instruction_seed, acceptance_text
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
        acceptance_criteria: draft
            .acceptance_criteria
            .into_iter()
            .map(AcceptanceCriterionInput::Text)
            .collect(),
        linked_criterion_ids: Vec::new(),
        rationale: None,
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
    let Some(value) = value else {
        return Vec::new();
    };
    match value {
        Value::Array(items) => items.iter().filter_map(json_criterion_text).collect(),
        Value::Object(map) => map
            .get("criteria")
            .or_else(|| map.get("acceptanceCriteria"))
            .or_else(|| map.get("acceptance_criteria"))
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(json_criterion_text).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn json_linked_criterion_ids(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_json_linked_criterion_ids(value, &mut out);
    out
}

fn collect_json_linked_criterion_ids(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_json_linked_criterion_ids(item, out);
            }
        }
        Value::Object(map) => {
            if let Some(id) = map
                .get("criterionId")
                .or_else(|| map.get("criterion_id"))
                .and_then(Value::as_str)
            {
                push_unique(out, id.to_string());
            }
            for key in ["linkedCriterionIds", "linked_criterion_ids"] {
                if let Some(ids) = map.get(key).and_then(Value::as_array) {
                    for id in ids.iter().filter_map(Value::as_str) {
                        push_unique(out, id.to_string());
                    }
                }
            }
        }
        _ => {}
    }
}

fn join_string_array(value: Option<&serde_json::Value>) -> Option<String> {
    let items = json_string_array(value);
    if items.is_empty() {
        None
    } else {
        Some(items.join("\n"))
    }
}

fn json_criterion_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }
    let text = value.get("text").and_then(Value::as_str)?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

#[cfg(test)]
mod prd_interview_prompt_tests {
    use super::*;
    use crate::db::models::{ProjectSpecDraft, ProjectSpecStatus};

    fn empty_draft() -> LiveProjectSpecDraftRow {
        LiveProjectSpecDraftRow {
            draft_id: "draft-1".into(),
            project_id: 1,
            base_version: None,
            spec: ProjectSpecDraft {
                project_spec_id: Some("prd-1".into()),
                project_id: 1,
                current_version: None,
                goal: String::new(),
                intent_summary: None,
                scope: Vec::new(),
                non_goals: Vec::new(),
                constraints: Vec::new(),
                acceptance_criteria: Vec::new(),
                status: ProjectSpecStatus::Draft,
            },
            dirty_fields: Vec::new(),
            student_edited_fields: Vec::new(),
            last_patch_id: None,
            updated_at: 1,
        }
    }

    #[test]
    fn prd_interview_prompt_includes_recent_conversation_to_avoid_loops() {
        let prompt = build_prd_interview_user_prompt(
            &empty_draft(),
            &[
                PrdInterviewConversationTurnInput {
                    role: "assistant".into(),
                    text: "Who needs this first?".into(),
                },
                PrdInterviewConversationTurnInput {
                    role: "student".into(),
                    text: "Teachers checking late submissions.".into(),
                },
            ],
            "They need a dashboard.",
        );

        assert!(prompt.contains("Recent interview conversation"));
        assert!(prompt.contains("Assistant: Who needs this first?"));
        assert!(prompt.contains("Student: Teachers checking late submissions."));
        assert!(prompt.contains("Do not repeat a question that the student has already answered"));
        assert!(prompt.contains("Latest student answer:\nThey need a dashboard."));
    }

    #[test]
    fn prd_interview_ready_focus_does_not_require_optional_scope_or_constraints() {
        let mut draft = empty_draft();
        draft.spec.goal = "Build a personal schedule app".into();
        draft.spec.acceptance_criteria.push(AcceptanceCriterion {
            criterion_id: "AC-001".into(),
            text: "Schedules and tasks appear in separate lists".into(),
            source: AcceptanceCriterionSource::Interview,
            status: AcceptanceCriterionStatus::Active,
            created_in_version: 1,
            retired_in_version: None,
        });

        assert_eq!(
            prd_interview_next_focus(&draft.spec),
            "ready_to_save: the draft is complete enough; point to the PRD confirmation action"
        );

        let prompt = build_prd_interview_user_prompt(&draft, &[], "이 정도면 충분해");
        assert!(prompt.contains("Missing fields required before PRD confirmation, if any: none"));
        assert!(prompt.contains("instead of asking a new required question"));
        assert!(prompt.contains("or asking whether to save"));
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
            acceptance_criteria: vec![AcceptanceCriterionInput::Text(
                "Selecting an answer updates visible state.".into(),
            )],
            linked_criterion_ids: vec!["AC-001".into()],
            rationale: Some("This step isolates the visible state required by AC-001.".into()),
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
