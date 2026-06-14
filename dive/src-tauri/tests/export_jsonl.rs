use std::sync::{Arc, Mutex};

use dive_lib::db::dao::{card, event_log, message, project, session, tool_call};
use dive_lib::db::models::{
    CardState, NewCard, NewEventLog, NewMessage, NewProject, NewSession, NewToolCall,
};
use dive_lib::export::{ExportEngine, ExportOptions};
use rusqlite::params;
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
            retrospective: Some("테스트를 확인했고 다음에는 오류 처리를 개선".into()),
            change_summary: None,
            state: CardState::Verified,
            verify_log: Some(
                r#"{"intent_match":true,"test_result":"skipped","details":"ok","model":"m","ran_at":1}"#
                    .into(),
            ),
            changed_files: Some(json!(["src/App.tsx", "src/LoginForm.tsx"])),
            test_command: None,
            approval_judgment: Some(
                r#"{"outcome":"approved_with_concern","note":"엣지케이스 불안","decided_at":1}"#
                    .into(),
            ),
            approval_provenance: None,
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
            reasoning_content: None,
            tool_calls: None,
            usage: None,
            provider: None,
            model: None,
        },
    )
    .unwrap();
    message::insert(
        db.conn(),
        &NewMessage {
            session_id: sid,
            card_id: None,
            role: "assistant".into(),
            content: "I read src/secret.ts and saw password=hunter2 plus ghp_abcdef1234567890"
                .into(),
            reasoning_content: None,
            tool_calls: None,
            usage: None,
            provider: Some("openai".into()),
            model: Some("gpt-test".into()),
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
    assert!(
        !masked.contains("테스트를 확인했고"),
        "retrospective raw text must be masked"
    );
    assert!(!masked.contains("src/App.tsx"), "file path must be masked");
    assert!(
        unmasked.contains("학생-42가 개인적으로"),
        "user text must pass through when off"
    );
    assert!(
        unmasked.contains("테스트를 확인했고"),
        "retrospective text must pass through when user text hashing is off"
    );
    assert!(
        unmasked.contains("src/App.tsx"),
        "file path must pass through when off"
    );
}

#[test]
fn default_export_hashes_all_message_roles() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();

    assert!(
        !out.contains("I read src/secret.ts"),
        "assistant content must not be exported verbatim by default: {out}"
    );
    assert!(!out.contains("password=hunter2"));
    assert!(!out.contains("ghp_abcdef1234567890"));

    let records = lines(&out);
    let assistant = records
        .iter()
        .find(|record| record["kind"] == "message" && record["role"] == "assistant")
        .expect("assistant message");
    assert!(
        assistant["content"]
            .as_str()
            .is_some_and(|value| value.starts_with("h:")),
        "assistant content should be hashed by default: {assistant:?}"
    );
}

#[test]
fn default_export_emits_retrospective_metrics_without_raw_text() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    assert!(
        !out.contains("테스트를 확인했고"),
        "default export must not leak raw retrospective text"
    );

    let records = lines(&out);
    let card = records
        .iter()
        .find(|record| record["kind"] == "card")
        .expect("card record");
    assert!(
        card["retrospective"]
            .as_str()
            .is_some_and(|value| value.starts_with("h:")),
        "retrospective should be hashed by default: {card:?}"
    );
    let metrics = &card["retrospective_metrics"];
    assert_eq!(metrics["schema_version"], 1);
    assert_eq!(metrics["mentions_verification"], true);
    assert_eq!(metrics["mentions_error"], true);
    assert_eq!(metrics["mentions_next_step"], true);
    assert!(
        metrics["char_count"].as_u64().unwrap_or_default() > 0,
        "metrics must preserve aggregate size without raw text: {metrics:?}"
    );
}

