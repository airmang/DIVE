use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use async_trait::async_trait;
use dive_lib::auth::InMemoryKeyring;
use dive_lib::db::dao::{
    card, event_log, interview, plan, prd, project, session, step, step_session_mapping as mapping,
    workmap,
};
use dive_lib::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus, NewInterview,
    NewLiveProjectSpecDraft, NewPlan, NewProject, NewStep, ProjectSpecDraft, ProjectSpecStatus,
};
use dive_lib::ipc::workspace_plan::{
    roadmap_step_open_impl, roadmap_step_update_state_impl, workspace_plan_activity_impl,
    workspace_plan_append_step_impl, workspace_plan_approve_impl,
    workspace_plan_challenge_step_rationale_impl, workspace_plan_current_draft_impl,
    workspace_plan_dashboard_impl, workspace_plan_discard_plan_impl,
    workspace_plan_generate_draft_impl, workspace_plan_list_steps_impl,
    workspace_plan_route_cancel_impl, workspace_plan_route_chat_impl,
    workspace_plan_save_interview_answer_impl, workspace_plan_start_interview_impl,
    workspace_plan_status_impl, workspace_plan_step_mappings_impl,
    workspace_plan_submit_interview_impl, workspace_prd_get_impl,
    workspace_prd_interview_turn_impl, workspace_prd_save_impl, workspace_prd_status_impl,
    AcceptanceCriterionInput, PlanDraftInput, PrdInterviewTurnInput, PrdSaveInput, RouteDecision,
    StepDraftInput, StepRationaleChallengeInput, StepStateUpdateInput,
};
use dive_lib::{
    AppState, ChatEvent, ChatRequest, Database, FinishReason, LlmProvider, ModelInfo, ProviderError,
};
use futures::stream::{self, BoxStream};
use futures::StreamExt;
use serde_json::json;

#[derive(Clone)]
struct ScriptedProvider {
    scripts: Arc<Mutex<Vec<Vec<ChatEvent>>>>,
    requests: Arc<Mutex<Vec<ChatRequest>>>,
}

impl ScriptedProvider {
    fn new(scripts: Vec<Vec<ChatEvent>>) -> Self {
        Self {
            scripts: Arc::new(Mutex::new(scripts)),
            requests: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn request_count(&self) -> usize {
        self.requests
            .lock()
            .map(|requests| requests.len())
            .unwrap_or(0)
    }

    fn requests_snapshot(&self) -> Vec<ChatRequest> {
        self.requests
            .lock()
            .map(|requests| requests.clone())
            .unwrap_or_default()
    }
}

#[async_trait]
impl LlmProvider for ScriptedProvider {
    fn id(&self) -> &str {
        "mock"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock-model".into(),
            display_name: "Mock".into(),
        }]
    }

    async fn chat(&self, req: ChatRequest) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        if let Ok(mut requests) = self.requests.lock() {
            requests.push(req);
        }
        let batch = {
            let mut scripts = self.scripts.lock().map_err(|_| {
                ProviderError::Unsupported("scripted provider mutex poisoned".into())
            })?;
            if scripts.is_empty() {
                vec![ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                }]
            } else {
                scripts.remove(0)
            }
        };
        Ok(stream::iter(batch).boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}

struct PendingRouteProviderResponse {
    called: Arc<AtomicBool>,
}

struct FailingRouteProvider;

#[async_trait]
impl LlmProvider for FailingRouteProvider {
    fn id(&self) -> &str {
        "mock"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock".into(),
            display_name: "Mock".into(),
        }]
    }

    async fn chat(
        &self,
        _req: ChatRequest,
    ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        Err(ProviderError::Api {
            status: 500,
            body: r#"{ "error": { "message": "Internal server error" } }"#.into(),
        })
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}

#[async_trait]
impl LlmProvider for PendingRouteProviderResponse {
    fn id(&self) -> &str {
        "mock"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock".into(),
            display_name: "Mock".into(),
        }]
    }

    async fn chat(
        &self,
        _req: ChatRequest,
    ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        self.called.store(true, Ordering::SeqCst);
        std::future::pending().await
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}

struct PendingRouteStreamProvider;

