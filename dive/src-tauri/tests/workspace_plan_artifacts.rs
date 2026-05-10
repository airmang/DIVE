use dive_lib::db::dao::{plan, project, step};
use dive_lib::db::models::{NewPlan, NewProject, NewStep};
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
