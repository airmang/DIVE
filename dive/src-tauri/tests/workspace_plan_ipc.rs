use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use async_trait::async_trait;
use dive_lib::auth::InMemoryKeyring;
use dive_lib::checkpoint::CheckpointEngine;
use dive_lib::db::dao::{
    card, event_log, interview, interview_turn, plan, plan_mutation, prd, project, session, step,
    step_session_mapping as mapping, workmap,
};
use dive_lib::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
    ArchitectureDecision, ArchitectureDecisionSource, ArchitectureForm, NewInterview,
    NewLiveProjectSpecDraft, NewPlan, NewProject, NewStep, ObjectionSuggestionStatus,
    PlanMutationType, PrdPatchValidationOutcome, ProjectSpecDelta, ProjectSpecDraft,
    ProjectSpecStatus, ProvenanceSource, StepRow,
};
use dive_lib::export::{ExportEngine, ExportOptions};
use dive_lib::ipc::workspace_plan::{
    roadmap_step_open_impl, roadmap_step_update_state_impl, workspace_plan_activity_impl,
    workspace_plan_append_step_impl, workspace_plan_append_step_with_options_impl,
    workspace_plan_append_steps_impl, workspace_plan_approve_impl,
    workspace_plan_challenge_step_rationale_impl, workspace_plan_current_draft_impl,
    workspace_plan_dashboard_impl, workspace_plan_discard_plan_impl,
    workspace_plan_generate_draft_impl, workspace_plan_list_steps_impl,
    workspace_plan_remove_step_impl, workspace_plan_respond_to_plan_adjustment_offer_impl,
    workspace_plan_route_cancel_impl, workspace_plan_route_chat_impl,
    workspace_plan_save_interview_answer_impl, workspace_plan_start_interview_impl,
    workspace_plan_status_impl, workspace_plan_step_mappings_impl,
    workspace_plan_submit_interview_impl, workspace_plan_supersede_step_impl,
    workspace_prd_draft_get_impl, workspace_prd_draft_save_impl, workspace_prd_get_impl,
    workspace_prd_interview_turn_impl, workspace_prd_save_impl, workspace_prd_status_impl,
    AcceptanceCriterionInput, AppendStepOptions, MultiStepDraftInput, PlanAdjustmentOfferResponse,
    PlanAdjustmentOfferResponseInput, PlanCritiqueResolution, PlanDraftInput, PrdDraftSaveInput,
    PrdInterviewConversationTurnInput, PrdInterviewTurnInput, PrdSaveInput, RouteDecision,
    StepDraftInput, StepRationaleChallengeInput, StepStateUpdateInput,
};
use dive_lib::{
    AppState, ChatEvent, ChatRequest, Database, FinishReason, LlmProvider, Message, ModelInfo,
    ProviderError,
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

fn seed_session(state: &AppState, project_id: i64) -> i64 {
    let db = state.db.lock().unwrap();
    session::insert(
        db.conn(),
        &dive_lib::db::models::NewSession {
            project_id,
            title: "Plan session".into(),
            ended_at: None,
            status: "active".into(),
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
            step_kind: Default::default(),
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
                step_kind: None,
                verification_command: Some("cargo test".into()),
                verification_type: Some("test".into()),
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
                step_kind: None,
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
        step_kind: None,
        verification_command: Some("pnpm test".into()),
        verification_type: Some("test".into()),
        dependencies,
        parallel_group: Some(1),
        position: 99,
        step_id: "ignored-by-append".into(),
    }
}

fn multi_draft(title: &str, depends_on_draft: Vec<usize>) -> MultiStepDraftInput {
    let mut draft = append_step_draft(vec![]);
    draft.title = title.into();
    draft.summary = format!("{title} summary");
    draft.instruction_seed = format!("Implement {title}");
    draft.expected_files = vec![format!("src/{title}.ts")];
    MultiStepDraftInput {
        draft,
        depends_on_draft,
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
        // S-047: a confirmable save now requires a decided architecture (form + stack).
        architecture: Some(ArchitectureDecision {
            form: ArchitectureForm::WebApp,
            form_other_label: None,
            stack: Some("React + Vite".into()),
            rationale: None,
            decision_source: ArchitectureDecisionSource::StudentConfirmed,
            decided_in_version: 1,
        }),
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

fn seed_minimal_prd_with_form(state: &AppState, project_id: i64, form: ArchitectureForm) {
    let mut draft = minimal_prd_draft(project_id);
    draft.architecture = Some(ArchitectureDecision {
        form,
        form_other_label: None,
        stack: Some("Confirmed stack".into()),
        rationale: None,
        decision_source: ArchitectureDecisionSource::StudentConfirmed,
        decided_in_version: 1,
    });
    workspace_prd_save_impl(
        state,
        PrdSaveInput {
            project_id,
            spec: draft,
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
                    architecture: None,
                    status: ProjectSpecStatus::Draft,
                },
                dirty_fields: vec!["goal".into()],
                student_edited_fields: vec!["goal".into()],
                last_patch_id: None,
                field_provenance: BTreeMap::new(),
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

#[test]
fn prd_save_reassigns_invalid_ac_zero_ids() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let mut draft = minimal_prd_draft(project_id);
    draft.acceptance_criteria[0].criterion_id = "AC-000".into();

    let saved = workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec: draft,
            reason: "interview".into(),
        },
    )
    .unwrap();

    assert_eq!(saved.acceptance_criteria[0].criterion_id, "AC-001");
}

#[test]
fn prd_save_allows_missing_optional_context_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let mut draft = minimal_prd_draft(project_id);
    draft.intent_summary = None;
    draft.scope.clear();

    let saved = workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec: draft,
            reason: "interview".into(),
        },
    )
    .unwrap();

    assert_eq!(saved.goal, "Build a PRD-backed roadmap");
    assert!(saved.intent_summary.is_none());
    assert!(saved.scope.is_empty());
}

#[test]
fn prd_save_rejects_missing_or_half_decided_architecture() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);

    // No architecture decided at all: the confirm/save backstop rejects it.
    let mut no_arch = minimal_prd_draft(project_id);
    no_arch.architecture = None;
    let err = workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec: no_arch,
            reason: "interview".into(),
        },
    )
    .unwrap_err();
    assert!(err.contains("architecture"), "unexpected error: {err}");

    // Form picked but no stack yet (the intermediate two-stage state) is also rejected.
    let mut form_only = minimal_prd_draft(project_id);
    form_only.architecture = Some(ArchitectureDecision {
        form: ArchitectureForm::CliTool,
        form_other_label: None,
        stack: None,
        rationale: None,
        decision_source: ArchitectureDecisionSource::StudentConfirmed,
        decided_in_version: 1,
    });
    let err = workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec: form_only,
            reason: "interview".into(),
        },
    )
    .unwrap_err();
    assert!(err.contains("architecture"), "unexpected error: {err}");
}

#[test]
fn prd_draft_get_and_save_restore_unsaved_authoring_state() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);

    let mut draft =
        workspace_prd_draft_get_impl(&state, project_id, Some("draft-autosave".into())).unwrap();
    draft.spec.goal = "Help teachers review missing submissions".into();
    draft.spec.intent_summary = Some("Turn a vague classroom need into a usable PRD.".into());
    draft.spec.scope = vec!["Show missing submissions".into()];
    draft.spec.acceptance_criteria = vec![prd_criterion("Teacher can see who has not submitted")];
    draft.dirty_fields = vec!["goal".into(), "acceptanceCriteria".into()];
    draft.student_edited_fields = vec!["goal".into()];
    // S-053 D3: the TS-side stamp (markDraftStudentEdited) round-trips through
    // this same draft-save IPC call — simulated here at the Rust level.
    draft
        .field_provenance
        .insert("goal".to_string(), ProvenanceSource::Student);

    let saved = workspace_prd_draft_save_impl(
        &state,
        PrdDraftSaveInput {
            project_id,
            draft: draft.clone(),
        },
    )
    .unwrap();
    assert_eq!(saved.draft_id, "draft-autosave");

    let restored =
        workspace_prd_draft_get_impl(&state, project_id, Some("draft-autosave".into())).unwrap();
    assert_eq!(
        restored.spec.goal,
        "Help teachers review missing submissions"
    );
    assert_eq!(restored.spec.scope, vec!["Show missing submissions"]);
    assert_eq!(restored.student_edited_fields, vec!["goal"]);
    assert_eq!(
        restored.spec.acceptance_criteria[0].text,
        "Teacher can see who has not submitted"
    );
    assert_eq!(
        restored.field_provenance.get("goal"),
        Some(&ProvenanceSource::Student)
    );
}