#[async_trait]
impl LlmProvider for PendingRouteStreamProvider {
    fn id(&self) -> &str {
        "mock"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "mock".into(),
            display_name: "Mock".into(),
        }]
    }

    async fn chat(
        &self,
        _req: ChatRequest,
    ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        Ok(stream::pending().boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}

fn mk_state_with_provider(tmp: &tempfile::TempDir, provider: Arc<dyn LlmProvider>) -> AppState {
    let mut db = Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    AppState::new(db, provider, tmp.path().to_path_buf(), "mock".into())
        .with_keyring(Arc::new(InMemoryKeyring::new()))
}

fn mk_state(tmp: &tempfile::TempDir) -> AppState {
    mk_state_with_scripts(tmp, Vec::new()).0
}

fn mk_state_with_scripts(
    tmp: &tempfile::TempDir,
    scripts: Vec<Vec<ChatEvent>>,
) -> (AppState, Arc<ScriptedProvider>) {
    let mut db = Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    let provider = Arc::new(ScriptedProvider::new(scripts));
    let state = AppState::new(
        db,
        provider.clone(),
        tmp.path().to_path_buf(),
        "mock".into(),
    )
    .with_keyring(Arc::new(InMemoryKeyring::new()));
    (state, provider)
}

fn seed_project(state: &AppState) -> i64 {
    seed_project_named(state, "Workspace Plan", "/tmp/workspace-plan")
}

fn seed_project_named(state: &AppState, name: &str, path: &str) -> i64 {
    let db = state.db.lock().unwrap();
    project::insert(
        db.conn(),
        &NewProject {
            name: name.into(),
            path: path.into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap()
}

fn seed_plan(state: &AppState, project_id: i64, status: &str) -> i64 {
    let db = state.db.lock().unwrap();
    plan::insert(
        db.conn(),
        &NewPlan {
            project_id,
            interview_id: None,
            goal: "Build a graph roadmap".into(),
            intent_summary: None,
            scope: None,
            non_goals: None,
            constraints: None,
            acceptance_criteria: None,
            status: status.into(),
        },
    )
    .unwrap()
}

fn insert_step(state: &AppState, plan_id: i64, step_id: &str, deps: &[&str]) -> i64 {
    let db = state.db.lock().unwrap();
    step::insert(
        db.conn(),
        &NewStep {
            plan_id,
            step_id: step_id.into(),
            title: format!("Step {step_id}"),
            summary: None,
            instruction_seed: Some(format!("Do {step_id}")),
            expected_files: Some(serde_json::json!([])),
            acceptance_criteria: Some(serde_json::json!(["done"])),
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: Some(serde_json::json!(deps)),
            parallel_group: None,
            position: step_id.trim_start_matches("step-").parse::<i64>().unwrap(),
        },
    )
    .unwrap()
}

fn draft_input() -> PlanDraftInput {
    PlanDraftInput {
        goal: "Build a graph roadmap".into(),
        intent_summary: "Keep plan metadata separate from execution cards.".into(),
        scope: vec!["persist approved plans".into()],
        non_goals: vec!["replace Card execution state".into()],
        constraints: vec!["SQLite remains runtime source of truth".into()],
        acceptance_criteria: vec![AcceptanceCriterionInput::Text(
            "draft plan is persisted".into(),
        )],
        steps: vec![
            StepDraftInput {
                title: "Create schema".into(),
                summary: "Add durable plan tables.".into(),
                instruction_seed: "Implement schema and migration.".into(),
                expected_files: vec!["src-tauri/src/db/schema.rs".into()],
                acceptance_criteria: vec![AcceptanceCriterionInput::Text(
                    "A saved PRD unlocks plan generation".into(),
                )],
                linked_criterion_ids: vec!["AC-001".into()],
                rationale: Some(
                    "The schema step persists the PRD-backed plan needed for AC-001.".into(),
                ),
                verification_command: Some("cargo test".into()),
                verification_type: Some("command".into()),
                dependencies: vec![],
                parallel_group: None,
                position: 1,
                step_id: "step-001".into(),
            },
            StepDraftInput {
                title: "Export artifacts".into(),
                summary: "Write plan artifacts.".into(),
                instruction_seed: "Export from SQLite.".into(),
                expected_files: vec![".dive/plan.json".into()],
                acceptance_criteria: vec![AcceptanceCriterionInput::Text(
                    "A saved PRD unlocks plan generation".into(),
                )],
                linked_criterion_ids: vec!["AC-001".into()],
                rationale: Some(
                    "The export step proves the PRD-backed decomposition remains reconstructable."
                        .into(),
                ),
                verification_command: None,
                verification_type: Some("manual".into()),
                dependencies: vec!["step-001".into()],
                parallel_group: Some(1),
                position: 2,
                step_id: "step-002".into(),
            },
        ],
    }
}

fn append_step_draft(dependencies: Vec<String>) -> StepDraftInput {
    StepDraftInput {
        title: "Add authentication".into(),
        summary: "Add sign-in and session handling.".into(),
        instruction_seed: "Implement authentication flows and update related UI.".into(),
        expected_files: vec!["src/auth.ts".into()],
        acceptance_criteria: vec![AcceptanceCriterionInput::Text("Users can sign in.".into())],
        linked_criterion_ids: Vec::new(),
        rationale: None,
        verification_command: Some("pnpm test".into()),
        verification_type: Some("command".into()),
        dependencies,
        parallel_group: Some(1),
        position: 99,
        step_id: "ignored-by-append".into(),
    }
}

fn prd_criterion(text: &str) -> AcceptanceCriterion {
    AcceptanceCriterion {
        criterion_id: "AC-001".into(),
        text: text.into(),
        source: AcceptanceCriterionSource::StudentEdit,
        status: AcceptanceCriterionStatus::Active,
        created_in_version: 1,
        retired_in_version: None,
    }
}

fn minimal_prd_draft(project_id: i64) -> ProjectSpecDraft {
    ProjectSpecDraft {
        project_spec_id: Some(format!("prd-{project_id}")),
        project_id,
        current_version: None,
        goal: "Build a PRD-backed roadmap".into(),
        intent_summary: Some("Turn the project goal into a saved PRD.".into()),
        scope: vec!["PRD authoring".into()],
        non_goals: vec!["Add-step mutation".into()],
        constraints: vec!["Local-first EventLog".into()],
        acceptance_criteria: vec![prd_criterion("A saved PRD unlocks plan generation")],
        status: ProjectSpecStatus::Draft,
    }
}

fn seed_minimal_prd(state: &AppState, project_id: i64) {
    workspace_prd_save_impl(
        state,
        PrdSaveInput {
            project_id,
            spec: minimal_prd_draft(project_id),
            reason: "interview".into(),
        },
    )
    .unwrap();
}

#[test]
fn prd_status_get_and_save_distinguish_missing_draft_and_minimal() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);

    let missing = workspace_prd_status_impl(&state, project_id).unwrap();
    assert_eq!(missing.status, "missing");
    assert_eq!(missing.project_spec_id, None);
    assert_eq!(workspace_prd_get_impl(&state, project_id).unwrap(), None);

    {
        let db = state.db.lock().unwrap();
        prd::upsert_draft(
            db.conn(),
            &NewLiveProjectSpecDraft {
                draft_id: "prd-draft-test".into(),
                project_id,
                base_version: None,
                spec: ProjectSpecDraft {
                    project_spec_id: Some(format!("prd-{project_id}")),
                    project_id,
                    current_version: None,
                    goal: "Draft goal only".into(),
                    intent_summary: None,
                    scope: vec![],
                    non_goals: vec![],
                    constraints: vec![],
                    acceptance_criteria: vec![],
                    status: ProjectSpecStatus::Draft,
                },
                dirty_fields: vec!["goal".into()],
                student_edited_fields: vec!["goal".into()],
                last_patch_id: None,
            },
        )
        .unwrap();
    }

    let draft = workspace_prd_status_impl(&state, project_id).unwrap();
    assert_eq!(draft.status, "draft");
    assert_eq!(draft.draft_id.as_deref(), Some("prd-draft-test"));

    let saved = workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec: minimal_prd_draft(project_id),
            reason: "interview".into(),
        },
    )
    .unwrap();
    assert_eq!(saved.current_version, 1);
    assert_eq!(saved.acceptance_criteria[0].criterion_id, "AC-001");

    let minimal = workspace_prd_status_impl(&state, project_id).unwrap();
    assert_eq!(minimal.status, "minimal");
    let expected_prd_id = format!("prd-{project_id}");
    assert_eq!(
        minimal.project_spec_id.as_deref(),
        Some(expected_prd_id.as_str())
    );
    assert_eq!(minimal.current_version, Some(1));
    assert_eq!(
        workspace_prd_get_impl(&state, project_id)
            .unwrap()
            .unwrap()
            .goal,
        "Build a PRD-backed roadmap"
    );
}

