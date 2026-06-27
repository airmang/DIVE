use std::sync::{Arc, Mutex};

use dive_lib::checkpoint::{CheckpointEngine, SessionStateSnapshot};
use dive_lib::db::dao::{
    card, message, plan, project, session, step, step_session_mapping as mapping, workmap,
};
use dive_lib::db::models::{
    CardState, NewCard, NewMessage, NewPlan, NewProject, NewSession, NewStep,
    NewStepSessionMapping, NewWorkmap,
};
use serde_json::json;

fn env() -> (Arc<Mutex<dive_lib::Database>>, tempfile::TempDir, i64, i64) {
    let tmp = tempfile::tempdir().unwrap();
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = dive_lib::Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let pid = project::insert(
        db.conn(),
        &NewProject {
            name: "p".into(),
            path: tmp.path().to_string_lossy().into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let sid = session::insert(
        db.conn(),
        &NewSession {
            project_id: pid,
            title: "s".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    let cid = card::insert(
        db.conn(),
        &NewCard {
            session_id: sid,
            title: "card".into(),
            instruction: Some("add login form".into()),
            assist_summary: None,
            acceptance_criteria: None,
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
    .unwrap();
    Box::leak(Box::new(db_file));
    (Arc::new(Mutex::new(db)), tmp, sid, cid)
}

#[test]
fn init_creates_bare_repo() {
    let (db, tmp, _, _) = env();
    let engine = CheckpointEngine::new(tmp.path(), db);
    engine.init().unwrap();
    assert!(tmp.path().join(".dive/git/HEAD").exists());
    assert!(tmp.path().join(".dive/git/objects").exists());
}

#[test]
fn manual_then_auto_checkpoint_roundtrip() {
    let (db, tmp, sid, cid) = env();
    let engine = CheckpointEngine::new(tmp.path(), db);
    engine.init().unwrap();
    std::fs::write(tmp.path().join("main.rs"), "fn main(){}").unwrap();

    let manual = engine
        .create_checkpoint(sid, Some(cid), "manual", Some("before edits"))
        .unwrap();
    assert_eq!(manual.git_sha.len(), 40);
    assert_eq!(manual.kind, "manual");
    assert_eq!(manual.changed_files, vec!["main.rs"]);
    assert_eq!(manual.stats.added, 1);

    std::fs::write(tmp.path().join("main.rs"), "fn main(){ println!(\"hi\"); }").unwrap();
    let auto = engine
        .create_checkpoint(sid, Some(cid), "auto", Some("[V 통과] card"))
        .unwrap();
    assert_ne!(auto.git_sha, manual.git_sha);
    assert_eq!(auto.changed_files, vec!["main.rs"]);
    assert_eq!(auto.stats.modified, 1);

    let list = engine.list_checkpoints(sid).unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().any(|c| c.kind == "auto"));
}

#[test]
fn restore_reverts_worktree_and_autosnapshots() {
    let (db, tmp, sid, cid) = env();
    let engine = CheckpointEngine::new(tmp.path(), db);
    engine.init().unwrap();
    std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
    let v1 = engine
        .create_checkpoint(sid, Some(cid), "manual", Some("v1"))
        .unwrap();
    std::fs::write(tmp.path().join("a.txt"), "v2-unsaved").unwrap();

    engine.restore_checkpoint(v1.id).unwrap();

    assert_eq!(
        std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
        "v1"
    );
    let list = engine.list_checkpoints(sid).unwrap();
    assert!(list
        .iter()
        .any(|c| c.kind == "auto-pre-restore" && c.label.is_none()));
}

#[test]
fn restore_replays_session_state_snapshot() {
    let (db, tmp, sid, cid) = env();
    let (message_id, mapping_id) = seed_session_state(db.clone(), tmp.path(), sid, cid);
    let engine = CheckpointEngine::new(tmp.path(), db.clone());
    engine.init().unwrap();
    std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
    let v1 = engine
        .create_checkpoint(sid, Some(cid), "manual", Some("v1"))
        .unwrap();
    let snapshot: SessionStateSnapshot =
        serde_json::from_str(v1.session_state_snapshot.as_deref().unwrap()).unwrap();

    std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();
    {
        let db = db.lock().unwrap();
        db.conn()
            .execute("UPDATE Card SET title = 'mutated' WHERE id = ?", [cid])
            .unwrap();
        db.conn()
            .execute(
                "UPDATE Message SET content = 'after' WHERE id = ?",
                [message_id],
            )
            .unwrap();
        db.conn()
            .execute(
                "UPDATE Workmap SET current_stage = 'V', collapsed = 1 WHERE session_id = ?",
                [sid],
            )
            .unwrap();
        db.conn()
            .execute(
                "UPDATE StepSessionMapping SET status = 'done', completed_at = 2 WHERE id = ?",
                [mapping_id],
            )
            .unwrap();
    }

    engine.restore_checkpoint(v1.id).unwrap();

    assert_eq!(
        std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
        "v1"
    );
    let db = db.lock().unwrap();
    assert_eq!(
        card::list_by_session(db.conn(), sid).unwrap(),
        snapshot.cards
    );
    assert_eq!(
        message::list_by_session(db.conn(), sid, i64::MAX).unwrap(),
        snapshot.messages
    );
    assert_eq!(workmap::get(db.conn(), sid).unwrap(), snapshot.workmap);
    assert_eq!(
        mapping::list_by_session(db.conn(), sid).unwrap(),
        snapshot.step_session_mappings
    );
}

#[test]
fn restore_without_session_state_snapshot_keeps_file_only_behavior() {
    let (db, tmp, sid, cid) = env();
    seed_session_state(db.clone(), tmp.path(), sid, cid);
    let engine = CheckpointEngine::new(tmp.path(), db.clone());
    engine.init().unwrap();
    std::fs::write(tmp.path().join("a.txt"), "v1").unwrap();
    let v1 = engine
        .create_checkpoint(sid, Some(cid), "manual", Some("legacy"))
        .unwrap();
    {
        let db = db.lock().unwrap();
        db.conn()
            .execute(
                "UPDATE Checkpoint SET session_state_snapshot = NULL WHERE id = ?",
                [v1.id],
            )
            .unwrap();
        db.conn()
            .execute("UPDATE Card SET title = 'mutated' WHERE id = ?", [cid])
            .unwrap();
    }
    std::fs::write(tmp.path().join("a.txt"), "v2").unwrap();

    engine.restore_checkpoint(v1.id).unwrap();

    assert_eq!(
        std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(),
        "v1"
    );
    let db = db.lock().unwrap();
    assert_eq!(
        card::get_by_id(db.conn(), cid).unwrap().unwrap().title,
        "mutated"
    );
}

fn seed_session_state(
    db: Arc<Mutex<dive_lib::Database>>,
    project_root: &std::path::Path,
    sid: i64,
    cid: i64,
) -> (i64, i64) {
    let db = db.lock().unwrap();
    let project_id = session::get_by_id(db.conn(), sid)
        .unwrap()
        .unwrap()
        .project_id;
    let plan_id = plan::insert(
        db.conn(),
        &NewPlan {
            project_id,
            interview_id: None,
            goal: "goal".into(),
            intent_summary: None,
            scope: None,
            non_goals: None,
            constraints: None,
            acceptance_criteria: None,
            status: "approved".into(),
        },
    )
    .unwrap();
    let step_id = step::insert(
        db.conn(),
        &NewStep {
            plan_id,
            step_id: "step-001".into(),
            title: "Step 1".into(),
            summary: None,
            instruction_seed: Some("Do it".into()),
            expected_files: Some(json!([project_root.join("a.txt").to_string_lossy()])),
            acceptance_criteria: Some(json!(["done"])),
            step_kind: Default::default(),
            verification_kind: None,
            verification_command: None,
            verification_manual_check: None,
            dependencies: Some(json!([])),
            parallel_group: None,
            position: 1,
        },
    )
    .unwrap();
    workmap::upsert(
        db.conn(),
        &NewWorkmap {
            session_id: sid,
            current_stage: "I".into(),
            collapsed: false,
            current_card_id: Some(cid),
        },
    )
    .unwrap();
    let message_id = message::insert(
        db.conn(),
        &NewMessage {
            session_id: sid,
            card_id: Some(cid),
            role: "assistant".into(),
            content: "before".into(),
            reasoning_content: Some("reason".into()),
            tool_calls: Some(json!([{ "name": "read" }])),
            usage: Some(json!({ "tokens": 3 })),
            provider: Some("mock".into()),
            model: Some("model".into()),
        },
    )
    .unwrap();
    let mapping_id = mapping::insert(
        db.conn(),
        &NewStepSessionMapping {
            step_id,
            session_id: Some(sid),
            card_id: Some(cid),
            state_path: Some("step-001".into()),
            status: "in_progress".into(),
            started_at: Some(1),
            completed_at: None,
            checkpoint_ids: Some(json!([1])),
            verification_status: Some("pending".into()),
            verification_evidence: Some("none".into()),
            user_decision: Some("working".into()),
        },
    )
    .unwrap();
    (message_id, mapping_id)
}