#[test]
fn prd_save_carries_draft_field_provenance_onto_confirmed_snapshot() {
    // S-053 D3: field_provenance lives on the outer LiveProjectSpecDraft, not on
    // the `spec` PrdSaveInput sends — workspace_prd_save_impl must look up the
    // persisted draft row itself for the confirmed ProjectSpec to carry it.
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);

    let mut draft = workspace_prd_draft_get_impl(&state, project_id, None).unwrap();
    draft.spec = minimal_prd_draft(project_id);
    draft
        .field_provenance
        .insert("goal".to_string(), ProvenanceSource::Student);
    draft
        .field_provenance
        .insert("scope".to_string(), ProvenanceSource::AiPatch);
    workspace_prd_draft_save_impl(&state, PrdDraftSaveInput { project_id, draft }).unwrap();

    let saved = workspace_prd_save_impl(
        &state,
        PrdSaveInput {
            project_id,
            spec: minimal_prd_draft(project_id),
            reason: "interview".into(),
        },
    )
    .unwrap();

    assert_eq!(
        saved.field_provenance.get("goal"),
        Some(&ProvenanceSource::Student)
    );
    assert_eq!(
        saved.field_provenance.get("scope"),
        Some(&ProvenanceSource::AiPatch)
    );

    // Confirming deletes the live draft; reopening the confirmed PRD for
    // further editing carries the recorded provenance forward (load_or_create,
    // pattern: `architecture`) instead of resetting to the legacy-empty map.
    let reopened = workspace_prd_draft_get_impl(&state, project_id, None).unwrap();
    assert_eq!(
        reopened.field_provenance.get("goal"),
        Some(&ProvenanceSource::Student)
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
            conversation: vec![
                PrdInterviewConversationTurnInput {
                    role: "assistant".into(),
                    text: "Who needs this first?".into(),
                },
                PrdInterviewConversationTurnInput {
                    role: "student".into(),
                    text: "Students doing Pomodoro sessions.".into(),
                },
            ],
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
    // S-053 D3: the applied scalar field is stamped ai_patch; acceptanceCriteria
    // keeps its own per-criterion `source` and is deliberately NOT duplicated
    // into this map.
    assert_eq!(
        turn.live_draft.field_provenance.get("goal"),
        Some(&ProvenanceSource::AiPatch)
    );
    assert!(!turn
        .live_draft
        .field_provenance
        .contains_key("acceptanceCriteria"));
    assert_eq!(
        prd::latest_version(state.db.lock().unwrap().conn(), project_id)
            .unwrap()
            .map(|row| row.version),
        None
    );
    let requests = provider.requests_snapshot();
    assert_eq!(requests[0].model, "mock-model");
    let system_prompt = match &requests[0].messages[0] {
        Message::System { content } => content,
        _ => panic!("expected PRD interview system prompt"),
    };
    assert!(system_prompt.contains("Assume the student has never written a PRD"));
    assert!(system_prompt.contains("gently lead the student"));
    assert!(system_prompt.contains("Do not run a fixed checklist"));
    assert!(system_prompt.contains("Use the same language as the student's answer"));
    // S-041 reworded the readiness guidance to mirror the real confirm gate: the
    // model only tells the student it is ready when the focus is ready_to_save.
    assert!(system_prompt.contains("ready_to_save is the PRD complete enough"));
    let user_prompt = match &requests[0].messages[1] {
        Message::User { content } => content,
        _ => panic!("expected PRD interview user prompt"),
    };
    assert!(user_prompt.contains("Missing fields required before PRD confirmation"));
    assert!(user_prompt.contains("Suggested next interview focus"));
    assert!(user_prompt.contains("clarify_goal_in_plain_language"));
    assert!(user_prompt.contains("Assistant: Who needs this first?"));
    assert!(user_prompt.contains("Student: Students doing Pomodoro sessions."));
    assert!(user_prompt.contains("Do not repeat a question that the student has already answered"));

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(events
        .iter()
        .any(|event| event.r#type == "prd_patch_proposed"));
    assert!(events
        .iter()
        .any(|event| event.r#type == "prd_patch_applied"));
}

#[tokio::test]
async fn prd_interview_turn_applies_text_aliases_for_prd_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                r#"{"assistantMessage":"I captured the first version shape.","patch":{"operations":[{"op":"set_goal","text":"Build a deadline tracker"},{"op":"set_intent_summary","text":"Students can see urgent assignments first"},{"op":"append_scope","text":"Show assignments due this week"},{"op":"append_constraint","text":"Use local project data only"},{"op":"append_acceptance_criterion","value":"Urgent assignments appear at the top"}],"rationale":"The answer named the user, goal, scope, constraint, and done state."}}"#
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
            draft_id: "draft-aliases".into(),
            answer: "Students need a local deadline tracker for this week's assignments.".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "applied");
    assert_eq!(
        turn.applied_field_paths,
        vec![
            "goal",
            "intentSummary",
            "scope",
            "constraints",
            "acceptanceCriteria"
        ]
    );
    assert_eq!(turn.live_draft.spec.goal, "Build a deadline tracker");
    assert_eq!(
        turn.live_draft.spec.intent_summary.as_deref(),
        Some("Students can see urgent assignments first")
    );
    assert_eq!(
        turn.live_draft.spec.scope,
        vec!["Show assignments due this week"]
    );
    assert_eq!(
        turn.live_draft.spec.constraints,
        vec!["Use local project data only"]
    );
    assert_eq!(
        turn.live_draft.spec.acceptance_criteria[0].criterion_id,
        "AC-001"
    );
    assert_eq!(
        turn.live_draft.spec.acceptance_criteria[0].text,
        "Urgent assignments appear at the top"
    );
    // S-053 D3: every applied scalar field is stamped ai_patch (not just the
    // first one), and acceptanceCriteria is still excluded from the map.
    for field in ["goal", "intentSummary", "scope", "constraints"] {
        assert_eq!(
            turn.live_draft.field_provenance.get(field),
            Some(&ProvenanceSource::AiPatch),
            "expected {field} to be stamped ai_patch"
        );
    }
    assert!(!turn
        .live_draft
        .field_provenance
        .contains_key("acceptanceCriteria"));
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
            conversation: Vec::new(),
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

#[tokio::test]
async fn prd_interview_turn_accepts_operation_alias_without_leaking_patch_json() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                r#"{"assistantMessage":"좋아요. 실행 환경은 다음에 하나만 고르면 돼요: 휴대폰에서만, 웹에서만, 둘 다 가능하게.","patch":{"operations":[{"operation":"set_goal","value":"사용자가 자신의 일정을 쉽게 관리할 수 있게 한다. 혼자 사용하는 개인 일정 관리 앱을 만든다."},{"operation":"set_intent_summary","value":"개인 사용자가 제목, 날짜, 시간, 간단한 메모를 기준으로 일정을 등록하고 확인할 수 있도록 한다."},{"operation":"append_scope","value":"혼자 사용하는 개인 일정 관리 앱"},{"operation":"append_acceptance_criterion","value":"사용자가 일정 등록 화면에서 제목, 날짜, 시간, 간단한 메모를 입력해 일정을 저장할 수 있다."}],"rationale":"사용자 답변에서 개인용 앱이라는 사용 맥락이 확인되어 목표와 의도를 구체화했습니다."}}"#
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
            draft_id: "draft-schedule".into(),
            answer: "혼자 쓰는 일정관리 앱이요".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "applied");
    assert!(!turn.assistant_message.contains("\"patch\""));
    assert!(!turn.assistant_message.contains("\"operation\""));
    assert!(turn.assistant_message.contains("실행 환경"));
    assert_eq!(
        turn.live_draft.spec.goal,
        "사용자가 자신의 일정을 쉽게 관리할 수 있게 한다. 혼자 사용하는 개인 일정 관리 앱을 만든다."
    );
    assert_eq!(
        turn.live_draft.spec.acceptance_criteria[0].text,
        "사용자가 일정 등록 화면에서 제목, 날짜, 시간, 간단한 메모를 입력해 일정을 저장할 수 있다."
    );
}

// S-053 D1: a structuring failure (no JSON at all, or JSON that decodes as
// neither response shape) gets a distinct `not_structured` outcome, an
// auditable `prd_patch_unstructured` EventLog event, and a durable
// InterviewTurn row — closing the audit hole where the exact turn a
// supervision-research log needs to capture previously left no trace at all.

#[tokio::test]
async fn prd_interview_turn_flags_no_json_response_as_not_structured() {
    let tmp = tempfile::tempdir().unwrap();
    // S-057: a structuring failure triggers ONE deterministic in-turn retry —
    // script both attempts failing so the final outcome is not_structured
    // with the combined flake history.
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![
            vec![
                ChatEvent::TextDelta("이 질문에 대해 조금 더 설명해 주시겠어요?".into()),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ],
            vec![
                ChatEvent::TextDelta("여전히 프로즈로만 답합니다.".into()),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ],
        ],
    );
    let project_id = seed_project(&state);

    let turn = workspace_prd_interview_turn_impl(
        &state,
        PrdInterviewTurnInput {
            project_id,
            draft_id: "draft-unstructured".into(),
            answer: "음, 잘 모르겠어요, 그냥 뭔가 만들고 싶어요".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "not_structured");
    assert!(turn.patch.is_none());
    assert!(turn.applied_field_paths.is_empty());

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let unstructured = events
        .iter()
        .find(|event| event.r#type == "prd_patch_unstructured")
        .expect("prd_patch_unstructured event logged");
    assert_eq!(unstructured.payload["project_id"], project_id);
    assert_eq!(unstructured.payload["draft_id"], "draft-unstructured");
    assert_eq!(unstructured.payload["turn_id"], turn.turn_id);
    assert_eq!(
        unstructured.payload["parse_failure_kind"],
        "no_json:retry_no_json"
    );
    assert_eq!(unstructured.payload["provider"], "mock");
    assert_eq!(unstructured.payload["model"], "mock-model");
    // No raw answer text or raw model response text in the EventLog payload.
    assert!(unstructured.payload.get("answer").is_none());
    assert!(unstructured.payload.get("raw").is_none());
    assert_eq!(unstructured.payload["agencyComponent"], "plan");
    // No PROPOSED/APPLIED/REJECTED events for a turn that never structured.
    assert!(!events
        .iter()
        .any(|event| event.r#type == "prd_patch_proposed"));

    let turns =
        interview_turn::list_by_draft(state.db.lock().unwrap().conn(), "draft-unstructured")
            .unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].turn_id, turn.turn_id);
    assert_eq!(
        turns[0].student_answer,
        "음, 잘 모르겠어요, 그냥 뭔가 만들고 싶어요"
    );
    assert_eq!(turns[0].outcome, PrdPatchValidationOutcome::NotStructured);
    assert_eq!(
        turns[0].parse_failure_kind.as_deref(),
        Some("no_json:retry_no_json")
    );
}

#[tokio::test]
async fn prd_interview_turn_flags_undecodable_json_response_as_not_structured() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![
            vec![
                ChatEvent::TextDelta(
                    r#"{"assistantMessage":"제가 응답 구조를 잘못 만들었어요.","patch":{"operations":"oops"}}"#
                        .into(),
                ),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ],
            vec![
                ChatEvent::TextDelta(
                    r#"{"assistantMessage":"또 잘못 만들었어요.","patch":{"operations":"oops"}}"#
                        .into(),
                ),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ],
        ],
    );
    let project_id = seed_project(&state);

    let turn = workspace_prd_interview_turn_impl(
        &state,
        PrdInterviewTurnInput {
            project_id,
            draft_id: "draft-undecodable".into(),
            answer: "Students need a way to track their reading list".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "not_structured");
    assert!(turn.patch.is_none());

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let unstructured = events
        .iter()
        .find(|event| event.r#type == "prd_patch_unstructured")
        .expect("prd_patch_unstructured event logged");
    assert_eq!(
        unstructured.payload["parse_failure_kind"],
        "undecodable_json:retry_undecodable_json"
    );

    let turns = interview_turn::list_by_draft(state.db.lock().unwrap().conn(), "draft-undecodable")
        .unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].outcome, PrdPatchValidationOutcome::NotStructured);
    assert_eq!(
        turns[0].parse_failure_kind.as_deref(),
        Some("undecodable_json:retry_undecodable_json")
    );
    assert_eq!(
        turns[0].student_answer,
        "Students need a way to track their reading list"
    );
}