#[tokio::test]
async fn prd_interview_turn_applies_validated_patch_without_creating_version() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                r#"좋아요. 초안에 반영할게요.
```json
{
  "assistantMessage": "목표와 확인 기준을 PRD 초안에 반영했어요.",
  "patch": {
    "operations": [
      { "op": "set_goal", "value": "Build a focus timer" },
      { "op": "append_acceptance_criterion", "text": "Timer counts down visibly" }
    ],
    "rationale": "학생 답변에서 목표와 완료 기준을 추출했습니다."
  }
}
```"#
                    .into(),
            ),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);

    let turn = workspace_prd_interview_turn_impl(
        &state,
        PrdInterviewTurnInput {
            project_id,
            draft_id: "draft-focus".into(),
            answer: "A focus timer that shows a countdown".into(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "applied");
    assert_eq!(turn.applied_field_paths, vec!["goal", "acceptanceCriteria"]);
    assert!(turn.rejected_reasons.is_empty());
    assert_eq!(turn.live_draft.spec.goal, "Build a focus timer");
    assert_eq!(
        turn.live_draft.spec.acceptance_criteria[0].criterion_id,
        "AC-001"
    );
    assert_eq!(
        prd::latest_version(state.db.lock().unwrap().conn(), project_id)
            .unwrap()
            .map(|row| row.version),
        None
    );
    assert_eq!(provider.requests_snapshot()[0].model, "mock-model");

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(events
        .iter()
        .any(|event| event.r#type == "prd_patch_proposed"));
    assert!(events
        .iter()
        .any(|event| event.r#type == "prd_patch_applied"));
}

#[tokio::test]
async fn prd_interview_turn_rejects_invalid_patch_and_leaves_draft_unchanged() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                r#"{"assistantMessage":"그 값은 초안에 넣지 않을게요.","patch":{"operations":[{"op":"set_goal","value":"token = sk-secret123"}],"rationale":"bad"}}"#
                    .into(),
            ),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);

    let turn = workspace_prd_interview_turn_impl(
        &state,
        PrdInterviewTurnInput {
            project_id,
            draft_id: "draft-secret".into(),
            answer: "Use this token: sk-secret123".into(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "rejected");
    assert!(turn.rejected_reasons.contains(&"secret_like_text".into()));
    assert_eq!(turn.live_draft.spec.goal, "");

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(events
        .iter()
        .any(|event| event.r#type == "prd_patch_rejected"));
}

#[test]
fn generate_draft_refuses_missing_minimal_prd() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();

    let err =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap_err();

    assert!(err.contains("minimal PRD"));
    assert!(
        plan::get_by_project(state.db.lock().unwrap().conn(), project_id)
            .unwrap()
            .is_none()
    );
}

#[test]
fn generate_draft_rejects_steps_without_linked_criteria_or_rationale() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    seed_minimal_prd(&state, project_id);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();

    let mut input = draft_input();
    input.steps[0].linked_criterion_ids.clear();
    input.steps[0].rationale = None;

    let err = workspace_plan_generate_draft_impl(&state, submitted.id, input, false).unwrap_err();

    assert!(
        err.contains("linkedCriterionIds"),
        "unexpected error: {err}"
    );
    assert!(err.contains("rationale"), "unexpected error: {err}");
}

#[test]
fn generate_draft_accepts_legacy_criteria_with_step_links_and_rationale() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    seed_minimal_prd(&state, project_id);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    let input: PlanDraftInput = serde_json::from_value(json!({
        "goal": "Build a graph roadmap",
        "intentSummary": "Keep plan metadata separate from execution cards.",
        "scope": ["persist approved plans"],
        "nonGoals": ["replace Card execution state"],
        "constraints": ["SQLite remains runtime source of truth"],
        "acceptanceCriteria": ["A saved PRD unlocks plan generation"],
        "steps": [{
            "stepId": "step-001",
            "title": "Create schema",
            "summary": "Add durable plan tables.",
            "instructionSeed": "Implement schema and migration.",
            "expectedFiles": ["src-tauri/src/db/schema.rs"],
            "acceptanceCriteria": ["A saved PRD unlocks plan generation"],
            "linkedCriterionIds": ["AC-001"],
            "rationale": "This step creates the durable storage needed for AC-001.",
            "verificationCommand": "cargo test",
            "verificationType": "command",
            "dependencies": [],
            "parallelGroup": null,
            "position": 1
        }]
    }))
    .unwrap();

    let (_plan, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, input, false).unwrap();
    let criteria = steps[0].acceptance_criteria.as_ref().unwrap();

    assert_eq!(criteria["linkedCriterionIds"], json!(["AC-001"]));
    assert_eq!(
        criteria["rationale"],
        "This step creates the durable storage needed for AC-001."
    );
    assert_eq!(criteria["criteria"][0]["criterionId"], "AC-001");
    assert_eq!(
        criteria["criteria"][0]["text"],
        "A saved PRD unlocks plan generation"
    );
}

#[test]
fn challenging_step_rationale_logs_objection_without_blocking_start() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let step_id = insert_step(&state, plan_id, "step-001", &[]);

    let result = workspace_plan_challenge_step_rationale_impl(
        &state,
        StepRationaleChallengeInput {
            plan_id,
            step_db_id: step_id,
            text: "이 단계가 AC-001과 직접 연결되는지 다시 확인하고 싶어요.".into(),
            linked_criterion_ids: vec!["AC-001".into()],
        },
    )
    .unwrap();

    assert_eq!(result.suggestion_status, "none");
    assert!(result.objection_id.starts_with("obj-"));

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(events
        .iter()
        .any(|event| event.r#type == "plan_step_rationale_challenged"));

    let opened = roadmap_step_open_impl(&state, step_id).unwrap();
    assert_eq!(opened.step_id, step_id);
}

#[test]
fn status_counts_ready_and_blocked_steps() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &["step-001"]);

    let status = workspace_plan_status_impl(&state, project_id).unwrap();
    assert_eq!(status.status, "approved");
    assert_eq!(status.plan_id, Some(plan_id));
    assert_eq!(status.step_count, 2);
    assert_eq!(status.ready_count, 1);
    assert_eq!(status.blocked_count, 1);
}

#[test]
fn status_counts_blocked_step_mapping_as_blocked_not_active() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let first = insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &["step-001"]);
    let mapping = roadmap_step_open_impl(&state, first).unwrap();
    mapping::update_status(state.db.lock().unwrap().conn(), mapping.id, "blocked").unwrap();

    let status = workspace_plan_status_impl(&state, project_id).unwrap();
    assert_eq!(status.ready_count, 0);
    assert_eq!(status.blocked_count, 2);
}

