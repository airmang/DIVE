use std::sync::{Arc, Mutex};

use dive_lib::checkpoint::CheckpointEngine;
use dive_lib::db::dao::{card, project, session};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};

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
        .any(|c| c.kind == "auto-pre-restore" && c.label.as_deref() == Some("복원 직전")));
}