#[test]
fn export_emits_approval_judgment_and_metrics_for_card() {
    let (db, sid) = seed();
    let engine = ExportEngine::new(db);
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    assert!(out.contains("\"approval_judgment\""));
    assert!(out.contains("approved_with_concern"));
    assert!(out.contains("\"approval_judgment_metrics\""));

    let records = lines(&out);
    let card = records
        .iter()
        .find(|record| record["kind"] == "card")
        .expect("card record");
    assert_eq!(
        card["approval_judgment_metrics"]["outcome"],
        "approved_with_concern"
    );
    assert_eq!(card["approval_judgment_metrics"]["has_note"], true);
    assert!(
        !out.contains("엣지케이스 불안"),
        "default export must not leak raw approval note"
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
fn default_export_anonymizes_step_mapping_evidence_and_decision_json() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        let project_id: i64 = db_guard
            .conn()
            .query_row(
                "SELECT project_id FROM Session WHERE id = ?",
                [sid],
                |row| row.get(0),
            )
            .unwrap();
        db_guard
            .conn()
            .execute(
                "INSERT INTO Plan(project_id, interview_id, goal, intent_summary, scope, non_goals, constraints, acceptance_criteria, status, created_at, approved_at, updated_at) VALUES (?, NULL, ?, NULL, '[]', '[]', '[]', '[]', 'approved', 1, 1, 1)",
                params![project_id, "Export safety"],
            )
            .unwrap();
        let plan_id = db_guard.conn().last_insert_rowid();
        db_guard
            .conn()
            .execute(
                "INSERT INTO Step(plan_id, step_id, title, summary, instruction_seed, expected_files, acceptance_criteria, verification_kind, verification_command, verification_manual_check, dependencies, parallel_group, position, created_at, updated_at) VALUES (?, 'step_1', 'Check export', NULL, NULL, '[]', '[]', NULL, NULL, NULL, '[]', NULL, 1, 1, 1)",
                [plan_id],
            )
            .unwrap();
        let step_id = db_guard.conn().last_insert_rowid();
        db_guard
            .conn()
            .execute(
                "INSERT INTO StepSessionMapping(step_id, session_id, card_id, state_path, status, started_at, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at) VALUES (?, ?, NULL, ?, 'done', 1, 2, '[]', 'verified', ?, ?, 1, 2)",
                params![
                    step_id,
                    sid,
                    "src/state.json",
                    json!({
                        "path": "src/secret.ts",
                        "output": "Bearer secret-token-123",
                        "nested": { "password": "password=hunter2" }
                    })
                    .to_string(),
                    json!({
                        "note": "keep ghp_abcdef1234567890",
                        "reason": "reviewed src/secret.ts"
                    })
                    .to_string()
                ],
            )
            .unwrap();
    }

    let engine = ExportEngine::new(db);
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();

    for raw in [
        "src/secret.ts",
        "Bearer secret-token-123",
        "password=hunter2",
        "ghp_abcdef1234567890",
    ] {
        assert!(!out.contains(raw), "default export leaked {raw}: {out}");
    }

    let records = lines(&out);
    let mapping = records
        .iter()
        .find(|record| record["kind"] == "step_session_mapping")
        .expect("step mapping record");
    assert!(mapping["verification_evidence"]["path"]
        .as_str()
        .is_some_and(|value| value.starts_with("p:")));
    assert!(mapping["verification_evidence"]["output"]
        .as_str()
        .is_some_and(|value| value.starts_with("h:")));
    assert!(mapping["user_decision"]["note"]
        .as_str()
        .is_some_and(|value| value.starts_with("h:")));
}

