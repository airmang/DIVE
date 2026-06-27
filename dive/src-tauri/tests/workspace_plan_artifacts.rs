use dive_lib::db::dao::{plan, plan_mutation, prd, project, step};
use dive_lib::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
    NewLiveProjectSpecDraft, NewObjection, NewPlan, NewPlanMutation, NewProject,
    NewProjectSpecVersion, NewStep, ObjectionSuggestionStatus, PlanMutationType, ProjectSpec,
    ProjectSpecDelta, ProjectSpecDraft, ProjectSpecStatus, ScopeExpansionAssessment,
};
use dive_lib::Database;
use serde_json::Value;

fn seed_plan_with_steps(db: &Database) -> i64 {
    let project_id = project::insert(
        db.conn(),
        &NewProject {
            name: "Artifact Project".into(),
            path: "/tmp/artifact-project".into(),
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
            goal: "Build dependency aware roadmap".into(),
            intent_summary: Some("Keep plan metadata separate from execution cards.".into()),
            scope: Some(serde_json::json!(["persist approved plans"])),
            non_goals: Some(serde_json::json!(["replace Card execution state"])),
            constraints: Some(serde_json::json!([
                "SQLite remains runtime source of truth"
            ])),
            acceptance_criteria: Some(serde_json::json!(["exports plan artifacts"])),
            status: "draft".into(),
        },
    )
    .unwrap();

    let first = NewStep {
        plan_id,
        step_id: "step-001".into(),
        title: "Create schema".into(),
        summary: Some("Add durable plan tables.".into()),
        instruction_seed: Some("Implement schema and migration.".into()),
        expected_files: Some(serde_json::json!(["src-tauri/src/db/schema.rs"])),
        acceptance_criteria: Some(serde_json::json!(["migration reaches v7"])),
        step_kind: Default::default(),
        verification_kind: Some("command".into()),
        verification_command: Some("cargo test".into()),
        verification_manual_check: None,
        dependencies: Some(serde_json::json!([])),
        parallel_group: None,
        position: 1,
    };
    step::insert(db.conn(), &first).unwrap();

    let second = NewStep {
        plan_id,
        step_id: "step-002".into(),
        title: "Export artifacts".into(),
        summary: None,
        instruction_seed: Some("Write plan.json, plan.md, and flow.mmd.".into()),
        expected_files: Some(serde_json::json!([".dive/plan.json"])),
        acceptance_criteria: Some(serde_json::json!(["Mermaid has dependency edge"])),
        step_kind: Default::default(),
        verification_kind: Some("manual".into()),
        verification_command: None,
        verification_manual_check: Some("Open .dive/flow.mmd".into()),
        dependencies: Some(serde_json::json!(["step-001"])),
        parallel_group: Some("foundation".into()),
        position: 2,
    };
    step::insert(db.conn(), &second).unwrap();

    plan_id
}

fn artifact_criterion(id: &str, text: &str) -> AcceptanceCriterion {
    AcceptanceCriterion {
        criterion_id: id.into(),
        text: text.into(),
        source: AcceptanceCriterionSource::Interview,
        status: AcceptanceCriterionStatus::Active,
        created_in_version: 1,
        retired_in_version: None,
    }
}

fn artifact_project_spec(project_id: i64) -> ProjectSpec {
    ProjectSpec {
        project_spec_id: format!("prd-{project_id}"),
        project_id,
        current_version: 1,
        goal: "Build dependency aware roadmap".into(),
        intent_summary: Some("Keep PRD and plan exportable.".into()),
        scope: vec!["persist approved plans".into()],
        non_goals: vec!["replace Card execution state".into()],
        constraints: vec!["SQLite remains runtime source of truth".into()],
        acceptance_criteria: vec![artifact_criterion("AC-001", "exports plan artifacts")],
        status: ProjectSpecStatus::Draft,
        created_at: 100,
        updated_at: 200,
    }
}

#[test]
fn approving_plan_exports_snapshot_artifacts() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let plan_id = seed_plan_with_steps(&db);

    dive_lib::workspace_plan::approve_plan_and_export(db.conn(), plan_id, project_root.path())
        .unwrap();

    let json_path = project_root.path().join(".dive/plan.json");
    let markdown_path = project_root.path().join(".dive/plan.md");
    let mermaid_path = project_root.path().join(".dive/flow.mmd");

    let raw_json = std::fs::read_to_string(json_path).unwrap();
    let artifact: Value = serde_json::from_str(&raw_json).unwrap();
    assert_eq!(artifact["schemaVersion"], 1);
    assert_eq!(artifact["status"], "approved");
    assert_eq!(artifact["goal"], "Build dependency aware roadmap");
    assert_eq!(artifact["steps"][1]["id"], "step-002");
    assert_eq!(
        artifact["steps"][1]["dependencies"],
        serde_json::json!(["step-001"])
    );
    assert_eq!(artifact["steps"][0]["verification"]["kind"], "test");
    assert_eq!(artifact["steps"][1]["verification"]["kind"], "manual");

    let markdown = std::fs::read_to_string(markdown_path).unwrap();
    assert!(markdown.contains("# Build dependency aware roadmap"));
    assert!(markdown.contains("## Steps"));
    assert!(markdown.contains("### 2. Export artifacts"));

    let mermaid = std::fs::read_to_string(mermaid_path).unwrap();
    assert!(mermaid.contains("flowchart TD"));
    assert!(mermaid.contains("step_001 --> step_002"));

    let approved = plan::get_by_id(db.conn(), plan_id).unwrap().unwrap();
    assert_eq!(approved.status, "approved");
    assert!(approved.approved_at.is_some());
}