// S-057 GO-gate fix: a nondeterministic contract violation (prose-only first
// reply) recovers via ONE deterministic in-turn retry; the audit trail keeps
// the flake history on the applied turn.
#[tokio::test]
async fn prd_interview_turn_recovers_via_in_turn_retry_after_no_json() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![
            vec![
                ChatEvent::TextDelta("일정 관리 앱이군요! 좋은 생각이에요. 이제 정리해 볼게요.".into()),
                ChatEvent::Done {
                    finish_reason: FinishReason::Length,
                },
            ],
            vec![
                ChatEvent::TextDelta(
                    r#"{"assistantMessage":"정리했어요.","patch":{"operations":[{"op":"set_goal","value":"사용자가 자신의 일정을 쉽게 관리할 수 있게 한다. 혼자 사용하는 개인 일정 관리 앱을 만든다."}],"rationale":"답변에서 목표가 확인되어 반영했습니다."}}"#
                        .into(),
                ),
                ChatEvent::Done {
                    finish_reason: FinishReason::Stop,
                },
            ],
        ],
    );
    let project_id = seed_project(&state);

    let turn = workspace_prd_interview_turn_impl(
        &state,
        PrdInterviewTurnInput {
            project_id,
            draft_id: "draft-recovered".into(),
            answer: "혼자 쓰는 일정관리 앱을 만들고 싶어요".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "applied");
    assert_eq!(
        turn.live_draft.spec.goal,
        "사용자가 자신의 일정을 쉽게 관리할 수 있게 한다. 혼자 사용하는 개인 일정 관리 앱을 만든다."
    );

    // No unstructured event — the turn ultimately structured; the flake lives
    // on the InterviewTurn row instead.
    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(!events
        .iter()
        .any(|event| event.r#type == "prd_patch_unstructured"));

    let turns =
        interview_turn::list_by_draft(state.db.lock().unwrap().conn(), "draft-recovered").unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].outcome, PrdPatchValidationOutcome::Applied);
    assert_eq!(
        turns[0].parse_failure_kind.as_deref(),
        Some("no_json_truncated:recovered")
    );
}

#[tokio::test]
async fn prd_interview_turn_leaves_genuine_none_turn_unflagged() {
    // The model answered (valid RawPrdTurnResponse shape) but proposed no
    // patch at all — a genuine net-zero turn, not a structuring failure. Must
    // stay "none" with no parse_failure_kind and no unstructured event, while
    // still getting a durable InterviewTurn row (S-053: every turn, not just
    // ones that changed something).
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                r#"{"assistantMessage":"이 부분은 다음에 더 알려주시겠어요?"}"#.into(),
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
            draft_id: "draft-genuine-none".into(),
            answer: "I'm not sure yet".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "none");
    assert!(turn.patch.is_none());

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(!events
        .iter()
        .any(|event| event.r#type == "prd_patch_unstructured"));

    let turns =
        interview_turn::list_by_draft(state.db.lock().unwrap().conn(), "draft-genuine-none")
            .unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].outcome, PrdPatchValidationOutcome::None);
    assert_eq!(turns[0].parse_failure_kind, None);
    assert_eq!(turns[0].student_answer, "I'm not sure yet");
}

#[tokio::test]
async fn prd_interview_turn_applied_patch_also_writes_interview_turn_row() {
    // S-053 D1: the InterviewTurn table is written for EVERY outcome,
    // including "applied" — not just failure turns.
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                r#"{"assistantMessage":"목표를 반영했어요.","patch":{"operations":[{"op":"set_goal","value":"Build a focus timer"}],"rationale":"목표를 추출했습니다."}}"#
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
            draft_id: "draft-applied-row".into(),
            answer: "A focus timer that shows a countdown".into(),
            conversation: Vec::new(),
            provider: "mock".into(),
            model: "mock-model".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(turn.validation_outcome, "applied");

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(!events
        .iter()
        .any(|event| event.r#type == "prd_patch_unstructured"));

    let turns = interview_turn::list_by_draft(state.db.lock().unwrap().conn(), "draft-applied-row")
        .unwrap();
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].outcome, PrdPatchValidationOutcome::Applied);
    assert_eq!(turns[0].parse_failure_kind, None);
    assert_eq!(
        turns[0].student_answer,
        "A focus timer that shows a countdown"
    );
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
            "verificationType": "test",
            "dependencies": [],
            "parallelGroup": null,
            "position": 1
        }]
    }))
    .unwrap();

    let (plan, steps) =
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

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let generated = events
        .iter()
        .find(|event| event.r#type == "plan_generated")
        .expect("draft generation should log plan_generated");
    assert_eq!(generated.session_id, None);
    assert_eq!(generated.payload["project_id"], json!(project_id));
    assert_eq!(generated.payload["plan_id"], json!(plan.id));
    assert_eq!(
        generated.payload["project_spec_id"],
        json!(format!("prd-{project_id}"))
    );
    assert_eq!(generated.payload["project_spec_version"], json!(1));
    assert_eq!(generated.payload["step_count"], json!(1));
    assert_eq!(generated.payload["source"], json!("interview"));
    assert_eq!(
        generated.payload["criterion_coverage"]["covered_criterion_ids"],
        json!(["AC-001"])
    );
    assert_eq!(
        generated.payload["criterion_coverage"]["step_links"][0]["stable_step_id"],
        json!("step-001")
    );
    assert_eq!(
        generated.payload["criterion_coverage"]["step_links"][0]["linked_criterion_ids"],
        json!(["AC-001"])
    );
}

