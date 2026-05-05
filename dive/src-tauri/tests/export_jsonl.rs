use std::sync::{Arc, Mutex};

use dive_lib::db::dao::{card, event_log, message, project, session, tool_call};
use dive_lib::db::models::{
    CardState, NewCard, NewEventLog, NewMessage, NewProject, NewSession, NewToolCall,
};
use dive_lib::export::{ExportEngine, ExportOptions};
use serde_json::{json, Value};

fn seed() -> (Arc<Mutex<dive_lib::Database>>, i64) {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = dive_lib::Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    Box::leak(Box::new(db_file));
    let pid = project::insert(
        db.conn(),
        &NewProject {
            name: "p".into(),
            path: "/tmp/p".into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let sid = session::insert(
        db.conn(),
        &NewSession {
            project_id: pid,
            title: "학생-42 로그인 폼".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    let _cid = card::insert(
        db.conn(),
        &NewCard {
            session_id: sid,
            title: "로그인 폼 추가".into(),
            instruction: Some("LoginForm 컴포넌트에 이메일/비밀번호 input 추가".into()),
            assist_summary: None,
            acceptance_criteria: None,
            retrospective: None,
            change_summary: None,
            state: CardState::Verified,
            verify_log: Some(
                r#"{"intent_match":true,"test_result":"skipped","details":"ok","model":"m","ran_at":1}"#
                    .into(),
            ),
            changed_files: Some(json!(["src/App.tsx", "src/LoginForm.tsx"])),
            test_command: None,
            position: 1,
        },
    )
    .unwrap();
    let mid = message::insert(
        db.conn(),
        &NewMessage {
            session_id: sid,
            card_id: None,
            role: "user".into(),
            content: "학생-42가 개인적으로 묻고 싶은 질문".into(),
            tool_calls: None,
            usage: None,
            provider: None,
            model: None,
        },
    )
    .unwrap();
    let _ = tool_call::insert(
        db.conn(),
        &NewToolCall {
            message_id: mid,
            name: "read_file".into(),
            input: json!({ "path": "src/App.tsx" }),
            output: Some(json!({ "path": "src/App.tsx", "content": "...contents..." })),
            approved: Some(true),
            risk_level: "safe".into(),
        },
    )
    .unwrap();
    event_log::insert(
        db.conn(),
        &NewEventLog {
            session_id: Some(sid),
            r#type: "user_message".into(),
            payload: json!({ "note": "some event" }),
        },
    )
    .unwrap();
    (Arc::new(Mutex::new(db)), sid)
}

fn lines(jsonl: &str) -> Vec<Value> {
    jsonl
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .collect()
}

#[test]
fn export_emits_all_record_kinds() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let jsonl = engine
        .export_session(sid, &ExportOptions::default())
        .unwrap();
    let records = lines(&jsonl);
    assert!(!records.is_empty());

    let mut kinds: Vec<String> = records
        .iter()
        .map(|r| r["kind"].as_str().unwrap_or("").to_string())
        .collect();
    kinds.sort();
    kinds.dedup();
    for expected in ["session_meta", "card", "message", "tool_call", "event"] {
        assert!(
            kinds.iter().any(|k| k == expected),
            "missing {expected} in {kinds:?}"
        );
    }
}

#[test]
fn hashing_is_on_by_default_and_off_with_flag() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);

    let masked = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    let unmasked = engine
        .export_session_with_salt(
            sid,
            &ExportOptions {
                hash_user_text: false,
                hash_file_paths: false,
                hash_ids: false,
                ..ExportOptions::default()
            },
            "fixed-salt",
        )
        .unwrap();

    assert!(
        !masked.contains("학생-42가 개인적으로"),
        "user text must be masked"
    );
    assert!(!masked.contains("src/App.tsx"), "file path must be masked");
    assert!(
        unmasked.contains("학생-42가 개인적으로"),
        "user text must pass through when off"
    );
    assert!(
        unmasked.contains("src/App.tsx"),
        "file path must pass through when off"
    );
}

#[test]
fn default_export_hashes_database_ids_and_pii_patterns() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: "student_note".into(),
                payload: json!({
                    "email": "student@example.edu",
                    "phone": "010-1234-5678",
                    "path": "src/private.ts"
                }),
            },
        )
        .unwrap();
    }

    let engine = ExportEngine::new(db);
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();

    assert!(
        !out.contains(r#""session_id":1"#),
        "raw session id must be hashed by default: {out}"
    );
    assert!(
        !out.contains(r#""id":1"#),
        "raw record ids must be hashed by default: {out}"
    );
    assert!(
        out.contains("id:session:"),
        "hashed session id missing: {out}"
    );
    assert!(out.contains("id:card:"), "hashed card id missing: {out}");
    assert!(!out.contains("student@example.edu"), "email must be masked");
    assert!(!out.contains("010-1234-5678"), "phone must be masked");
    assert!(!out.contains("src/private.ts"), "path must be masked");
}

#[test]
fn salt_differs_across_runs() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let a = engine
        .export_session(sid, &ExportOptions::default())
        .unwrap();
    let b = engine
        .export_session(sid, &ExportOptions::default())
        .unwrap();
    // Same session yet the hash prefixes should differ run-to-run because
    // the salt is regenerated each call.
    assert_ne!(
        a, b,
        "two fresh exports must diverge due to per-export salt"
    );
}

#[test]
fn options_exclude_sections() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let jsonl = engine
        .export_session(
            sid,
            &ExportOptions {
                include_messages: false,
                include_tool_calls: false,
                include_events: false,
                ..ExportOptions::default()
            },
        )
        .unwrap();
    let records = lines(&jsonl);
    for kind in ["message", "tool_call", "event"] {
        assert!(
            !records.iter().any(|r| r["kind"] == kind),
            "excluded kind must not appear: {kind}"
        );
    }
    assert!(records.iter().any(|r| r["kind"] == "session_meta"));
    assert!(records.iter().any(|r| r["kind"] == "card"));
}

#[test]
fn missing_session_errors() {
    let (db, _) = seed();
    let engine = ExportEngine::new(db);
    let err = engine
        .export_session(999_999, &ExportOptions::default())
        .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("999999") || msg.contains("not found"), "{msg}");
}

#[test]
fn salt_not_leaked_in_output() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let salt = "leaky-salt-should-not-appear";
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), salt)
        .unwrap();
    assert!(
        !out.contains(salt),
        "salt must never leak into JSONL output"
    );
}