#[test]
fn approving_plan_exports_preview_verification_without_empty_command() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let plan_id = seed_plan_with_steps(&db);

    step::insert(
        db.conn(),
        &NewStep {
            plan_id,
            step_id: "step-003".into(),
            title: "Preview static page".into(),
            summary: Some("Inspect the static index page in the browser.".into()),
            instruction_seed: Some("Open index.html through DIVE Preview.".into()),
            expected_files: Some(serde_json::json!(["index.html"])),
            acceptance_criteria: Some(serde_json::json!(["The static page renders."])),
            step_kind: Default::default(),
            verification_kind: Some("preview".into()),
            verification_command: Some("   ".into()),
            verification_manual_check: None,
            dependencies: Some(serde_json::json!([])),
            parallel_group: None,
            position: 3,
        },
    )
    .unwrap();

    dive_lib::workspace_plan::approve_plan_and_export(db.conn(), plan_id, project_root.path())
        .unwrap();

    let raw_json = std::fs::read_to_string(project_root.path().join(".dive/plan.json")).unwrap();
    let artifact: Value = serde_json::from_str(&raw_json).unwrap();
    let verification = artifact["steps"][2]["verification"]
        .as_object()
        .expect("preview verification artifact");
    assert_eq!(
        verification.get("kind").and_then(Value::as_str),
        Some("preview")
    );
    assert!(
        !verification.contains_key("command"),
        "preview verification must not export an empty command"
    );

    let markdown = std::fs::read_to_string(project_root.path().join(".dive/plan.md")).unwrap();
    assert!(markdown.contains("**Verification:** preview"));
    assert!(!markdown.contains("- Command: ``"));
}

#[test]
fn export_rejects_invalid_dependencies_without_approving() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let plan_id = seed_plan_with_steps(&db);

    let second = step::get_by_plan_and_step_id(db.conn(), plan_id, "step-002")
        .unwrap()
        .unwrap();
    let mut broken = NewStep {
        plan_id: second.plan_id,
        step_id: second.step_id,
        title: second.title,
        summary: second.summary,
        instruction_seed: second.instruction_seed,
        expected_files: second.expected_files,
        acceptance_criteria: second.acceptance_criteria,
        step_kind: second.step_kind,
        verification_kind: second.verification_kind,
        verification_command: second.verification_command,
        verification_manual_check: second.verification_manual_check,
        dependencies: Some(serde_json::json!(["step-999"])),
        parallel_group: second.parallel_group,
        position: second.position,
    };
    step::update(db.conn(), second.id, &broken).unwrap();

    assert!(dive_lib::workspace_plan::approve_plan_and_export(
        db.conn(),
        plan_id,
        project_root.path()
    )
    .is_err());
    assert!(!project_root.path().join(".dive/plan.json").exists());
    assert_eq!(
        plan::get_by_id(db.conn(), plan_id).unwrap().unwrap().status,
        "draft"
    );

    broken.dependencies = Some(serde_json::json!(["step-001"]));
    step::update(db.conn(), second.id, &broken).unwrap();
}