#[test]
fn generate_draft_logs_form_consistency_annotation_without_blocking() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let session_id = seed_session(&state, project_id);
    seed_minimal_prd_with_form(&state, project_id, ArchitectureForm::CliTool);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    let mut input = draft_input();
    input.steps.truncate(1);
    input.steps[0].title = "Build browser UI".into();
    input.steps[0].summary = "Create a DOM page for the browser.".into();
    input.steps[0].instruction_seed = "Implement a React component with a button.".into();
    input.steps[0].expected_files = vec!["src/App.tsx".into()];
    input.steps[0].verification_command = None;
    input.steps[0].verification_type = Some("manual".into());

    let (plan, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, input, false).unwrap();

    assert_eq!(steps.len(), 1);
    let db = state.db.lock().unwrap();
    let events = event_log::list(db.conn()).unwrap();
    let annotation = events
        .iter()
        .find(|event| event.r#type == dive_lib::dive::event_log::PLAN_FORM_CONSISTENCY_EVENT)
        .expect("form consistency annotation should be logged");
    assert_eq!(annotation.session_id, Some(session_id));
    assert_eq!(annotation.payload["project_id"], json!(project_id));
    assert_eq!(annotation.payload["plan_id"], json!(plan.id));
    assert_eq!(annotation.payload["form"], json!("cli_tool"));
    assert_eq!(annotation.payload["step_id"], json!("step-001"));
    assert_eq!(annotation.payload["blocking"], json!(false));
    assert_eq!(annotation.payload["annotation"], json!(true));
    drop(db);

    let exported = ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &ExportOptions::default(), "test-salt")
        .unwrap();
    assert!(exported.contains("\"type\":\"plan.form_consistency\""));
    assert!(exported.contains("\"blocking\":false"));
}

// S-050 P3: marker-less non-junk criteria on an accepted draft are logged as
// `plan.criterion_quality_advisory` annotations, one per advisory, mirroring
// the form-consistency precedent above.
#[test]
fn generate_draft_logs_criterion_quality_advisories_for_marker_less_criteria() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let session_id = seed_session(&state, project_id);
    seed_minimal_prd(&state, project_id);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();

    let mut input = draft_input();
    input.steps[0]
        .acceptance_criteria
        .push(AcceptanceCriterionInput::Text(
            "The schema follows the existing project code style.".into(),
        ));
    input.steps[1]
        .acceptance_criteria
        .push(AcceptanceCriterionInput::Text(
            "The export step follows the existing project code style.".into(),
        ));

    let (plan, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, input, false).unwrap();
    assert_eq!(steps.len(), 2);

    let db = state.db.lock().unwrap();
    let events = event_log::list(db.conn()).unwrap();
    let advisories: Vec<_> = events
        .iter()
        .filter(|event| {
            event.r#type == dive_lib::dive::event_log::PLAN_CRITERION_QUALITY_ADVISORY_EVENT
        })
        .collect();

    // S-056 D2: `draft_input()`'s two steps both link AC-001 with the
    // identical criterion text "A saved PRD unlocks plan generation", so a
    // third advisory (`step_criterion_duplicate`) now rides alongside the
    // two `criterion_no_marker` ones this test adds.
    assert_eq!(advisories.len(), 3);
    for advisory in &advisories {
        assert_eq!(advisory.session_id, Some(session_id));
        assert_eq!(advisory.payload["project_id"], json!(project_id));
        assert_eq!(advisory.payload["plan_id"], json!(plan.id));
        assert_eq!(advisory.payload["blocking"], json!(false));
        assert_eq!(advisory.payload["annotation"], json!(true));
        assert_eq!(advisory.payload["agencyComponent"], json!("plan"));
    }
    let marker_less_advisories: Vec<_> = advisories
        .iter()
        .filter(|advisory| advisory.payload["code"] == json!("criterion_no_marker"))
        .collect();
    assert_eq!(marker_less_advisories.len(), 2);
    assert!(marker_less_advisories.iter().any(|advisory| {
        advisory.payload["step_ref"] == json!("Create schema")
            && advisory.payload["criterion_preview"]
                == json!("The schema follows the existing project code style.")
    }));
    assert!(marker_less_advisories.iter().any(|advisory| {
        advisory.payload["step_ref"] == json!("Export artifacts")
            && advisory.payload["criterion_preview"]
                == json!("The export step follows the existing project code style.")
    }));
    assert!(advisories.iter().any(|advisory| {
        advisory.payload["code"] == json!("step_criterion_duplicate")
            && advisory.payload["step_ref"] == json!("Export artifacts")
            && advisory.payload["criterion_preview"] == json!("A saved PRD unlocks plan generation")
    }));
    drop(db);

    let exported = ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &ExportOptions::default(), "test-salt")
        .unwrap();
    assert!(exported.contains("\"type\":\"plan.criterion_quality_advisory\""));
}

// S-050 P3: a draft where every criterion carries an observable marker (the
// default `draft_input()` fixture) logs zero `criterion_no_marker` advisory
// events. S-056 D2: that same fixture links AC-001 with the identical
// criterion text on both of its steps, so it now also logs exactly one
// `step_criterion_duplicate` advisory — the cross-step check working as
// designed, not a marker-quality finding.
#[test]
fn generate_draft_logs_zero_marker_less_advisories_when_all_criteria_carry_markers() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    seed_session(&state, project_id);
    seed_minimal_prd(&state, project_id);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();

    let (_plan, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input(), false).unwrap();
    assert_eq!(steps.len(), 2);

    let db = state.db.lock().unwrap();
    let events = event_log::list(db.conn()).unwrap();
    let advisories: Vec<_> = events
        .iter()
        .filter(|event| {
            event.r#type == dive_lib::dive::event_log::PLAN_CRITERION_QUALITY_ADVISORY_EVENT
        })
        .collect();

    assert_eq!(advisories.len(), 1);
    assert!(!advisories
        .iter()
        .any(|advisory| advisory.payload["code"] == json!("criterion_no_marker")));
    assert!(advisories.iter().any(|advisory| {
        advisory.payload["code"] == json!("step_criterion_duplicate")
            && advisory.payload["step_ref"] == json!("Export artifacts")
            && advisory.payload["criterion_preview"] == json!("A saved PRD unlocks plan generation")
    }));
}

// S-050 P3: a blocked draft (junk criterion trips the P1 gate before the
// draft is ever persisted) must not log any advisory events.
#[test]
fn generate_draft_blocked_by_junk_criterion_logs_no_advisory_events() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    seed_session(&state, project_id);
    seed_minimal_prd(&state, project_id);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();

    let mut input = draft_input();
    input.acceptance_criteria = vec![AcceptanceCriterionInput::Text("적당히 잘".into())];

    let result = workspace_plan_generate_draft_impl(&state, submitted.id, input, false);
    assert!(result.is_err());

    let db = state.db.lock().unwrap();
    let events = event_log::list(db.conn()).unwrap();
    let advisory_count = events
        .iter()
        .filter(|event| {
            event.r#type == dive_lib::dive::event_log::PLAN_CRITERION_QUALITY_ADVISORY_EVENT
        })
        .count();
    assert_eq!(advisory_count, 0);
}

