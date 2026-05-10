use std::sync::Arc;

use dive_lib::auth::InMemoryKeyring;
use dive_lib::db::dao::{
    card, interview, plan, project, session, step, step_session_mapping as mapping, workmap,
};
use dive_lib::db::models::{NewInterview, NewPlan, NewProject, NewStep};
use dive_lib::ipc::workspace_plan::{
    roadmap_step_open_impl, roadmap_step_update_state_impl, workspace_plan_approve_impl,
    workspace_plan_discard_plan_impl, workspace_plan_generate_draft_impl,
    workspace_plan_list_steps_impl, workspace_plan_save_interview_answer_impl,
    workspace_plan_start_interview_impl, workspace_plan_status_impl,
    workspace_plan_step_mappings_impl, workspace_plan_submit_interview_impl, PlanDraftInput,
    StepDraftInput, StepStateUpdateInput,
};
use dive_lib::{AppState, Database, MockProvider};
use serde_json::json;

fn mk_state(tmp: &tempfile::TempDir) -> AppState {
    let mut db = Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    let provider = Arc::new(MockProvider::new(Vec::new()));
    AppState::new(db, provider, tmp.path().to_path_buf(), "mock".into())
        .with_keyring(Arc::new(InMemoryKeyring::new()))
}

fn seed_project(state: &AppState) -> i64 {
    let db = state.db.lock().unwrap();
    project::insert(
        db.conn(),
        &NewProject {
            name: "Workspace Plan".into(),
            path: "/tmp/workspace-plan".into(),
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
        acceptance_criteria: vec!["draft plan is persisted".into()],
        steps: vec![
            StepDraftInput {
                title: "Create schema".into(),
                summary: "Add durable plan tables.".into(),
                instruction_seed: "Implement schema and migration.".into(),
                expected_files: vec!["src-tauri/src/db/schema.rs".into()],
                acceptance_criteria: vec!["migration reaches v7".into()],
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
                acceptance_criteria: vec!["exports include dependencies".into()],
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
fn opening_blocked_step_is_rejected_without_creating_mapping() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let plan_id = seed_plan(&state, project_id, "approved");
    insert_step(&state, plan_id, "step-001", &[]);
    let blocked = insert_step(&state, plan_id, "step-002", &["step-001"]);

    let err = roadmap_step_open_impl(&state, blocked).unwrap_err();
    assert!(err.contains("blocked"));
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

    let (plan_row, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input()).unwrap();
    assert_eq!(plan_row.project_id, project_id);
    assert_eq!(plan_row.interview_id, Some(submitted.id));
    assert_eq!(plan_row.status, "draft");
    assert_eq!(steps.len(), 2);
    assert_eq!(steps[0].step_id, "step-001");
    assert_eq!(steps[1].dependencies, Some(json!(["step-001"])));
    assert_eq!(steps[1].parallel_group, Some("1".into()));
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
    workspace_plan_generate_draft_impl(&state, submitted.id, draft_input()).unwrap();

    let mut replacement = draft_input();
    replacement.goal = "Replacement draft".into();
    replacement.steps.truncate(1);
    let (second_plan, second_steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, replacement).unwrap();

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
fn generate_draft_rejects_duplicate_step_slug() {
    let tmp = tempfile::tempdir().unwrap();
    let state = mk_state(&tmp);
    let project_id = seed_project(&state);
    let interview =
        workspace_plan_start_interview_impl(&state, project_id, "Build a roadmap".into()).unwrap();
    let submitted =
        workspace_plan_submit_interview_impl(&state, interview.id, "Summary".into(), vec![])
            .unwrap();
    let mut input = draft_input();
    input.steps[1].step_id = input.steps[0].step_id.clone();

    let err = workspace_plan_generate_draft_impl(&state, submitted.id, input).unwrap_err();
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
    let (plan_row, steps) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input()).unwrap();
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
    let (plan_row, _) =
        workspace_plan_generate_draft_impl(&state, submitted.id, draft_input()).unwrap();

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