#[test]
fn dashboard_lists_projects_with_plan_progress_and_actions() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let no_plan_project = seed_project_named(&state, "No Plan", "/tmp/dashboard-no-plan");
    let draft_project = seed_project_named(&state, "Draft Plan", "/tmp/dashboard-draft-plan");
    let draft_plan = seed_plan(&state, draft_project, "draft");
    let approved_project =
        seed_project_named(&state, "Approved Plan", "/tmp/dashboard-approved-plan");
    let approved_plan = seed_plan(&state, approved_project, "approved");
    let first = insert_step(&state, approved_plan, "step-001", &[]);
    insert_step(&state, approved_plan, "step-002", &["step-001"]);
    let active = insert_step(&state, approved_plan, "step-003", &[]);
    insert_step(&state, approved_plan, "step-004", &["step-002"]);

    roadmap_step_open_impl(&state, first).unwrap();
    roadmap_step_update_state_impl(
        &state,
        StepStateUpdateInput {
            step_id: first,
            status: "done".into(),
            evidence: Some("first complete".into()),
            verification_status: Some("passed".into()),
        },
    )
    .unwrap();
    let active_mapping = roadmap_step_open_impl(&state, active).unwrap();

    let dashboard = workspace_plan_dashboard_impl(&state).unwrap();
    assert_eq!(dashboard.len(), 3);

    let no_plan = dashboard
        .iter()
        .find(|row| row.project_id == no_plan_project)
        .unwrap();
    assert_eq!(no_plan.project_name, "No Plan");
    assert_eq!(no_plan.plan_id, None);
    assert_eq!(no_plan.step_count, 0);
    assert!(no_plan.next_ready_steps.is_empty());

    let draft = dashboard
        .iter()
        .find(|row| row.project_id == draft_project)
        .unwrap();
    assert_eq!(draft.plan_id, Some(draft_plan));
    assert_eq!(draft.plan_status.as_deref(), Some("draft"));
    assert_eq!(draft.step_count, 0);

    let approved = dashboard
        .iter()
        .find(|row| row.project_id == approved_project)
        .unwrap();
    assert_eq!(approved.plan_id, Some(approved_plan));
    assert_eq!(approved.plan_goal.as_deref(), Some("Build a graph roadmap"));
    assert_eq!(approved.plan_status.as_deref(), Some("approved"));
    assert_eq!(approved.step_count, 4);
    assert_eq!(approved.ready_count, 1);
    assert_eq!(approved.blocked_count, 1);
    assert_eq!(approved.active_count, 1);
    assert_eq!(approved.done_count, 1);
    assert_eq!(approved.shipped_count, 0);
    assert_eq!(approved.next_ready_steps.len(), 1);
    assert_eq!(approved.next_ready_steps[0].step_db_id, first + 1);
    assert_eq!(approved.next_ready_steps[0].stable_step_id, "step-002");
    assert_eq!(approved.next_ready_steps[0].status, "ready");
    assert_eq!(approved.active_steps.len(), 1);
    assert_eq!(approved.active_steps[0].step_db_id, active);
    assert_eq!(approved.active_steps[0].stable_step_id, "step-003");
    assert_eq!(
        approved.active_steps[0].session_id,
        active_mapping.session_id
    );
}