// S-056 D2: the two new cross-step advisories (`step_expected_file_overlap`,
// `step_criterion_duplicate`) reach the EventLog as
// `plan.criterion_quality_advisory` annotations for an accepted draft,
// exactly like the S-050 P3 marker-less advisories above.
#[test]
fn generate_draft_logs_step_overlap_advisories_for_accepted_draft() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let session_id = seed_session(&state, project_id);
    seed_minimal_prd(&state, project_id);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();

    let mut input = draft_input();
    // draft_input()'s two steps already share the identical AC-001 criterion
    // text (exercises step_criterion_duplicate); additionally overlap their
    // expected_files, differing only in case/whitespace, to exercise
    // step_expected_file_overlap in the same accepted draft.
    input.steps[0].expected_files = vec!["src/shared.ts".into()];
    input.steps[1].expected_files = vec!["  SRC/Shared.ts  ".into()];

    let (plan, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, input, false).unwrap();
    assert_eq!(steps.len(), 2);

    let db = state.db.lock().unwrap();
    let events = event_log::list(db.conn()).unwrap();
    let advisories: Vec<_> = events
        .iter()
        .filter(|event| {
            event.r#type == dive_lib::dive::event_log::PLAN_CRITERION_QUALITY_ADVISORY_EVENT
        })
        .collect();

    for advisory in &advisories {
        assert_eq!(advisory.session_id, Some(session_id));
        assert_eq!(advisory.payload["project_id"], json!(project_id));
        assert_eq!(advisory.payload["plan_id"], json!(plan.id));
        assert_eq!(advisory.payload["blocking"], json!(false));
        assert_eq!(advisory.payload["annotation"], json!(true));
        assert_eq!(advisory.payload["agencyComponent"], json!("plan"));
    }
    assert!(advisories.iter().any(|advisory| {
        advisory.payload["code"] == json!("step_criterion_duplicate")
            && advisory.payload["step_ref"] == json!("Export artifacts")
            && advisory.payload["criterion_preview"] == json!("A saved PRD unlocks plan generation")
    }));
    assert!(advisories.iter().any(|advisory| {
        advisory.payload["code"] == json!("step_expected_file_overlap")
            && advisory.payload["step_ref"] == json!("Export artifacts")
            && advisory.payload["criterion_preview"] == json!("src/shared.ts")
    }));
    drop(db);

    let exported = ExportEngine::new(state.db.clone())
        .export_session_with_salt(session_id, &ExportOptions::default(), "test-salt")
        .unwrap();
    // The export anonymizer hashes the `code`/path-shaped `criterion_preview`
    // fields (same as every other event payload), so — matching the S-050 P3
    // export assertion above — this only checks that both advisory events
    // (not just one) reached the exported JSONL, not their redacted content.
    let advisory_line_count = exported
        .lines()
        .filter(|line| line.contains("\"type\":\"plan.criterion_quality_advisory\""))
        .count();
    assert_eq!(advisory_line_count, 2);
}