#[test]
fn export_distinguishes_provocation_lifecycle_events_and_hashes_reason() {
    let (db, sid) = seed();
    let risk_reason = "package change is intentional for this task";
    {
        let db_guard = db.lock().unwrap();
        for (event_type, action_kind) in [
            ("provocation.card_shown", Value::Null),
            ("provocation.dismissed", json!("dismiss")),
            ("provocation.marked_irrelevant", json!("mark_irrelevant")),
            ("provocation.action_clicked", json!("open_diff")),
            (
                "provocation.continued_with_risk",
                json!("continue_with_risk"),
            ),
        ] {
            let payload = json!({
                "schemaVersion": 1,
                "eventId": format!("evt-{event_type}"),
                "timestamp": "2026-06-13T00:00:00.000Z",
                "sessionId": sid,
                "cardId": "diff_scope_drift:execute:tool-1",
                "cardType": "diff_scope_drift",
                "stage": "execute",
                "severity": "risk",
                "mode": "standard",
                "evidence": [{
                    "label": "고위험 변경 파일",
                    "source": "diff",
                    "value": {"kind": "paths", "paths": ["package.json"], "totalCount": 1}
                }],
                "selectedAction": if action_kind.is_null() {
                    Value::Null
                } else {
                    json!({"id": action_kind.as_str().unwrap(), "kind": action_kind, "label": "action", "requiresReason": event_type == "provocation.continued_with_risk"})
                },
                "reasonRequired": event_type == "provocation.continued_with_risk",
                "reasonPresent": event_type == "provocation.continued_with_risk",
                "reason": if event_type == "provocation.continued_with_risk" { json!(risk_reason) } else { Value::Null },
                "requiredReason": {
                    "required": event_type == "provocation.continued_with_risk",
                    "provided": event_type == "provocation.continued_with_risk",
                    "reason": if event_type == "provocation.continued_with_risk" { json!(risk_reason) } else { Value::Null }
                },
                "verificationStatus": {
                    "schemaVersion": 1,
                    "verificationState": "unverified_risk_accepted",
                    "statusIds": ["ai_self_report_only", "approved_with_risk"],
                    "evidenceSummary": {"concreteEvidence": false, "aiSelfReport": true},
                    "riskAccepted": event_type == "provocation.continued_with_risk"
                },
                "riskAccepted": event_type == "provocation.continued_with_risk"
            });
            event_log::insert(
                db_guard.conn(),
                &NewEventLog {
                    session_id: Some(sid),
                    r#type: event_type.into(),
                    payload,
                },
            )
            .unwrap();
        }
    }

    let engine = ExportEngine::new(db);
    let out = engine
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    assert!(out.contains("\"type\":\"provocation.dismissed\""));
    assert!(out.contains("\"type\":\"provocation.marked_irrelevant\""));
    assert!(out.contains("\"type\":\"provocation.action_clicked\""));
    assert!(out.contains("\"type\":\"provocation.continued_with_risk\""));
    assert!(
        !out.contains(risk_reason),
        "default export must hash required risk reasons: {out}"
    );
    assert!(
        !out.contains("package.json"),
        "default export must hash provocation file paths: {out}"
    );

    let records = lines(&out);
    let continued = records
        .iter()
        .find(|record| {
            record["kind"] == "event" && record["type"] == "provocation.continued_with_risk"
        })
        .expect("continued-with-risk event");
    assert_eq!(
        continued["payload"]["selectedAction"]["kind"],
        "continue_with_risk"
    );
    assert_eq!(continued["payload"]["reasonRequired"], true);
    assert!(continued["payload"]["reason"]
        .as_str()
        .is_some_and(|value| value.starts_with("h:")));
    assert_eq!(
        continued["payload"]["verificationStatus"]["verificationState"],
        "unverified_risk_accepted"
    );
    assert_eq!(continued["payload"]["riskAccepted"], true);
}

#[test]
fn provocation_event_export_summarizes_raw_bodies_even_when_hashing_is_off() {
    let (db, sid) = seed();
    let raw_prompt = "export function Secret() { return 'do not export this source body'; }";
    {
        let db_guard = db.lock().unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: "provocation.card_shown".into(),
                payload: json!({
                    "cardType": "ai_self_report_only",
                    "promptBody": raw_prompt,
                    "transcript": raw_prompt,
                    "sourceCode": raw_prompt,
                    "evidence": [{"label": "원문 요청", "source": "prompt", "value": raw_prompt}],
                }),
            },
        )
        .unwrap();
    }

    let out = ExportEngine::new(db)
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
        !out.contains(raw_prompt),
        "provocation raw prompt/transcript/source bodies must not export even when hashing is off"
    );

    let records = lines(&out);
    let event = records
        .iter()
        .find(|record| record["kind"] == "event" && record["type"] == "provocation.card_shown")
        .expect("provocation event");
    assert_eq!(event["payload"]["promptBody"]["redacted"], true);
    assert_eq!(event["payload"]["transcript"]["redacted"], true);
    assert_eq!(event["payload"]["sourceCode"]["redacted"], true);
    assert_eq!(event["payload"]["evidence"][0]["value"]["redacted"], true);
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