#[tokio::test]
async fn route_chat_returns_skip_when_no_approved_plan() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, provider) = mk_state_with_scripts(&tmp, Vec::new());
    let project_id = seed_project(&state);

    let decision = workspace_plan_route_chat_impl(&state, project_id, "auth 추가해줘".into(), None)
        .await
        .unwrap();

    assert_eq!(
        decision,
        RouteDecision::Skip {
            reason: "approved plan not found".into()
        }
    );
    assert_eq!(provider.request_count(), 0);
}

#[tokio::test]
async fn route_chat_returns_chat_decision_from_mock_provider() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta("ROUTE chat reason=\"status question\"".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision =
        workspace_plan_route_chat_impl(&state, project_id, "지금 진행상황 어때?".into(), None)
            .await
            .unwrap();

    assert_eq!(
        decision,
        RouteDecision::Chat {
            reason: "status question".into()
        }
    );
    let requests = provider.requests_snapshot();
    assert_eq!(requests.len(), 1);
    assert!(format!("{:?}", requests[0].messages).contains("step-001"));
}

#[tokio::test]
async fn route_chat_parses_add_step_and_generates_next_step_id() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta("ROUTE add_step title=\"Add authentication\" summary=\"Add sign-in and session handling.\" instruction_seed=\"Implement authentication flows.\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Users can sign in.\"] verification_type=\"command\" verification_command=\"pnpm test\" dependencies=[\"step-001\"] parallel_group=1 reason=\"new implementation request\"".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &["step-001"]);

    let decision =
        workspace_plan_route_chat_impl(&state, project_id, "auth도 추가해줘".into(), None)
            .await
            .unwrap();

    match decision {
        RouteDecision::AddStep { draft, reason } => {
            assert_eq!(reason, "new implementation request");
            assert_eq!(draft.step_id, "step-003");
            assert_eq!(draft.position, 3);
            assert_eq!(draft.title, "Add authentication");
            assert_eq!(draft.dependencies, vec!["step-001"]);
            assert_eq!(draft.parallel_group, Some(1));
        }
        other => panic!("expected add_step decision, got {other:?}"),
    }
}

#[tokio::test]
async fn route_chat_downgrades_duplicate_step_to_chat() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta("ROUTE add_step title=\"Step step-001\" summary=\"Repeat existing step.\" instruction_seed=\"Do step-001\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Users can sign in.\"] verification_type=\"manual\" verification_command=\"\" dependencies=[] parallel_group=null reason=\"new implementation request\"".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision =
        workspace_plan_route_chat_impl(&state, project_id, "1단계를 다시 만들어줘".into(), None)
            .await
            .unwrap();

    match decision {
        RouteDecision::Chat { reason } => {
            assert!(reason.contains("already covered by step-001"));
        }
        other => panic!("expected duplicate route to become chat, got {other:?}"),
    }
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn route_chat_fails_open_when_router_provider_returns_api_error() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state_with_provider(&tmp, Arc::new(FailingRouteProvider));
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision = workspace_plan_route_chat_impl(
        &state,
        project_id,
        "새 작업을 하나 더 추가해줘".into(),
        None,
    )
    .await
    .unwrap();

    assert_eq!(
        decision,
        RouteDecision::Skip {
            reason: "router unavailable; continuing as normal chat".into()
        }
    );
}