#[test]
fn challenging_step_rationale_offers_plan_adjustment_without_blocking_start() {
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

    assert_eq!(result.suggestion_status, "offered");
    assert!(result.objection_id.starts_with("obj-"));
    assert!(!result.offer_id.trim().is_empty());
    assert!(matches!(
        result.offer_kind.as_str(),
        "redecompose_step" | "adjust_plan"
    ));
    assert!(!result.message.trim().is_empty());

    let output_json = serde_json::to_value(&result).unwrap();
    assert_eq!(output_json["suggestionStatus"], json!("offered"));
    assert_eq!(output_json["offerId"], json!(&result.offer_id));
    assert_eq!(output_json["offerKind"], json!(&result.offer_kind));
    assert_eq!(output_json["message"], json!(&result.message));

    let objections =
        plan_mutation::list_objections_by_plan(state.db.lock().unwrap().conn(), plan_id).unwrap();
    assert_eq!(objections.len(), 1);
    assert_eq!(objections[0].objection_id, result.objection_id);
    assert_eq!(
        objections[0].suggestion_status,
        ObjectionSuggestionStatus::Offered
    );

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let challenged = events
        .iter()
        .find(|event| event.r#type == "plan_step_rationale_challenged")
        .expect("challenge flow should log plan_step_rationale_challenged");
    assert_eq!(challenged.payload["project_id"], json!(project_id));
    assert_eq!(challenged.payload["plan_id"], json!(plan_id));
    assert_eq!(challenged.payload["step_id"], json!(step_id));
    assert_eq!(challenged.payload["stable_step_id"], json!("step-001"));
    assert_eq!(
        challenged.payload["linked_criterion_ids"],
        json!(["AC-001"])
    );
    assert_eq!(
        challenged.payload["objection_id"],
        json!(&result.objection_id)
    );
    assert_eq!(challenged.payload["suggestion_status"], json!("offered"));

    let offered = events
        .iter()
        .find(|event| event.r#type == "plan_adjustment_offered")
        .expect("challenge flow should log plan_adjustment_offered");
    assert_eq!(offered.payload["project_id"], json!(project_id));
    assert_eq!(offered.payload["plan_id"], json!(plan_id));
    assert_eq!(offered.payload["step_id"], json!(step_id));
    assert_eq!(offered.payload["stable_step_id"], json!("step-001"));
    assert_eq!(offered.payload["objection_id"], json!(&result.objection_id));
    assert_eq!(offered.payload["offer_id"], json!(&result.offer_id));
    assert_eq!(offered.payload["offer_kind"], json!(&result.offer_kind));
    assert!(!offered.payload["offer_summary"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .is_empty());

    let opened = roadmap_step_open_impl(&state, step_id).unwrap();
    assert_eq!(opened.step_id, step_id);
}

#[test]
fn responding_to_plan_adjustment_offer_updates_status_without_plan_mutation() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let step_id = insert_step(&state, plan_id, "step-001", &[]);

    let accepted_challenge = workspace_plan_challenge_step_rationale_impl(
        &state,
        StepRationaleChallengeInput {
            plan_id,
            step_db_id: step_id,
            text: "이 단계를 더 작게 나눌 수 있을 것 같아요.".into(),
            linked_criterion_ids: vec!["AC-001".into()],
        },
    )
    .unwrap();

    let accepted = workspace_plan_respond_to_plan_adjustment_offer_impl(
        &state,
        PlanAdjustmentOfferResponseInput {
            plan_id,
            step_db_id: step_id,
            objection_id: accepted_challenge.objection_id.clone(),
            offer_id: accepted_challenge.offer_id.clone(),
            response: PlanAdjustmentOfferResponse::Accepted,
        },
    )
    .unwrap();

    assert_eq!(accepted.objection_id, accepted_challenge.objection_id);
    assert_eq!(accepted.offer_id, accepted_challenge.offer_id);
    assert_eq!(accepted.suggestion_status, "accepted");

    let objections =
        plan_mutation::list_objections_by_plan(state.db.lock().unwrap().conn(), plan_id).unwrap();
    assert_eq!(
        objections
            .iter()
            .find(|objection| objection.objection_id == accepted_challenge.objection_id)
            .unwrap()
            .suggestion_status,
        ObjectionSuggestionStatus::Accepted
    );
    assert!(
        plan_mutation::list_mutations_by_plan(state.db.lock().unwrap().conn(), plan_id)
            .unwrap()
            .is_empty(),
        "accepting an offer must only route to plan review state"
    );

    std::thread::sleep(Duration::from_millis(1));
    let dismissed_challenge = workspace_plan_challenge_step_rationale_impl(
        &state,
        StepRationaleChallengeInput {
            plan_id,
            step_db_id: step_id,
            text: "일단 현재 계획으로 진행할게요.".into(),
            linked_criterion_ids: vec!["AC-001".into()],
        },
    )
    .unwrap();

    let dismissed = workspace_plan_respond_to_plan_adjustment_offer_impl(
        &state,
        PlanAdjustmentOfferResponseInput {
            plan_id,
            step_db_id: step_id,
            objection_id: dismissed_challenge.objection_id.clone(),
            offer_id: dismissed_challenge.offer_id.clone(),
            response: PlanAdjustmentOfferResponse::Dismissed,
        },
    )
    .unwrap();
    assert_eq!(dismissed.suggestion_status, "dismissed");

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let accepted_event = events
        .iter()
        .find(|event| event.r#type == "plan_adjustment_accepted")
        .expect("accepting an offer should log plan_adjustment_accepted");
    assert_eq!(
        accepted_event.payload["objection_id"],
        json!(&accepted_challenge.objection_id)
    );
    assert_eq!(
        accepted_event.payload["offer_id"],
        json!(&accepted_challenge.offer_id)
    );
    assert_eq!(accepted_event.payload["response"], json!("accepted"));

    let dismissed_event = events
        .iter()
        .find(|event| event.r#type == "plan_adjustment_dismissed")
        .expect("dismissing an offer should log plan_adjustment_dismissed");
    assert_eq!(
        dismissed_event.payload["objection_id"],
        json!(&dismissed_challenge.objection_id)
    );
    assert_eq!(
        dismissed_event.payload["offer_id"],
        json!(&dismissed_challenge.offer_id)
    );
    assert_eq!(dismissed_event.payload["response"], json!("dismissed"));

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
            ChatEvent::TextDelta("ROUTE add_step title=\"Add authentication\" summary=\"Add sign-in and session handling.\" instruction_seed=\"Implement authentication flows.\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Users can sign in.\"] verification_type=\"test\" verification_command=\"pnpm test\" dependencies=[\"step-001\"] parallel_group=1 reason=\"new implementation request\"".into()),
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
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        2,
        "routing may draft add_step but must not mutate the plan"
    );
}

#[tokio::test]
async fn route_chat_routes_duplicate_into_duplicate_outcome() {
    // S-033 P7: a router add that collides with an existing active step now
    // surfaces a typed Duplicate outcome (carrying the matched step ref + the
    // rejected draft) instead of a silent Chat downgrade. Still propose-only.
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
        RouteDecision::Duplicate {
            existing,
            draft,
            reason,
        } => {
            assert_eq!(existing.step_id, "step-001");
            assert!(reason.contains("already covered by step-001"));
            // The rejected draft is carried so the P8 UI can show what collided.
            assert_eq!(draft.title, "Step step-001");
        }
        other => panic!("expected duplicate outcome, got {other:?}"),
    }
    // Propose-only: the colliding add never mutates the plan.
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn route_decision_duplicate_serializes_with_snake_case_action_and_camel_payload() {
    // Locks the TS contract: action string + camelCase StepRefPayload. The wire
    // enum is Serialize-only (serde(tag = "action", rename_all = "snake_case")),
    // so this asserts the serialized shape, not a round-trip.
    let value = serde_json::to_value(RouteDecision::Duplicate {
        existing: dive_lib::ipc::workspace_plan::StepRefPayload {
            step_id: "step-001".into(),
            db_id: 7,
            title: "Existing step".into(),
        },
        draft: Box::new(append_step_draft(Vec::new())),
        reason: "already covered by step-001: Existing step".into(),
    })
    .unwrap();

    assert_eq!(value["action"], "duplicate");
    assert_eq!(value["existing"]["stepId"], "step-001");
    assert_eq!(value["existing"]["dbId"], 7);
    assert_eq!(value["existing"]["title"], "Existing step");
    // camelCase StepDraftInput carried through (locks the TS draft contract).
    assert_eq!(value["draft"]["stepId"], "ignored-by-append");
    assert_eq!(value["draft"]["title"], "Add authentication");
    assert_eq!(
        value["reason"],
        "already covered by step-001: Existing step"
    );
}

#[tokio::test]
async fn route_chat_parses_multi_step_into_multi_step_without_mutating() {
    // S-033 P8a: a genuinely multi-part ask fans into a RouteDecision::MultiStep
    // carrying placeholder-id drafts + sibling-index deps. Propose-only: the apply
    // IPC (append_steps) owns topo ordering + id allocation when the P8b UI runs.
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta("ROUTE multi_step {\"reason\":\"scaffold then wire\",\"steps\":[{\"title\":\"Skeleton\",\"summary\":\"Create module.\",\"instruction_seed\":\"Add module.\",\"expected_files\":[\"src/a.ts\"],\"acceptance_criteria\":[\"compiles\"],\"verification_type\":\"run\",\"verification_command\":\"pnpm build\",\"dependencies\":[],\"parallel_group\":null,\"depends_on\":[]},{\"title\":\"Wire\",\"summary\":\"Wire it.\",\"instruction_seed\":\"Wire module.\",\"expected_files\":[\"src/b.ts\"],\"acceptance_criteria\":[\"works\"],\"verification_type\":\"preview\",\"verification_command\":\"\",\"dependencies\":[\"step-001\"],\"parallel_group\":null,\"depends_on\":[0]},{\"title\":\"Test\",\"summary\":\"Cover it.\",\"instruction_seed\":\"Add tests.\",\"expected_files\":[\"src/c.ts\"],\"acceptance_criteria\":[\"green\"],\"verification_type\":\"test\",\"verification_command\":\"pnpm test\",\"dependencies\":[],\"parallel_group\":null,\"depends_on\":[0]}]}".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision = workspace_plan_route_chat_impl(
        &state,
        project_id,
        "auth 골격 만들고 로그인 붙이고 테스트까지 추가해줘".into(),
        None,
    )
    .await
    .unwrap();

    match decision {
        RouteDecision::MultiStep { drafts, reason } => {
            assert_eq!(reason, "scaffold then wire");
            assert_eq!(drafts.len(), 3);
            // Sibling-index deps preserved; the apply IPC rewrites them later.
            assert_eq!(drafts[0].depends_on_draft, Vec::<usize>::new());
            assert_eq!(drafts[1].depends_on_draft, vec![0]);
            assert_eq!(drafts[2].depends_on_draft, vec![0]);
            assert_eq!(drafts[1].draft.title, "Wire");
            // No pre-allocation: step_id/position are placeholders (append_steps
            // owns allocation), and an empty verification_command is normalized.
            assert_eq!(drafts[1].draft.step_id, "");
            assert_eq!(drafts[1].draft.position, 0);
            assert_eq!(drafts[1].draft.verification_command, None);
            assert_eq!(drafts[1].draft.dependencies, vec!["step-001"]);
        }
        other => panic!("expected multi_step decision, got {other:?}"),
    }
    // Propose-only: the fan-out never mutates the plan.
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn route_decision_multi_step_serializes_with_snake_case_action_and_camel_payload() {
    // Locks the TS contract for the appendSteps wire: action="multi_step" and
    // camelCase MultiStepDraftInput (dependsOnDraft + draft.stepId). Serialize-only.
    let value = serde_json::to_value(RouteDecision::MultiStep {
        drafts: vec![
            multi_draft("Skeleton", Vec::new()),
            multi_draft("Wire", vec![0]),
        ],
        reason: "scaffold then wire".into(),
    })
    .unwrap();

    assert_eq!(value["action"], "multi_step");
    assert_eq!(value["reason"], "scaffold then wire");
    // Sibling-index dep serializes as a number array under the camelCase key.
    assert_eq!(value["drafts"][1]["dependsOnDraft"][0], 0);
    assert_eq!(value["drafts"][1]["draft"]["title"], "Wire");
    assert_eq!(value["drafts"][0]["draft"]["stepId"], "ignored-by-append");
}

#[tokio::test]
async fn route_chat_parses_remove_into_remove_step_without_mutating() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                "ROUTE remove target_step_id=\"step-001\" reason=\"obsolete after pivot\"".into(),
            ),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision = workspace_plan_route_chat_impl(&state, project_id, "1단계 빼줘".into(), None)
        .await
        .unwrap();

    match decision {
        RouteDecision::RemoveStep { target, reason } => {
            assert_eq!(target.step_id, "step-001");
            assert_eq!(reason, "obsolete after pivot");
        }
        other => panic!("expected remove_step decision, got {other:?}"),
    }
    // Routing only proposes — the step stays active until the user confirms.
    let steps = workspace_plan_list_steps_impl(&state, plan_id).unwrap();
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0].status, "active");
}

#[tokio::test]
async fn route_chat_remove_unknown_target_degrades_to_skip() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta(
                "ROUTE remove target_step_id=\"step-999\" reason=\"drop it\"".into(),
            ),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision = workspace_plan_route_chat_impl(&state, project_id, "9단계 빼줘".into(), None)
        .await
        .unwrap();

    match decision {
        RouteDecision::Skip { reason } => {
            assert!(
                reason.contains("step-999"),
                "unexpected skip reason: {reason}"
            );
        }
        other => panic!("expected skip for unknown target, got {other:?}"),
    }
}

