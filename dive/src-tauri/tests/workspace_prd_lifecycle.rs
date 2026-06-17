use dive_lib::db::dao::{plan, plan_mutation, prd, project, step};
use dive_lib::db::migrations;
use dive_lib::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
    NewLiveProjectSpecDraft, NewObjection, NewPlan, NewPlanMutation, NewProject,
    NewProjectSpecVersion, NewStep, ObjectionSuggestionStatus, PlanAdjustmentOfferKind,
    PlanAdjustmentOfferStatus, PlanMutationType, ProjectSpec, ProjectSpecDelta, ProjectSpecDraft,
    ProjectSpecStatus, ScopeExpansionAssessment,
};
use dive_lib::ipc::workspace_plan::{
    assess_scope_expansion_for_append, AcceptanceCriterionInput, StepDraftInput,
};
use dive_lib::Database;
use serde_json::json;

fn seed_project_and_plan(db: &Database) -> (i64, i64, i64) {
    let project_id = project::insert(
        db.conn(),
        &NewProject {
            name: "PRD Project".into(),
            path: "/tmp/prd-project".into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let plan_id = plan::insert(
        db.conn(),
        &NewPlan {
            project_id,
            interview_id: None,
            goal: "Build a PRD-backed plan".into(),
            intent_summary: None,
            scope: None,
            non_goals: None,
            constraints: None,
            acceptance_criteria: None,
            status: "draft".into(),
        },
    )
    .unwrap();
    let step_id = step::insert(
        db.conn(),
        &NewStep {
            plan_id,
            step_id: "step-001".into(),
            title: "Persist PRD".into(),
            summary: None,
            instruction_seed: None,
            expected_files: None,
            acceptance_criteria: None,
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: None,
            parallel_group: None,
            position: 1,
        },
    )
    .unwrap();
    (project_id, plan_id, step_id)
}

fn criterion(id: &str, text: &str) -> AcceptanceCriterion {
    AcceptanceCriterion {
        criterion_id: id.into(),
        text: text.into(),
        source: AcceptanceCriterionSource::Interview,
        status: AcceptanceCriterionStatus::Active,
        created_in_version: 1,
        retired_in_version: None,
    }
}

fn project_spec(project_id: i64) -> ProjectSpec {
    ProjectSpec {
        project_spec_id: format!("prd-{project_id}"),
        project_id,
        current_version: 1,
        goal: "Build a PRD-backed plan".into(),
        intent_summary: Some("Make decomposition auditable.".into()),
        scope: vec!["PRD persistence".into()],
        non_goals: vec!["UI implementation".into()],
        constraints: vec!["Rust/Tauri boundary is source of truth".into()],
        acceptance_criteria: vec![criterion("AC-001", "PRD versions roundtrip")],
        status: ProjectSpecStatus::Draft,
        created_at: 100,
        updated_at: 200,
    }
}

fn empty_delta() -> ProjectSpecDelta {
    ProjectSpecDelta {
        from_version: 1,
        to_version: 2,
        added_criteria: vec![criterion("AC-002", "Mutation is exportable")],
        retired_criterion_ids: vec![],
        scope_changes: vec!["Added persistence scope".into()],
        non_goal_changes: vec![],
    }
}

fn no_scope_expansion() -> ScopeExpansionAssessment {
    ScopeExpansionAssessment {
        expanded: false,
        reason_codes: vec![],
        evidence_refs: vec!["AC-001".into()],
    }
}

fn append_scope_draft() -> StepDraftInput {
    StepDraftInput {
        title: "Add PRD export".into(),
        summary: "Persist PRD mutation export data.".into(),
        instruction_seed: "Update the export helper for plan mutations.".into(),
        expected_files: vec!["src/workspace_plan/artifacts.rs".into()],
        acceptance_criteria: vec![AcceptanceCriterionInput::Text(
            "PRD versions roundtrip".into(),
        )],
        linked_criterion_ids: vec!["AC-001".into()],
        rationale: Some("The export step preserves AC-001 evidence.".into()),
        verification_command: Some("cargo test".into()),
        verification_type: Some("command".into()),
        dependencies: vec![],
        parallel_group: None,
        position: 2,
        step_id: "step-002".into(),
    }
}

#[test]
fn migration_v11_creates_prd_lifecycle_tables() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(tmp.path()).unwrap();
    db.migrate().unwrap();

    let latest: i64 = db
        .conn()
        .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(latest, migrations::LATEST_SCHEMA_VERSION);

    let table_count: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('ProjectSpecVersion','LiveProjectSpecDraft','PlanMutation','Objection')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(table_count, 4);
}

#[test]
fn prd_version_and_draft_roundtrip() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(tmp.path()).unwrap();
    db.migrate().unwrap();
    let (project_id, _, _) = seed_project_and_plan(&db);
    let spec = project_spec(project_id);

    let version_id = prd::insert_version(
        db.conn(),
        &NewProjectSpecVersion {
            project_spec_id: spec.project_spec_id.clone(),
            project_id,
            version: 1,
            previous_version: None,
            snapshot: spec.clone(),
            reason: "interview".into(),
            delta_summary: json!({"changedFields": ["goal", "acceptanceCriteria"]}),
        },
    )
    .unwrap();
    assert!(version_id > 0);

    let latest = prd::latest_version(db.conn(), project_id).unwrap().unwrap();
    assert_eq!(latest.snapshot, spec);
    assert_eq!(
        latest.delta_summary["changedFields"][1],
        "acceptanceCriteria"
    );

    prd::upsert_draft(
        db.conn(),
        &NewLiveProjectSpecDraft {
            draft_id: format!("draft-{project_id}"),
            project_id,
            base_version: Some(1),
            spec: ProjectSpecDraft {
                project_spec_id: Some(format!("prd-{project_id}")),
                project_id,
                current_version: Some(1),
                goal: "Edited goal".into(),
                intent_summary: None,
                scope: vec![],
                non_goals: vec![],
                constraints: vec![],
                acceptance_criteria: vec![criterion("AC-001", "PRD versions roundtrip")],
                status: ProjectSpecStatus::Draft,
            },
            dirty_fields: vec!["goal".into()],
            student_edited_fields: vec!["goal".into()],
            last_patch_id: Some("patch-1".into()),
        },
    )
    .unwrap();

    let draft = prd::get_draft(db.conn(), project_id).unwrap().unwrap();
    assert_eq!(draft.spec.goal, "Edited goal");
    assert_eq!(draft.dirty_fields, vec!["goal"]);
    assert_eq!(draft.last_patch_id.as_deref(), Some("patch-1"));
}