#[tokio::test]
async fn route_chat_cancel_while_waiting_for_provider_response() {
    let tmp = tempfile::tempdir().unwrap();
    let provider_called = Arc::new(AtomicBool::new(false));
    let state = mk_state_with_provider(
        &tmp,
        Arc::new(PendingRouteProviderResponse {
            called: provider_called.clone(),
        }),
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    let route_request_id = "route-provider-cancel-test".to_string();

    let result = tokio::time::timeout(Duration::from_millis(300), async {
        let route = workspace_plan_route_chat_impl(
            &state,
            project_id,
            "계속 대기하는 라우팅".into(),
            Some(route_request_id.clone()),
        );
        let cancel = async {
            while !provider_called.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            workspace_plan_route_cancel_impl(&state, route_request_id)
        };
        let (route_result, cancel_result) = tokio::join!(route, cancel);
        cancel_result.unwrap();
        route_result
    })
    .await
    .expect("route cancellation should interrupt pending provider response");

    let err = result.expect_err("route should be cancelled");
    assert!(
        err.to_lowercase().contains("cancel"),
        "unexpected route error: {err}"
    );
    assert!(provider_called.load(Ordering::SeqCst));
}

#[tokio::test]
async fn route_chat_cancel_while_waiting_for_stream_chunk() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state_with_provider(&tmp, Arc::new(PendingRouteStreamProvider));
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    let route_request_id = "route-stream-cancel-test".to_string();

    let result = tokio::time::timeout(Duration::from_millis(300), async {
        let route = workspace_plan_route_chat_impl(
            &state,
            project_id,
            "스트림 청크를 기다리는 라우팅".into(),
            Some(route_request_id.clone()),
        );
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(25)).await;
            workspace_plan_route_cancel_impl(&state, route_request_id)
        };
        let (route_result, cancel_result) = tokio::join!(route, cancel);
        cancel_result.unwrap();
        route_result
    })
    .await
    .expect("route cancellation should interrupt pending stream chunk");

    let err = result.expect_err("route should be cancelled");
    assert!(
        err.to_lowercase().contains("cancel"),
        "unexpected route error: {err}"
    );
}

#[test]
fn append_step_increments_position_and_passes_dependency_check() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &["step-001"]);

    let row = workspace_plan_append_step_impl(
        &state,
        plan_id,
        append_step_draft(vec!["step-001".into()]),
    )
    .unwrap();

    assert_eq!(row.step_id, "step-003");
    assert_eq!(row.position, 3);
    assert_eq!(row.dependencies, Some(json!(["step-001"])));
    assert_eq!(row.parallel_group, Some("1".into()));
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn append_step_rejects_invalid_dependencies() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let err = workspace_plan_append_step_impl(
        &state,
        plan_id,
        append_step_draft(vec!["step-999".into()]),
    )
    .unwrap_err();

    assert!(err.contains("invalid dependency"));
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn append_step_rejects_duplicate_title() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let mut duplicate = append_step_draft(vec![]);
    duplicate.title = "Step step-001".into();
    duplicate.instruction_seed = "Create another copy of the first step.".into();

    let err = workspace_plan_append_step_impl(&state, plan_id, duplicate).unwrap_err();

    assert!(err.contains("step already exists"));
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn append_step_rejects_when_plan_not_approved() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "draft");

    let err =
        workspace_plan_append_step_impl(&state, plan_id, append_step_draft(vec![])).unwrap_err();

    assert!(err.contains("approved"));
    assert!(workspace_plan_list_steps_impl(&state, plan_id)
        .unwrap()
        .is_empty());
}

#[test]
fn approve_exports_artifacts_and_returns_approved_plan() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "draft");
    insert_step(&state, plan_id, "step-001", &[]);

    let approved = workspace_plan_approve_impl(&state, plan_id).unwrap();
    assert_eq!(approved.status, "approved");
    assert!(tmp.path().join(".dive/plan.json").exists());
}

#[test]
fn opening_ready_step_creates_session_card_and_mapping() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let step_id = insert_step(&state, plan_id, "step-001", &[]);

    let mapping = roadmap_step_open_impl(&state, step_id).unwrap();
    assert_eq!(mapping.status, "in_progress");
    assert_eq!(mapping.step_id, step_id);

    let db = state.db.lock().unwrap();
    let session_id = mapping.session_id.unwrap();
    let card_id = mapping.card_id.unwrap();
    assert!(session::get_by_id(db.conn(), session_id).unwrap().is_some());
    assert_eq!(
        card::get_by_id(db.conn(), card_id)
            .unwrap()
            .unwrap()
            .instruction,
        Some("Do step-001".into())
    );
    assert_eq!(
        workmap::get(db.conn(), session_id)
            .unwrap()
            .unwrap()
            .current_card_id,
        Some(card_id)
    );
}

#[test]
fn opening_ready_step_twice_returns_existing_mapping() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let step_id = insert_step(&state, plan_id, "step-001", &[]);

    let first = roadmap_step_open_impl(&state, step_id).unwrap();
    let second = roadmap_step_open_impl(&state, step_id).unwrap();

    assert_eq!(second.id, first.id);
    assert_eq!(second.step_id, first.step_id);
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(second.card_id, first.card_id);
    assert_eq!(second.status, first.status);

    let db = state.db.lock().unwrap();
    let matching_mappings = mapping::list(db.conn())
        .unwrap()
        .into_iter()
        .filter(|mapping| mapping.step_id == step_id)
        .count();
    assert_eq!(matching_mappings, 1);
}