#[tokio::test]
async fn route_chat_parses_supersede_into_supersede_step() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta("ROUTE supersede target_step_id=\"step-001\" title=\"Rework auth\" summary=\"Replace the auth step.\" instruction_seed=\"Redo authentication.\" expected_files=[\"src/auth.ts\"] acceptance_criteria=[\"Users can sign in.\"] verification_type=\"test\" verification_command=\"pnpm test\" dependencies=[] parallel_group=null reason=\"replace step\"".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision =
        workspace_plan_route_chat_impl(&state, project_id, "1단계 갈아끼워줘".into(), None)
            .await
            .unwrap();

    match decision {
        RouteDecision::SupersedeStep {
            target,
            replacement,
            reason,
        } => {
            assert_eq!(target.step_id, "step-001");
            assert_eq!(reason, "replace step");
            assert_eq!(replacement.title, "Rework auth");
        }
        other => panic!("expected supersede_step decision, got {other:?}"),
    }
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn route_chat_parses_clarify() {
    let tmp = tempfile::tempdir().unwrap();
    let (state, _provider) = mk_state_with_scripts(
        &tmp,
        vec![vec![
            ChatEvent::TextDelta("ROUTE clarify question=\"Which page needs the nav?\" candidate_intent=\"add nav\" suggested_criterion_ids=[\"ac-1\"] reason=\"ambiguous target\"".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ]],
    );
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let decision = workspace_plan_route_chat_impl(&state, project_id, "네비 추가해줘".into(), None)
        .await
        .unwrap();

    match decision {
        RouteDecision::Clarify {
            question,
            candidate_intent,
            suggested_criterion_ids,
            ..
        } => {
            assert_eq!(question, "Which page needs the nav?");
            assert_eq!(candidate_intent, "add nav");
            assert_eq!(suggested_criterion_ids, vec!["ac-1".to_string()]);
        }
        other => panic!("expected clarify decision, got {other:?}"),
    }
}

#[tokio::test]
async fn remove_step_soft_hides_from_active_plan_but_retains_history_and_logs_event() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let s1 = insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &[]);

    workspace_plan_remove_step_impl(&state, plan_id, s1, Some("obsolete after pivot".into()))
        .unwrap();

    // Active plan view excludes the removed step.
    let active = workspace_plan_list_steps_impl(&state, plan_id).unwrap();
    assert_eq!(
        active
            .iter()
            .map(|s| s.step_id.as_str())
            .collect::<Vec<_>>(),
        vec!["step-002"],
    );

    // History retains the row as 'removed' (so removed step_ids stay reserved).
    let removed = step::get_by_id(state.db.lock().unwrap().conn(), s1)
        .unwrap()
        .unwrap();
    assert_eq!(removed.status, "removed");

    // The retire event is logged for export.
    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(
        events.iter().any(|e| e.r#type == "plan_step_retired"),
        "expected a plan_step_retired event"
    );
}

#[tokio::test]
async fn remove_step_with_active_dependent_is_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let s1 = insert_step(&state, plan_id, "step-001", &[]);
    insert_step(&state, plan_id, "step-002", &["step-001"]);

    let err = workspace_plan_remove_step_impl(&state, plan_id, s1, None).unwrap_err();
    assert!(err.contains("depends on it"), "unexpected error: {err}");

    // The plan is untouched — both steps stay active.
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn remove_step_rejects_unapproved_plan_and_already_removed_step() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);

    // An unapproved (draft) plan rejects removal. (One plan per project, so use
    // distinct projects for the two scenarios.)
    let draft_project = seed_project_named(&state, "Draft Project", "/tmp/draft-project");
    let draft_plan = seed_plan(&state, draft_project, "draft");
    let ds = insert_step(&state, draft_plan, "step-001", &[]);
    assert!(workspace_plan_remove_step_impl(&state, draft_plan, ds, None).is_err());

    // On an approved plan, removing the same step twice rejects the second.
    let approved_project = seed_project_named(&state, "Approved Project", "/tmp/approved-project");
    let plan_id = seed_plan(&state, approved_project, "approved");
    let s1 = insert_step(&state, plan_id, "step-001", &[]);
    workspace_plan_remove_step_impl(&state, plan_id, s1, None).unwrap();
    let err = workspace_plan_remove_step_impl(&state, plan_id, s1, None).unwrap_err();
    assert!(err.contains("not active"), "unexpected error: {err}");
}