#[test]
fn approving_plan_exports_prd_lifecycle_foundation() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let plan_id = seed_plan_with_steps(&db);
    let plan_row = plan::get_by_id(db.conn(), plan_id).unwrap().unwrap();
    let spec = artifact_project_spec(plan_row.project_id);
    let first_step = step::get_by_plan_and_step_id(db.conn(), plan_id, "step-001")
        .unwrap()
        .unwrap();
    step::update(
        db.conn(),
        first_step.id,
        &NewStep {
            plan_id: first_step.plan_id,
            step_id: first_step.step_id.clone(),
            title: first_step.title.clone(),
            summary: first_step.summary.clone(),
            instruction_seed: first_step.instruction_seed.clone(),
            expected_files: first_step.expected_files.clone(),
            acceptance_criteria: Some(serde_json::json!({
                "criteria": [artifact_criterion("AC-001", "exports plan artifacts")],
                "linkedCriterionIds": ["AC-001"],
                "rationale": "This step creates the storage needed to export AC-001 evidence."
            })),
            step_kind: first_step.step_kind,
            verification_kind: first_step.verification_kind.clone(),
            verification_command: first_step.verification_command.clone(),
            verification_manual_check: first_step.verification_manual_check.clone(),
            dependencies: first_step.dependencies.clone(),
            parallel_group: first_step.parallel_group.clone(),
            position: first_step.position,
        },
    )
    .unwrap();

    prd::insert_version(
        db.conn(),
        &NewProjectSpecVersion {
            project_spec_id: spec.project_spec_id.clone(),
            project_id: plan_row.project_id,
            version: 1,
            previous_version: None,
            snapshot: spec.clone(),
            reason: "interview".into(),
            delta_summary: serde_json::json!({"changedFields": ["goal"]}),
        },
    )
    .unwrap();
    prd::upsert_draft(
        db.conn(),
        &NewLiveProjectSpecDraft {
            draft_id: format!("draft-{}", plan_row.project_id),
            project_id: plan_row.project_id,
            base_version: Some(1),
            spec: ProjectSpecDraft {
                project_spec_id: Some(spec.project_spec_id.clone()),
                project_id: plan_row.project_id,
                current_version: Some(1),
                goal: spec.goal.clone(),
                intent_summary: spec.intent_summary.clone(),
                scope: spec.scope.clone(),
                non_goals: spec.non_goals.clone(),
                constraints: spec.constraints.clone(),
                acceptance_criteria: spec.acceptance_criteria.clone(),
                status: ProjectSpecStatus::Draft,
            },
            dirty_fields: vec!["goal".into()],
            student_edited_fields: vec!["goal".into()],
            last_patch_id: Some("patch-1".into()),
        },
    )
    .unwrap();
    plan_mutation::insert_mutation(
        db.conn(),
        &NewPlanMutation {
            mutation_id: "mut-001".into(),
            project_id: plan_row.project_id,
            plan_id,
            r#type: PlanMutationType::AddStep,
            step_db_id: Some(first_step.id),
            stable_step_id: Some(first_step.step_id.clone()),
            reason: Some("Verification found missing export data".into()),
            criterion_ids: vec!["AC-001".into()],
            prd_delta: ProjectSpecDelta {
                from_version: 1,
                to_version: 2,
                added_criteria: vec![],
                retired_criterion_ids: vec![],
                scope_changes: vec!["Added export metadata".into()],
                non_goal_changes: vec![],
            },
            scope_expansion: ScopeExpansionAssessment {
                expanded: false,
                reason_codes: vec![],
                evidence_refs: vec!["AC-001".into()],
            },
        },
    )
    .unwrap();
    plan_mutation::insert_objection(
        db.conn(),
        &NewObjection {
            objection_id: "obj-001".into(),
            project_id: plan_row.project_id,
            plan_id,
            step_db_id: first_step.id,
            stable_step_id: first_step.step_id.clone(),
            text: "Why does export belong here? student@example.edu".into(),
            linked_criterion_ids: vec!["AC-001".into()],
            suggestion_status: ObjectionSuggestionStatus::Offered,
        },
    )
    .unwrap();

    dive_lib::workspace_plan::approve_plan_and_export(db.conn(), plan_id, project_root.path())
        .unwrap();

    let artifact_raw =
        std::fs::read_to_string(project_root.path().join(".dive/plan.json")).unwrap();
    let artifact: Value = serde_json::from_str(&artifact_raw).unwrap();
    assert_eq!(
        artifact["projectSpec"]["projectSpecId"],
        spec.project_spec_id
    );
    assert_eq!(artifact["projectSpecVersions"][0]["version"], 1);
    assert_eq!(
        artifact["liveProjectSpecDraft"]["draftId"],
        format!("draft-{}", plan_row.project_id)
    );
    assert_eq!(artifact["planMutations"][0]["mutationId"], "mut-001");
    assert_eq!(artifact["objections"][0]["objectionId"], "obj-001");
    assert_eq!(
        artifact["objections"][0]["objectionSummary"]["redacted"],
        true
    );
    assert!(!artifact_raw.contains("student@example.edu"));
    assert!(!artifact_raw.contains("Why does export belong here?"));
    assert_eq!(
        artifact["planAdjustmentOffers"][0]["offerId"],
        "offer:obj-001"
    );
    assert_eq!(
        artifact["planAdjustmentOffers"][0]["kind"],
        "redecompose_step"
    );
    let event_contracts = artifact["eventLogExportContracts"]
        .as_array()
        .expect("eventLogExportContracts should export reconstruction contracts");
    assert!(event_contracts
        .iter()
        .any(|contract| contract["eventType"] == "plan_generated"));
    assert_eq!(
        artifact["steps"][0]["linkedCriterionIds"],
        serde_json::json!(["AC-001"])
    );
    assert_eq!(
        artifact["steps"][0]["decompositionRationale"],
        "This step creates the storage needed to export AC-001 evidence."
    );
}