#[test]
fn opening_blocked_step_is_rejected_without_creating_mapping() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &[]);
    let blocked = insert_step(&state, plan_id, "step-003", &["step-001", "step-002"]);

    let err = roadmap_step_open_impl(&state, blocked).unwrap_err();
    assert_eq!(
        err,
        "step is blocked: waiting for step-001, step-002".to_string()
    );
    assert!(workspace_plan_step_mappings_impl(&state, plan_id)
        .unwrap()
        .is_empty());
}

#[test]
fn updating_step_state_unlocks_dependent_step_status() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let first = insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &["step-001"]);
    roadmap_step_open_impl(&state, first).unwrap();

    let updated = roadmap_step_update_state_impl(
        &state,
        StepStateUpdateInput {
            step_id: first,
            status: "done".into(),
            evidence: Some("tests passed".into()),
            verification_status: Some("passed".into()),
        },
    )
    .unwrap();
    assert_eq!(updated.status, "done");
    assert!(updated.completed_at.is_some());

    let status = workspace_plan_status_impl(&state, project_id).unwrap();
    assert_eq!(status.ready_count, 1);
    assert_eq!(status.blocked_count, 0);

    let steps = workspace_plan_list_steps_impl(&state, plan_id).unwrap();
    assert_eq!(steps.len(), 2);
    assert_eq!(
        mapping::get_by_step(state.db.lock().unwrap().conn(), first)
            .unwrap()
            .unwrap()
            .verification_status,
        Some("passed".into())
    );
}

#[test]
fn plan_activity_records_lifecycle_events_latest_first() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "draft");
    let first = insert_step(&state, plan_id, "step-001", &[]);

    workspace_plan_approve_impl(&state, plan_id).unwrap();
    workspace_plan_append_step_impl(&state, plan_id, append_step_draft(vec!["step-001".into()]))
        .unwrap();
    roadmap_step_open_impl(&state, first).unwrap();
    roadmap_step_update_state_impl(
        &state,
        StepStateUpdateInput {
            step_id: first,
            status: "done".into(),
            evidence: Some("tests passed".into()),
            verification_status: Some("passed".into()),
        },
    )
    .unwrap();

    let activity = workspace_plan_activity_impl(&state, plan_id, 10).unwrap();
    let event_types = activity
        .iter()
        .map(|row| row.event_type.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        event_types,
        vec![
            "plan_step_state_changed",
            "plan_step_opened",
            "plan_step_appended",
            "plan_approved"
        ]
    );
    assert_eq!(activity[0].stable_step_id.as_deref(), Some("step-001"));
    assert_eq!(activity[0].step_title.as_deref(), Some("Step step-001"));
    assert_eq!(activity[0].message, "Step marked done");
    assert_eq!(activity[0].reason, None);
}

#[test]
fn plan_activity_records_blocked_open_failure_reason() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &[]);
    let blocked = insert_step(&state, plan_id, "step-003", &["step-001", "step-002"]);

    let err = roadmap_step_open_impl(&state, blocked).unwrap_err();

    let activity = workspace_plan_activity_impl(&state, plan_id, 10).unwrap();
    assert_eq!(activity.len(), 1);
    assert_eq!(activity[0].event_type, "plan_step_open_failed");
    assert_eq!(activity[0].stable_step_id.as_deref(), Some("step-003"));
    assert_eq!(activity[0].message, "Step start blocked");
    assert_eq!(activity[0].reason.as_deref(), Some(err.as_str()));
}

#[test]
fn start_interview_creates_draft_and_is_idempotent_until_discarded() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);

    let first =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    assert_eq!(first.project_id, project_id);
    assert_eq!(first.goal, "Build a roadmap");
    assert_eq!(first.status, "draft");
    assert_eq!(first.questions, Some(json!([])));
    assert_eq!(first.unresolved_questions, Some(json!([])));

    let second =
        workspace_plan_start_interview_impl(&state, project_id, "Different goal".into()).unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.goal, first.goal);

    let db = state.db.lock().unwrap();
    interview::update(
        db.conn(),
        first.id,
        &NewInterview {
            project_id,
            goal: first.goal.clone(),
            questions: first.questions.clone(),
            unresolved_questions: first.unresolved_questions.clone(),
            intent_summary: first.intent_summary.clone(),
            status: "discarded".into(),
        },
    )
    .unwrap();
    drop(db);

    let replacement =
        workspace_plan_start_interview_impl(&state, project_id, "Replacement goal".into()).unwrap();
    assert_eq!(replacement.goal, "Replacement goal");
    assert_eq!(replacement.status, "draft");
    assert_eq!(replacement.questions, Some(json!([])));
}

#[test]
fn save_interview_answer_appends_question_answer_pair() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();

    let saved = workspace_plan_save_interview_answer_impl(
        &state,
        interview.id,
        "Who uses it?".into(),
        "Teachers".into(),
    )
    .unwrap();
    assert_eq!(
        saved.questions,
        Some(json!([{"question":"Who uses it?","answer":"Teachers"}]))
    );
    assert!(saved.updated_at >= interview.updated_at);
}