#[test]
fn plan_mutation_and_objection_roundtrip() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(tmp.path()).unwrap();
    db.migrate().unwrap();
    let (project_id, plan_id, step_db_id) = seed_project_and_plan(&db);

    plan_mutation::insert_mutation(
        db.conn(),
        &NewPlanMutation {
            mutation_id: "mut-001".into(),
            project_id,
            plan_id,
            r#type: PlanMutationType::AddStep,
            step_db_id: Some(step_db_id),
            stable_step_id: Some("step-001".into()),
            reason: Some("Verification found missing persistence".into()),
            criterion_ids: vec!["AC-001".into()],
            prd_delta: empty_delta(),
            scope_expansion: no_scope_expansion(),
        },
    )
    .unwrap();

    let mutations = plan_mutation::list_mutations_by_plan(db.conn(), plan_id).unwrap();
    assert_eq!(mutations.len(), 1);
    assert_eq!(mutations[0].mutation_id, "mut-001");
    assert_eq!(mutations[0].criterion_ids, vec!["AC-001"]);

    plan_mutation::insert_objection(
        db.conn(),
        &NewObjection {
            objection_id: "obj-001".into(),
            project_id,
            plan_id,
            step_db_id,
            stable_step_id: "step-001".into(),
            text: "Why is this its own step?".into(),
            linked_criterion_ids: vec!["AC-001".into()],
            suggestion_status: ObjectionSuggestionStatus::Offered,
        },
    )
    .unwrap();

    let objections = plan_mutation::list_objections_by_plan(db.conn(), plan_id).unwrap();
    assert_eq!(objections.len(), 1);
    assert_eq!(objections[0].stable_step_id, "step-001");
    assert_eq!(
        objections[0].suggestion_status,
        ObjectionSuggestionStatus::Offered
    );

    let offer = plan_mutation::reconstruct_plan_adjustment_offer(&objections[0]).unwrap();
    assert_eq!(offer.offer_id, "offer:obj-001");
    assert_eq!(offer.objection_id, "obj-001");
    assert_eq!(offer.project_id, project_id);
    assert_eq!(offer.plan_id, plan_id);
    assert_eq!(offer.step_db_id, step_db_id);
    assert_eq!(offer.stable_step_id, "step-001");
    assert_eq!(offer.kind, PlanAdjustmentOfferKind::RedecomposeStep);
    assert_eq!(offer.status, PlanAdjustmentOfferStatus::Offered);
    assert!(offer
        .suggested_seed
        .as_deref()
        .unwrap_or("")
        .contains("계획"));
    assert!(offer.created_at > 0);
    assert_eq!(offer.responded_at, None);

    let updated = plan_mutation::update_objection_suggestion_status(
        db.conn(),
        "obj-001",
        ObjectionSuggestionStatus::Accepted,
    )
    .unwrap();
    let accepted_offer = plan_mutation::reconstruct_plan_adjustment_offer(&updated).unwrap();
    assert_eq!(accepted_offer.status, PlanAdjustmentOfferStatus::Accepted);
}

#[test]
fn scope_expansion_flags_missing_criterion_link() {
    let mut draft = append_scope_draft();
    draft.linked_criterion_ids = vec![];
    let spec = project_spec(1);

    let assessment = assess_scope_expansion_for_append(&spec, &draft, &[], None);

    assert!(assessment.expanded);
    assert_eq!(assessment.reason_codes, vec!["missing_criterion_link"]);
    assert!(assessment
        .evidence_refs
        .iter()
        .any(|item| item == "step.linkedCriterionIds"));
}

#[test]
fn scope_expansion_flags_new_scope_area_from_prd_delta() {
    let spec = project_spec(1);
    let draft = append_scope_draft();
    let delta = ProjectSpecDelta {
        from_version: 1,
        to_version: 2,
        added_criteria: vec![],
        retired_criterion_ids: vec![],
        scope_changes: vec!["Authentication settings".into()],
        non_goal_changes: vec![],
    };

    let assessment =
        assess_scope_expansion_for_append(&spec, &draft, &["AC-001".into()], Some(&delta));

    assert!(assessment.expanded);
    assert_eq!(assessment.reason_codes, vec!["new_scope_area"]);
    assert!(assessment
        .evidence_refs
        .iter()
        .any(|item| item == "prdDelta.scopeChanges[0]"));
}

#[test]
fn scope_expansion_flags_out_of_scope_target_files() {
    let mut spec = project_spec(1);
    spec.non_goals = vec!["auth".into()];
    let mut draft = append_scope_draft();
    draft.expected_files = vec!["src/auth/session.ts".into()];

    let assessment = assess_scope_expansion_for_append(&spec, &draft, &["AC-001".into()], None);

    assert!(assessment.expanded);
    assert_eq!(assessment.reason_codes, vec!["target_outside_scope"]);
    assert!(assessment
        .evidence_refs
        .iter()
        .any(|item| item == "step.expectedFiles[0]"));
}