#[tokio::test]
async fn supersede_step_replaces_target_atomically_and_links_replacement() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let s1 = insert_step(&state, plan_id, "step-001", &[]);

    let new_row = workspace_plan_supersede_step_impl(
        &state,
        plan_id,
        s1,
        append_step_draft(vec![]),
        AppendStepOptions {
            mutation_reason: Some("rework the auth step".into()),
            linked_criterion_ids: Vec::new(),
            prd_delta: None,
        },
    )
    .unwrap();

    // The active plan now shows only the replacement.
    let active = workspace_plan_list_steps_impl(&state, plan_id).unwrap();
    assert_eq!(
        active
            .iter()
            .map(|s| s.step_id.as_str())
            .collect::<Vec<_>>(),
        vec![new_row.step_id.as_str()],
    );

    // The target is superseded and points at the replacement.
    let target = step::get_by_id(state.db.lock().unwrap().conn(), s1)
        .unwrap()
        .unwrap();
    assert_eq!(target.status, "superseded");
    assert_eq!(
        target.superseded_by_step_id.as_deref(),
        Some(new_row.step_id.as_str())
    );

    // Both the append and the change events are logged for export.
    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    assert!(events.iter().any(|e| e.r#type == "plan_step_appended"));
    assert!(events.iter().any(|e| e.r#type == "plan_step_changed"));
}

#[tokio::test]
async fn supersede_step_rejects_inactive_target_without_partial_insert() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let s1 = insert_step(&state, plan_id, "step-001", &[]);

    // Remove the step so it is inactive; a later supersede must fail cleanly.
    workspace_plan_remove_step_impl(&state, plan_id, s1, None).unwrap();
    let err = workspace_plan_supersede_step_impl(
        &state,
        plan_id,
        s1,
        append_step_draft(vec![]),
        AppendStepOptions::default(),
    )
    .unwrap_err();
    assert!(err.contains("not active"), "unexpected error: {err}");

    // The failed supersede inserted no replacement (active plan is empty).
    assert!(workspace_plan_list_steps_impl(&state, plan_id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn append_steps_fans_out_in_dependency_order_and_rewrites_sibling_deps() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");

    // Page A (root) <- Nav (depends on A) <- Link (depends on Nav).
    let rows = workspace_plan_append_steps_impl(
        &state,
        plan_id,
        vec![
            multi_draft("PageA", vec![]),
            multi_draft("Nav", vec![0]),
            multi_draft("Link", vec![1]),
        ],
        AppendStepOptions::default(),
    )
    .unwrap();

    assert_eq!(rows.len(), 3);
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        3
    );

    // Inserted in DAG order; sibling indices were rewritten to real step_ids.
    let deps = |row: &StepRow| -> Vec<String> {
        serde_json::from_value(row.dependencies.clone().unwrap_or(serde_json::json!([]))).unwrap()
    };
    assert!(deps(&rows[1]).contains(&rows[0].step_id)); // Nav depends on PageA
    assert!(deps(&rows[2]).contains(&rows[1].step_id)); // Link depends on Nav
}

#[tokio::test]
async fn append_steps_rejects_dependency_cycle_with_no_partial_insert() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");

    let err = workspace_plan_append_steps_impl(
        &state,
        plan_id,
        vec![multi_draft("A", vec![1]), multi_draft("B", vec![0])],
        AppendStepOptions::default(),
    )
    .unwrap_err();
    assert!(err.contains("cycle"), "unexpected error: {err}");
    assert!(workspace_plan_list_steps_impl(&state, plan_id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn append_steps_rejects_envelope_overflow_up_front() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    for n in 1..=7 {
        insert_step(&state, plan_id, &format!("step-{n:03}"), &[]);
    }

    // 7 existing + 2 new = 9 > MAX (8): rejected before any insert.
    let err = workspace_plan_append_steps_impl(
        &state,
        plan_id,
        vec![multi_draft("X", vec![]), multi_draft("Y", vec![])],
        AppendStepOptions::default(),
    )
    .unwrap_err();
    assert!(err.contains("envelope"), "unexpected error: {err}");
    assert_eq!(
        workspace_plan_list_steps_impl(&state, plan_id)
            .unwrap()
            .len(),
        7
    );
}

#[tokio::test]
async fn append_steps_rejects_intra_batch_duplicate() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");

    // Two drafts that normalize to the same step: the second collides once the
    // first is visible inside the batch transaction.
    let err = workspace_plan_append_steps_impl(
        &state,
        plan_id,
        vec![multi_draft("Same", vec![]), multi_draft("Same", vec![])],
        AppendStepOptions::default(),
    )
    .unwrap_err();
    assert!(err.contains("already exists"), "unexpected error: {err}");
    assert!(workspace_plan_list_steps_impl(&state, plan_id)
        .unwrap()
        .is_empty());
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
fn append_step_creates_auto_pre_pivot_checkpoint_for_linked_session() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    let step_id = insert_step(&state, plan_id, "step-001", &[]);
    let opened = roadmap_step_open_impl(&state, step_id).unwrap();
    let session_id = opened.session_id.unwrap();
    let engine = CheckpointEngine::new(tmp.path(), state.db.clone());
    engine.init().unwrap();
    std::fs::write(tmp.path().join("before-plan-change.txt"), "dirty").unwrap();

    workspace_plan_append_step_impl(&state, plan_id, append_step_draft(vec!["step-001".into()]))
        .unwrap();

    let checkpoints = engine.list_checkpoints(session_id).unwrap();
    let pre_pivot = checkpoints
        .iter()
        .find(|row| row.kind == "auto-pre-pivot")
        .expect("append step should create a pre-pivot checkpoint");
    assert!(pre_pivot.label.is_none());
    assert!(pre_pivot.session_state_snapshot.is_some());
    assert!(pre_pivot
        .changed_files
        .contains(&"before-plan-change.txt".to_string()));
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
fn append_step_records_mutation_prd_delta_and_event_payload() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    seed_minimal_prd(&state, project_id);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let mut draft = append_step_draft(vec!["step-001".into()]);
    draft.title = "Add mutation export".into();
    draft.summary = "Persist added-step mutation reconstruction data.".into();
    draft.instruction_seed = "Write mutation export fields into the artifact.".into();
    draft.expected_files = vec!["src/features/planning/export.ts".into()];
    draft.acceptance_criteria = vec![AcceptanceCriterionInput::Text(
        "Added steps are reconstructable from export".into(),
    )];
    draft.linked_criterion_ids = vec!["AC-001".into()];
    draft.rationale = Some("The export step preserves AC-001 evidence after mutation.".into());

    let prd_delta = ProjectSpecDelta {
        from_version: 1,
        to_version: 2,
        added_criteria: vec![AcceptanceCriterion {
            criterion_id: "AC-002".into(),
            text: "Added steps are reconstructable from export".into(),
            source: AcceptanceCriterionSource::PlanMutation,
            status: AcceptanceCriterionStatus::Active,
            created_in_version: 2,
            retired_in_version: None,
        }],
        retired_criterion_ids: vec![],
        scope_changes: vec!["Mutation export".into()],
        non_goal_changes: vec![],
    };

    let row = workspace_plan_append_step_with_options_impl(
        &state,
        plan_id,
        draft,
        AppendStepOptions {
            mutation_reason: Some("Verification revealed export reconstruction was missing".into()),
            linked_criterion_ids: vec!["AC-001".into()],
            prd_delta: Some(prd_delta.clone()),
        },
    )
    .unwrap();

    assert_eq!(row.step_id, "step-002");
    assert_eq!(
        row.acceptance_criteria.as_ref().unwrap()["linkedCriterionIds"],
        json!(["AC-001"])
    );
    assert_eq!(
        row.acceptance_criteria.as_ref().unwrap()["rationale"],
        "The export step preserves AC-001 evidence after mutation."
    );

    let db = state.db.lock().unwrap();
    let latest_prd = prd::latest_version(db.conn(), project_id).unwrap().unwrap();
    assert_eq!(latest_prd.version, 2);
    assert_eq!(latest_prd.previous_version, Some(1));
    assert_eq!(latest_prd.snapshot.current_version, 2);
    assert!(latest_prd
        .snapshot
        .scope
        .iter()
        .any(|item| item == "Mutation export"));
    assert!(latest_prd
        .snapshot
        .acceptance_criteria
        .iter()
        .any(|criterion| criterion.criterion_id == "AC-002"));

    let mutations = plan_mutation::list_mutations_by_plan(db.conn(), plan_id).unwrap();
    assert_eq!(mutations.len(), 1);
    assert_eq!(mutations[0].r#type, PlanMutationType::AddStep);
    assert_eq!(
        mutations[0].reason.as_deref(),
        Some("Verification revealed export reconstruction was missing")
    );
    assert_eq!(mutations[0].step_db_id, Some(row.id));
    assert_eq!(mutations[0].stable_step_id.as_deref(), Some("step-002"));
    assert_eq!(mutations[0].criterion_ids, vec!["AC-001"]);
    assert_eq!(
        mutations[0].prd_delta.added_criteria[0].criterion_id,
        "AC-002"
    );

    let events = event_log::list(db.conn()).unwrap();
    let appended = events
        .iter()
        .find(|event| event.r#type == "plan_step_appended")
        .expect("append flow should log plan_step_appended");
    assert!(appended.payload["mutation_id"]
        .as_str()
        .unwrap()
        .starts_with("mut-step-002-"));
    assert_eq!(appended.payload["project_id"], json!(project_id));
    assert_eq!(appended.payload["plan_id"], json!(plan_id));
    assert_eq!(appended.payload["step_id"], json!(row.id));
    assert_eq!(appended.payload["stable_step_id"], json!("step-002"));
    assert_eq!(appended.payload["from_project_spec_version"], json!(1));
    assert_eq!(appended.payload["to_project_spec_version"], json!(2));
    assert_eq!(appended.payload["linked_criterion_ids"], json!(["AC-001"]));
    assert_eq!(
        appended.payload["prd_delta_summary"]["criterionIdsAdded"],
        json!(["AC-002"])
    );
}

#[test]
fn append_step_exports_mutation_prd_delta_and_scope_assessment() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    seed_minimal_prd(&state, project_id);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);

    let mut draft = append_step_draft(vec!["step-001".into()]);
    draft.title = "Add manual mutation export".into();
    draft.summary = "Persist manual added-step export state.".into();
    draft.expected_files = vec!["src/add-step-mutation.ts".into()];
    draft.linked_criterion_ids = vec![];

    let row = workspace_plan_append_step_with_options_impl(
        &state,
        plan_id,
        draft,
        AppendStepOptions {
            mutation_reason: Some("Student found a missing export step".into()),
            linked_criterion_ids: vec![],
            prd_delta: Some(ProjectSpecDelta {
                from_version: 1,
                to_version: 2,
                added_criteria: vec![AcceptanceCriterion {
                    criterion_id: "AC-002".into(),
                    text: "Manual added steps are exported".into(),
                    source: AcceptanceCriterionSource::PlanMutation,
                    status: AcceptanceCriterionStatus::Active,
                    created_in_version: 2,
                    retired_in_version: None,
                }],
                retired_criterion_ids: vec![],
                scope_changes: vec!["Manual mutation export".into()],
                non_goal_changes: vec![],
            }),
        },
    )
    .unwrap();

    assert_eq!(row.step_id, "step-002");
    let artifact: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(tmp.path().join(".dive/plan.json")).unwrap())
            .unwrap();
    assert_eq!(artifact["steps"][1]["id"], json!("step-002"));
    assert_eq!(artifact["projectSpec"]["currentVersion"], json!(2));
    assert_eq!(artifact["projectSpecVersions"][1]["version"], json!(2));
    assert_eq!(artifact["planMutations"][0]["type"], json!("add_step"));
    assert_eq!(
        artifact["planMutations"][0]["reason"],
        json!("Student found a missing export step")
    );
    assert_eq!(
        artifact["planMutations"][0]["prdDelta"]["addedCriteria"][0]["criterionId"],
        json!("AC-002")
    );
    assert_eq!(
        artifact["planMutations"][0]["scopeExpansion"]["expanded"],
        json!(true)
    );
    assert_eq!(
        artifact["planMutations"][0]["scopeExpansion"]["reasonCodes"],
        json!([
            "missing_criterion_link",
            "new_scope_area",
            "target_outside_scope"
        ])
    );
}

#[test]
fn approve_exports_artifacts_and_returns_approved_plan() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "draft");
    insert_step(&state, plan_id, "step-001", &[]);

    let approved = workspace_plan_approve_impl(&state, plan_id, None).unwrap();
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

    workspace_plan_approve_impl(&state, plan_id, None).unwrap();
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
fn plan_approved_event_records_critique_provenance() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "draft");
    insert_step(&state, plan_id, "step-001", &[]);

    workspace_plan_approve_impl(
        &state,
        plan_id,
        Some(PlanCritiqueResolution {
            response: "none".into(),
            note: Some("  목표대로 단계가 다 있는지 확인했어요  ".into()),
        }),
    )
    .unwrap();

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let approved = events
        .iter()
        .find(|event| event.r#type == "plan_approved")
        .expect("plan_approved event recorded");
    assert_eq!(approved.payload["critiqueResponse"], json!("none"));
    // The note is the student's own supervision sentence, trimmed but preserved.
    assert_eq!(
        approved.payload["critiqueNote"],
        json!("목표대로 단계가 다 있는지 확인했어요")
    );
}

#[test]
fn plan_approved_event_has_null_critique_when_absent() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "draft");
    insert_step(&state, plan_id, "step-001", &[]);

    workspace_plan_approve_impl(&state, plan_id, None).unwrap();

    let events = event_log::list(state.db.lock().unwrap().conn()).unwrap();
    let approved = events
        .iter()
        .find(|event| event.r#type == "plan_approved")
        .expect("plan_approved event recorded");
    assert_eq!(approved.payload["critiqueResponse"], json!(null));
    assert_eq!(approved.payload["critiqueNote"], json!(null));
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

    workspace_plan_approve_impl(&state, plan_row.id, None).unwrap();
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
    workspace_plan_approve_impl(&state, first_plan.id, None).unwrap();

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

    let approved = workspace_plan_approve_impl(&state, plan_row.id, None).unwrap();
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