#[test]
fn submit_interview_persists_summary_and_unresolved_questions() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();

    let submitted = workspace_plan_submit_interview_impl(
        &state,
        interview.id,
        "A roadmap for plan-first work.".into(),
        vec!["Should dependencies be editable?".into()],
    )
    .unwrap();
    assert_eq!(submitted.status, "submitted");
    assert_eq!(
        submitted.intent_summary,
        Some("A roadmap for plan-first work.".into())
    );
    assert_eq!(
        submitted.unresolved_questions,
        Some(json!(["Should dependencies be editable?"]))
    );
}

#[test]
fn submit_interview_rejects_non_draft_status() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![]).unwrap();

    let err = workspace_plan_submit_interview_impl(&state, interview.id, "Again".into(), vec![])
        .unwrap_err();
    assert!(err.contains("draft"));
}

#[test]
fn generate_draft_creates_plan_and_steps_in_one_transaction() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);

    let (plan_row, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();
    assert_eq!(plan_row.project_id, project_id);
    assert_eq!(plan_row.interview_id, Some(submitted.id));
    assert_eq!(plan_row.status, "draft");
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0].step_id, "step-001");
    assert_eq!(steps[1].dependencies, Some(json!(["step-001"])));
    assert_eq!(steps[1].parallel_group, Some("1".into()));
}

#[test]
fn current_draft_returns_project_draft_plan_and_steps() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);
    let (plan_row, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();

    let current = workspace_plan_current_draft_impl(&state, project_id)
        .unwrap()
        .expect("draft should be available");

    assert_eq!(current.0.id, plan_row.id);
    assert_eq!(current.0.status, "draft");
    assert_eq!(current.1.len(), steps.len());

    workspace_plan_approve_impl(&state, plan_row.id).unwrap();
    assert!(workspace_plan_current_draft_impl(&state, project_id)
        .unwrap()
        .is_none());
}

#[test]
fn generate_draft_replaces_existing_draft_plan_for_project() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);
    workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();

    let mut replacement = draft_input();
    replacement.goal = "Replacement draft".into();
    replacement.steps.truncate(1);
    let (second_plan, second_steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, replacement, false).unwrap();

    assert_eq!(second_plan.goal, "Replacement draft");
    assert_eq!(second_steps.len(), 1);

    let db = state.db.lock().unwrap();
    assert_eq!(plan::list(db.conn()).unwrap().len(), 1);
    assert!(
        step::get_by_plan_and_step_id(db.conn(), second_plan.id, "step-002")
            .unwrap()
            .is_none()
    );
}

#[test]
fn generate_draft_refuses_approved_plan_without_replace_but_replaces_with_optin() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);
    let (first_plan, _) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();
    workspace_plan_approve_impl(&state, first_plan.id).unwrap();

    // Without opt-in: refuse rather than silently discard the approved plan.
    let mut replacement = draft_input();
    replacement.goal = "Replacement draft".into();
    replacement.steps.truncate(1);
    let err = workspace_plan_generate_draft_impl(&state, submitted.id, replacement.clone(), false)
        .unwrap_err();
    assert!(
        err.contains("already has approved plan"),
        "unexpected: {err}"
    );

    // With explicit replace_approved: replace the approved plan + its steps.
    let (second_plan, second_steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, replacement, true).unwrap();
    assert_eq!(second_plan.goal, "Replacement draft");
    assert_eq!(second_steps.len(), 1);
    assert_eq!(second_plan.status, "draft", "replacement starts as a draft");

    let db = state.db.lock().unwrap();
    let plans = plan::list(db.conn()).unwrap();
    assert_eq!(plans.len(), 1, "old approved plan should be gone");
    assert_eq!(plans[0].id, second_plan.id);
    assert_eq!(plans[0].goal, "Replacement draft");
}

#[test]
fn generate_draft_rejects_duplicate_step_slug() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);
    let mut input = draft_input();
    input.steps[1].step_id = input.steps[0].step_id.clone();

    let err = workspace_plan_generate_draft_impl(&state, submitted.id, input, false).unwrap_err();
    assert!(err.contains("duplicate step_id"));

    let db = state.db.lock().unwrap();
    assert!(plan::get_by_project(db.conn(), project_id)
        .unwrap()
        .is_none());
}

#[test]
fn discard_plan_removes_draft_plan_and_steps_but_keeps_interview() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);
    let (plan_row, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();
    assert_eq!(steps.len(), 2);

    workspace_plan_discard_plan_impl(&state, plan_row.id).unwrap();

    let db = state.db.lock().unwrap();
    assert!(plan::get_by_id(db.conn(), plan_row.id).unwrap().is_none());
    assert!(step::list_by_plan(db.conn(), plan_row.id)
        .unwrap()
        .is_empty());
    assert_eq!(
        interview::get_by_id(db.conn(), submitted.id)
            .unwrap()
            .unwrap()
            .status,
        "submitted"
    );
}

#[test]
fn approve_updates_linked_submitted_interview_status() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    seed_minimal_prd(&state, project_id);
    let (plan_row, _) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();

    let approved = workspace_plan_approve_impl(&state, plan_row.id).unwrap();
    assert_eq!(approved.status, "approved");

    let db = state.db.lock().unwrap();
    assert_eq!(
        interview::get_by_id(db.conn(), submitted.id)
            .unwrap()
            .unwrap()
            .status,
        "approved"
    );
}
