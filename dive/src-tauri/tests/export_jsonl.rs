use std::sync::{Arc, Mutex};

use dive_lib::db::dao::{card, event_log, message, project, session, tool_call};
use dive_lib::db::models::{
    CardState, NewCard, NewEventLog, NewMessage, NewProject, NewSession, NewToolCall,
};
use dive_lib::dive::event_log as dive_event_log;
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
fn export_preserves_permission_read_gate_and_secret_outcomes_without_secret_text() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            "tool_call_start",
            json!({
                "tool": "write_file",
                "params_preview": "path: \".env\" OPENAI_API_KEY=sk-test-1234567890",
                "risk": "danger",
                "approvalWarnings": {
                    "secretFlagged": true,
                    "secretReasons": ["env_file", "named_secret"],
                    "wholeFileOverwrite": null
                }
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            "tool_approve",
            json!({
                "tool": "write_file",
                "tool_call_id": "secret-write",
                "risk": "danger",
                "approval_metadata": {
                    "source": "permission_card.approval",
                    "readGateSatisfied": true,
                    "readGateMethod": "checkbox",
                    "secretFlagged": true,
                    "warningKinds": ["secret_flagged"]
                }
            }),
        )
        .unwrap();
        // A read-gated approval WITHOUT a secret: its dominant outcome is
        // `read_gate_satisfied` (the secret event above dominates to
        // `secret_flagged`), so the export vocabulary covers both outcomes.
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            "tool_approve",
            json!({
                "tool": "edit_file",
                "tool_call_id": "read-gate-write",
                "risk": "warn",
                "approval_metadata": {
                    "source": "permission_card.approval",
                    "readGateSatisfied": true,
                    "readGateMethod": "scroll"
                }
            }),
        )
        .unwrap();
    }

    let engine = ExportEngine::new(db);
    let jsonl = engine
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

    assert!(jsonl.contains("read_gate_satisfied"));
    assert!(jsonl.contains("secret_flagged"));
    assert!(jsonl.contains("\"readGateSatisfied\":true"));
    assert!(jsonl.contains("\"secretFlagged\":true"));
    assert!(
        !jsonl.contains("sk-test-1234567890"),
        "permission export leaked a secret literal: {jsonl}"
    );
}

#[test]
fn export_distinguishes_008_runtime_events_and_redacts_outputs() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::PREVIEW_OPEN_REQUESTED_EVENT,
            json!({
                "requestId": "preview-1",
                "sessionId": sid,
                "cardId": 10,
                "kind": "static_file",
                "targetLabel": "index.html",
                "source": "review_action",
                "requestedAt": 0
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::PREVIEW_OPEN_RESULT_EVENT,
            json!({
                "requestId": "preview-1",
                "status": "ready",
                "targetLabel": "index.html",
                "reasonCode": null,
                "message": "Preview opened.",
                "resolvedAt": 1
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::RUNTIME_ROUTING_DECISION_EVENT,
            json!({
                "decisionId": "route-1",
                "sessionId": sid,
                "cardId": 10,
                "toolCallId": "cmd-0",
                "inputKind": "project_command",
                "outcome": "rerouted",
                "reasonCode": "preview_open_shell_workaround",
                "evidenceRefs": [{
                    "tool": "run_process",
                    "previewTarget": "index.html",
                    "commandRan": false
                }],
                "message": "DIVE did not run the command. Use Preview.",
                "commandRan": false,
                "createdAt": 1
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::PROJECT_COMMAND_RESULT_EVENT,
            json!({
                "toolCallId": "cmd-1",
                "sessionId": sid,
                "cardId": 10,
                "commandLabel": "pnpm test",
                "executable": "pnpm",
                "args": ["test"],
                "timeoutSec": 60,
                "reason": "Run the step verification command.",
                "expectedEffect": "Runs tests without changing project files.",
                "status": "completed",
                "success": true,
                "exitCode": 0,
                "summary": "exit 0",
                "stdoutSummary": "secret_token=abc123\nok",
                "stderrSummary": "",
                "createdAt": 2
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT,
            json!({
                "toolCallId": "script-1",
                "sessionId": sid,
                "cardId": 10,
                "shellFamily": "posix",
                "scriptSummary": "echo $API_KEY && pnpm test",
                "reason": "Run two checks with shell sequencing.",
                "expectedEffect": "Runs tests without changing project files.",
                "timeoutSec": 120,
                "outputLimit": 32768,
                "riskFactors": ["shell_script", "one_shot_high_risk"],
                "oneShot": true,
                "approvalReuse": false,
                "requestedAt": 3
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::TERMINAL_SCRIPT_RESULT_EVENT,
            json!({
                "toolCallId": "script-1",
                "status": "blocked",
                "success": false,
                "exitCode": null,
                "summary": "blocked before execution",
                "stdoutSummary": "",
                "stderrSummary": "API_KEY=secret-value",
                "truncated": false,
                "resolvedAt": 4
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::TOOL_APPROVAL_STALE_EVENT,
            json!({
                "toolCallId": "cmd-2",
                "sessionId": sid,
                "detectedBy": "approval_click",
                "message": "No command ran.",
                "resolvedAt": 5
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::WEB_FETCH_APPROVAL_REQUESTED_EVENT,
            dive_event_log::web_fetch_approval_requested_payload(
                "web-1",
                sid,
                Some(10),
                &json!({
                    "url": "https://example.com/reset/token-123?code=oauth-secret",
                    "purpose": "Read public API docs.",
                    "web_fetch_approval": {
                        "host": "example.com",
                        "pinnedIp": "93.184.216.34",
                        "port": 443,
                        "scheme": "https",
                        "pathHash": "pathhash",
                        "queryDropped": true,
                        "purpose": "Read public API docs.",
                        "approvedAt": 6
                    }
                }),
            ),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::WEB_FETCH_RESULT_EVENT,
            dive_event_log::web_fetch_result_payload(
                "web-1",
                "completed",
                true,
                "web fetch completed",
                Some(&json!({
                    "runtimeAction": "web_fetch",
                    "status": "completed",
                    "success": true,
                    "host": "example.com",
                    "resolvedIp": "93.184.216.34",
                    "bytesOnWire": 100,
                    "elapsedMs": 50,
                    "bodySnippet": "opaque body token secret-body-value",
                    "isEvidence": false
                })),
            ),
        )
        .unwrap();
    }

    let engine = ExportEngine::new(db);
    let jsonl = engine
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
    let records = lines(&jsonl);

    for expected in [
        dive_event_log::PREVIEW_OPEN_REQUESTED_EVENT,
        dive_event_log::PREVIEW_OPEN_RESULT_EVENT,
        dive_event_log::RUNTIME_ROUTING_DECISION_EVENT,
        dive_event_log::PROJECT_COMMAND_RESULT_EVENT,
        dive_event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT,
        dive_event_log::TERMINAL_SCRIPT_RESULT_EVENT,
        dive_event_log::TOOL_APPROVAL_STALE_EVENT,
        dive_event_log::WEB_FETCH_APPROVAL_REQUESTED_EVENT,
        dive_event_log::WEB_FETCH_RESULT_EVENT,
    ] {
        assert!(
            records
                .iter()
                .any(|record| record["kind"] == "event" && record["type"] == expected),
            "missing runtime event {expected}"
        );
    }

    let preview = records
        .iter()
        .find(|record| record["type"] == dive_event_log::PREVIEW_OPEN_RESULT_EVENT)
        .expect("preview event");
    assert_eq!(
        preview["payload"]["evidenceSummary"]["previewIsFinalVerification"],
        false
    );

    let command = records
        .iter()
        .find(|record| record["type"] == dive_event_log::PROJECT_COMMAND_RESULT_EVENT)
        .expect("command event");
    assert_eq!(command["payload"]["commandLabel"], "pnpm test");
    assert_eq!(command["payload"]["executable"], "pnpm");
    assert_eq!(command["payload"]["args"], json!(["test"]));
    assert_eq!(command["payload"]["timeoutSec"], 60);
    assert_eq!(
        command["payload"]["reason"],
        "Run the step verification command."
    );
    assert_eq!(
        command["payload"]["expectedEffect"],
        "Runs tests without changing project files."
    );
    assert_eq!(command["payload"]["evidenceSummary"]["aiSelfReport"], false);
    assert_eq!(
        command["payload"]["evidenceSummary"]["externalTestRun"],
        true
    );
    assert_eq!(command["payload"]["stdoutSummary"]["redacted"], true);
    assert!(!jsonl.contains("secret_token=abc123"));
    assert!(!jsonl.contains("echo $API_KEY"));
    assert!(!jsonl.contains("oauth-secret"));
    assert!(!jsonl.contains("token-123"));
    assert!(!jsonl.contains("secret-body-value"));

    let script_approval = records
        .iter()
        .find(|record| record["type"] == dive_event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT)
        .expect("terminal script approval event");
    assert_eq!(script_approval["payload"]["oneShot"], true);
    assert_eq!(script_approval["payload"]["approvalReuse"], false);
    assert_eq!(
        script_approval["payload"]["scriptSummary"]["redacted"],
        true
    );

    let stale = records
        .iter()
        .find(|record| record["type"] == dive_event_log::TOOL_APPROVAL_STALE_EVENT)
        .expect("stale event");
    assert_eq!(stale["payload"]["evidenceSummary"]["commandRan"], false);

    let routing = records
        .iter()
        .find(|record| record["type"] == dive_event_log::RUNTIME_ROUTING_DECISION_EVENT)
        .expect("routing event");
    assert_eq!(routing["payload"]["outcome"], "rerouted");
    assert_eq!(routing["payload"]["commandRan"], false);
    assert_eq!(
        routing["payload"]["evidenceSummary"]["verificationEvidence"],
        false
    );

    let web_result = records
        .iter()
        .find(|record| record["type"] == dive_event_log::WEB_FETCH_RESULT_EVENT)
        .expect("web fetch result event");
    assert_eq!(web_result["payload"]["isEvidence"], false);
    assert_eq!(web_result["payload"]["bodyPersisted"], false);
}

#[test]
fn mixed_product_session_export_is_reconstructable_across_runtime_review_and_approval() {
    let (db, sid) = seed();
    let card_id = {
        let db_guard = db.lock().unwrap();
        db_guard
            .conn()
            .query_row(
                "SELECT id FROM Card WHERE session_id = ? ORDER BY id LIMIT 1",
                params![sid],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
    };
    {
        let db_guard = db.lock().unwrap();
        let conn = db_guard.conn();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            dive_event_log::PREVIEW_OPEN_REQUESTED_EVENT,
            json!({
                "requestId": "mixed-preview-1",
                "sessionId": sid,
                "cardId": card_id,
                "kind": "static_file",
                "targetLabel": "index.html",
                "source": "review_action",
                "requestedAt": 10
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            dive_event_log::PREVIEW_OPEN_RESULT_EVENT,
            json!({
                "requestId": "mixed-preview-1",
                "sessionId": sid,
                "cardId": card_id,
                "status": "ready",
                "targetLabel": "index.html",
                "reasonCode": null,
                "message": "Preview opened.",
                "resolvedAt": 11
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            dive_event_log::PROJECT_COMMAND_RESULT_EVENT,
            json!({
                "toolCallId": "mixed-command-1",
                "sessionId": sid,
                "cardId": card_id,
                "commandLabel": "pnpm test",
                "executable": "pnpm",
                "args": ["test"],
                "timeoutSec": 60,
                "reason": "Run the automated verification command.",
                "expectedEffect": "Runs the test suite without editing files.",
                "status": "completed",
                "success": true,
                "exitCode": 0,
                "summary": "tests passed",
                "stdoutSummary": "ok secret_token=do-not-export",
                "stderrSummary": "",
                "createdAt": 12
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            dive_event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT,
            dive_event_log::terminal_script_approval_requested_payload(
                "mixed-script-1",
                sid,
                Some(card_id),
                &json!({
                    "script": "printf done && pnpm test",
                    "shell_family": "posix",
                    "reason": "The check needs shell sequencing.",
                    "expected_effect": "Runs bounded verification commands.",
                    "timeout_sec": 60,
                    "output_limit": 4096
                }),
            ),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            dive_event_log::TERMINAL_SCRIPT_RESULT_EVENT,
            dive_event_log::terminal_script_result_payload(
                "mixed-script-1",
                "completed",
                true,
                "terminal script completed",
                Some(&json!({
                    "exitCode": 0,
                    "stdout": "done token=do-not-export",
                    "stderr": "",
                    "truncated": false
                })),
            ),
        )
        .unwrap();
        event_log::insert(
            conn,
            &NewEventLog {
                session_id: Some(sid),
                r#type: "provocation.card_shown".into(),
                payload: json!({
                    "schemaVersion": 1,
                    "eventId": "mixed-review-card-1",
                    "timestamp": "2026-06-21T00:00:00.000Z",
                    "sessionId": sid,
                    "taskId": card_id,
                    "cardId": "provocation:mixed-card",
                    "cardType": "ai_self_report_only",
                    "stage": "verify",
                    "severity": "caution",
                    "mode": "work",
                    "evidence": [{
                        "label": "AI 완료 주장",
                        "source": "agent",
                        "value": {"kind": "claim", "text": "student@example.com says done"}
                    }],
                    "selectedAction": Value::Null,
                    "reasonRequired": false,
                    "reasonPresent": false,
                    "reason": Value::Null,
                    "verificationStatus": {
                        "schemaVersion": 1,
                        "verificationState": "unverified",
                        "statusIds": ["ai_self_report_only"],
                        "evidenceSummary": {
                            "concreteEvidence": false,
                            "aiSelfReport": true,
                            "manualEvidenceCount": 0
                        },
                        "riskAccepted": false
                    },
                    "riskAccepted": false
                }),
            },
        )
        .unwrap();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            dive_event_log::VERIFICATION_OBSERVATION_RECORDED_EVENT,
            json!({
                "observationId": "mixed-observation-1",
                "sessionId": sid,
                "cardId": card_id,
                "criterionIds": ["AC-001"],
                "evidenceKind": "preview_observation",
                "observationText": "I saw the login form work for student@example.com",
                "recordedAt": 13
            }),
        )
        .unwrap();
        dive_event_log::append_to_conn(
            conn,
            Some(sid),
            "card_update",
            json!({
                "action": "transition",
                "transition": "approved",
                "card_id": card_id,
                "approval_provenance": {
                    "schemaVersion": 1,
                    "approvalOutcome": "approved",
                    "verificationState": "verified_with_evidence",
                    "riskAccepted": false,
                    "evidenceSummary": {
                        "concreteEvidence": true,
                        "aiSelfReport": false,
                        "automatedTestsPassed": true,
                        "manualEvidenceCount": 1,
                        "observationIds": ["mixed-observation-1"]
                    }
                },
                "createdAt": 14
            }),
        )
        .unwrap();
    }

    let jsonl = ExportEngine::new(db)
        .export_session_with_salt(
            sid,
            &ExportOptions {
                hash_user_text: true,
                hash_file_paths: false,
                hash_ids: false,
                ..ExportOptions::default()
            },
            "fixed-salt",
        )
        .unwrap();
    let records = lines(&jsonl);

    for expected in [
        dive_event_log::PREVIEW_OPEN_RESULT_EVENT,
        dive_event_log::PROJECT_COMMAND_RESULT_EVENT,
        dive_event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT,
        dive_event_log::TERMINAL_SCRIPT_RESULT_EVENT,
        "provocation.card_shown",
        dive_event_log::VERIFICATION_OBSERVATION_RECORDED_EVENT,
        "card_update",
    ] {
        assert!(
            records
                .iter()
                .any(|record| record["kind"] == "event" && record["type"] == expected),
            "missing mixed-session event {expected}: {jsonl}"
        );
    }

    let preview = records
        .iter()
        .find(|record| record["type"] == dive_event_log::PREVIEW_OPEN_RESULT_EVENT)
        .expect("preview result");
    assert_eq!(preview["payload"]["cardId"], card_id);
    assert_eq!(preview["payload"]["decision"]["kind"], "preview_result");
    assert_eq!(
        preview["payload"]["evidenceSummary"]["previewAvailable"],
        true
    );
    assert_eq!(
        preview["payload"]["evidenceSummary"]["previewIsFinalVerification"],
        false
    );

    let command = records
        .iter()
        .find(|record| record["type"] == dive_event_log::PROJECT_COMMAND_RESULT_EVENT)
        .expect("project command result");
    assert_eq!(command["payload"]["cardId"], card_id);
    assert_eq!(
        command["payload"]["decision"]["kind"],
        "project_command_result"
    );
    assert_eq!(command["payload"]["evidenceSummary"]["commandRan"], true);
    assert_eq!(
        command["payload"]["evidenceSummary"]["automatedTestsPassed"],
        true
    );

    let script = records
        .iter()
        .find(|record| record["type"] == dive_event_log::TERMINAL_SCRIPT_RESULT_EVENT)
        .expect("terminal script result");
    assert_eq!(
        script["payload"]["decision"]["kind"],
        "terminal_script_result"
    );
    assert_eq!(
        script["payload"]["evidenceSummary"]["terminalScriptResult"],
        true
    );
    assert_eq!(
        script["payload"]["evidenceSummary"]["externalTestRun"],
        true
    );

    let card = records
        .iter()
        .find(|record| record["type"] == "provocation.card_shown")
        .expect("review card event");
    assert_eq!(card["payload"]["cardType"], "ai_self_report_only");
    assert_eq!(
        card["payload"]["verificationStatus"]["evidenceSummary"]["aiSelfReport"],
        true
    );

    let observation = records
        .iter()
        .find(|record| record["type"] == dive_event_log::VERIFICATION_OBSERVATION_RECORDED_EVENT)
        .expect("manual observation event");
    assert_eq!(
        observation["payload"]["evidenceSummary"]["manualEvidenceCount"],
        1
    );
    assert_eq!(
        observation["payload"]["evidenceSummary"]["concreteEvidence"],
        true
    );
    assert!(observation["payload"]["observationText"]
        .as_str()
        .is_some_and(|value| value.starts_with("h:")));

    let approval = records
        .iter()
        .find(|record| record["type"] == "card_update")
        .expect("final approval event");
    assert_eq!(approval["payload"]["decision"]["kind"], "card_transition");
    assert_eq!(
        approval["payload"]["decision"]["approvalOutcome"],
        "approved"
    );
    assert_eq!(
        approval["payload"]["evidenceSummary"]["concreteEvidence"],
        true
    );
    assert_eq!(
        approval["payload"]["evidenceSummary"]["observationIds"],
        json!(["mixed-observation-1"])
    );

    for raw in [
        "secret_token=do-not-export",
        "token=do-not-export",
        "student@example.com",
        "I saw the login form work",
    ] {
        assert!(!jsonl.contains(raw), "mixed export leaked {raw}: {jsonl}");
    }
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

fn project_id_for_session(db: &Arc<Mutex<dive_lib::Database>>, sid: i64) -> i64 {
    db.lock()
        .unwrap()
        .conn()
        .query_row(
            "SELECT project_id FROM Session WHERE id = ?",
            [sid],
            |row| row.get(0),
        )
        .unwrap()
}

fn card_event_payload(project_id: i64, session_id: Option<i64>, lifecycle: &str) -> Value {
    json!({
        "schemaVersion": 1,
        "lifecycleEvent": lifecycle,
        "projectId": project_id,
        "sessionId": session_id,
        "cardId": "prd_intent_check:decompose:draft-1",
        "exposureId": "exp-1",
        "cardType": "prd_intent_check",
        "stage": "decompose",
        "severity": "caution",
        "mode": "work",
    })
}

// Spec 015 FR-005 / SC-002 / SC-003: review-card hosts without a session in
// scope send `sessionId: null`. With several sessions in the project, every
// `provocation.*` event must land in exactly one session's export, each
// exposure entirely in one session (even when a newer session starts before
// its terminal event), and nothing may leak into another session's export.
#[test]
fn every_provocation_event_is_exported_once_with_each_exposure_in_one_session() {
    let (db, first) = seed();
    let project_id = project_id_for_session(&db, first);
    let question = "이 목표 요약이 내가 만들려는 것과 같은지 확인할 수 있나요?";
    let new_session = |title: &str| {
        session::insert(
            db.lock().unwrap().conn(),
            &NewSession {
                project_id,
                title: title.into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap()
    };
    let append = |session_id: Option<i64>, event_type: &str, payload: Value| {
        dive_event_log::append_provocation_event_to_conn(
            db.lock().unwrap().conn(),
            session_id,
            event_type,
            &payload,
        )
        .unwrap();
    };
    let event = |exposure: &str, lifecycle: &str| {
        let mut payload = card_event_payload(project_id, None, lifecycle);
        payload["exposureId"] = json!(exposure);
        payload
    };

    // Exposure 1 opens in the first session with no client session id...
    let mut shown = event("exp-1", "card_shown");
    shown["question"] = json!(question);
    append(None, "provocation.card_shown", shown);
    // ...then a step start creates a second session before it ends.
    let second = new_session("step 2");
    let mut unanswered = event("exp-1", "card_unanswered");
    unanswered["visibleMs"] = json!(4200);
    unanswered["unansweredReason"] = json!("replaced");
    append(None, "provocation.card_unanswered", unanswered);

    // Exposure 2 opens after the second session exists and is answered with
    // an explicit session id.
    append(None, "provocation.card_shown", event("exp-2", "card_shown"));
    let mut clicked = event("exp-2", "action_clicked");
    clicked["responseLatencyMs"] = json!(900);
    append(Some(second), "provocation.action_clicked", clicked);

    // An archived newest session never receives fallback rows.
    let archived = new_session("archived");
    db.lock()
        .unwrap()
        .conn()
        .execute(
            "UPDATE Session SET status = 'archived' WHERE id = ?",
            [archived],
        )
        .unwrap();
    append(None, "provocation.card_shown", event("exp-3", "card_shown"));

    // No project: stays unscoped rather than guessed.
    let mut orphan = event("exp-4", "card_shown");
    orphan.as_object_mut().unwrap().remove("projectId");
    append(None, "provocation.card_shown", orphan);

    let exported = |sid: i64| {
        lines(
            &ExportEngine::new(db.clone())
                .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
                .unwrap(),
        )
        .into_iter()
        .filter(|record| {
            record["kind"] == "event"
                && record["type"]
                    .as_str()
                    .is_some_and(|ty| ty.starts_with("provocation."))
        })
        .collect::<Vec<_>>()
    };
    let exposures = |records: &[Value]| {
        records
            .iter()
            .map(|record| {
                (
                    record["type"].as_str().unwrap().to_string(),
                    record["payload"]["exposureId"]
                        .as_str()
                        .unwrap()
                        .to_string(),
                )
            })
            .collect::<Vec<_>>()
    };
    let first_export = exported(first);
    let second_export = exported(second);
    assert_eq!(
        exposures(&first_export),
        vec![
            ("provocation.card_shown".into(), "exp-1".into()),
            ("provocation.card_unanswered".into(), "exp-1".into()),
        ]
    );
    assert_eq!(
        exposures(&second_export),
        vec![
            ("provocation.card_shown".into(), "exp-2".into()),
            ("provocation.action_clicked".into(), "exp-2".into()),
            ("provocation.card_shown".into(), "exp-3".into()),
        ]
    );
    assert!(exported(archived).is_empty());

    // Every stored provocation row with a session is in exactly one export;
    // only the project-less orphan is unscoped.
    let (scoped, unscoped): (i64, i64) = db
        .lock()
        .unwrap()
        .conn()
        .query_row(
            "SELECT SUM(session_id IS NOT NULL), SUM(session_id IS NULL) FROM EventLog WHERE type LIKE 'provocation.%'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(scoped as usize, first_export.len() + second_export.len());
    assert_eq!(unscoped, 1);

    let shown = &first_export[0];
    // D-015-03: the generated question is exported in plain text.
    assert_eq!(shown["payload"]["question"], json!(question));
    assert_eq!(
        shown["payload"]["sessionResolvedBy"],
        json!("project_latest")
    );
    let unanswered = &first_export[1];
    assert_eq!(
        unanswered["payload"]["sessionResolvedBy"],
        json!("exposure")
    );
    assert_eq!(unanswered["payload"]["visibleMs"], json!(4200));
    assert_eq!(unanswered["payload"]["unansweredReason"], json!("replaced"));
    assert_eq!(second_export[1]["payload"]["responseLatencyMs"], json!(900));
    assert!(second_export[1]["payload"]
        .get("sessionResolvedBy")
        .is_none());
}

/// Supervisor contexts built by the production builders from the kind of
/// input the frontend sends: a RetryLoop context whose failure fingerprint and
/// last action carry raw error text, and a DiffReady context whose unexpected
/// files are not path-shaped (`.env`, `README`).
fn realistic_supervisor_contexts() -> (
    dive_lib::dive::SupervisorContext,
    dive_lib::dive::SupervisorContext,
) {
    use dive_lib::dive::supervisor::{
        build_diff_ready_supervisor_context, build_retry_loop_supervisor_context,
        DiffReadyReviewAssessment, DiffReadySupervisorContextBuildInput, RetryLoopReviewAssessment,
        RetryLoopSupervisorContextBuildInput,
    };
    use dive_lib::dive::{
        ArtifactRef, PlanSummary, ScopeExpansionEvidenceRefInput, SourceUiMode, SupervisorActionId,
        SupervisorVerificationUiState, VerificationFeasibility,
    };
    let verification = SupervisorVerificationUiState {
        ai_claimed_done: true,
        diff_reviewed: false,
        app_launched: false,
        preview_checked: false,
        automated_tests_passed: false,
        test_result: None,
        test_command: None,
        test_exit_code: None,
        acceptance_criterion_confirmed: false,
        manual_checks: vec![],
    };
    let feasibility = VerificationFeasibility {
        runnable: true,
        previewable: false,
        has_tests: true,
        diff_available: true,
    };
    let evidence = |id: &str, kind: &str, value: Value| ScopeExpansionEvidenceRefInput {
        id: id.into(),
        source: Some("verification".into()),
        kind: Some(kind.into()),
        label: Some(id.into()),
        value_summary: value,
        verification_evidence: false,
    };
    let fingerprint = "typeerror: zebra_fail_marker at loginform (minji@example.com)";
    let retry = build_retry_loop_supervisor_context(RetryLoopSupervisorContextBuildInput {
        artifact_ref: ArtifactRef::step("step-1", "민지의 로그인 폼"),
        source_ui_mode: SourceUiMode::Standard,
        locale: "ko-KR".into(),
        goal_summary: "민지의 로그인 폼 완성".into(),
        plan_summary: PlanSummary {
            step_count: 2,
            active_step: Some("로그인 폼".into()),
        },
        verification: verification.clone(),
        feasibility: feasibility.clone(),
        allowed_action_ids: vec![
            SupervisorActionId::CreateReproSteps,
            SupervisorActionId::OpenDiff,
        ],
        evidence_refs: vec![
            evidence(
                "failure.fingerprint",
                "failure_summary",
                json!({ "fingerprint": fingerprint }),
            ),
            evidence(
                "failure.last_action",
                "failure_summary",
                json!("rolled back zebra_action_marker"),
            ),
        ],
        retry_loop_assessment: RetryLoopReviewAssessment {
            eligible: true,
            reason_codes: vec!["same_failure_repeated".into()],
            evidence_refs: vec!["failure.fingerprint".into(), "failure.last_action".into()],
            failure_fingerprint: fingerprint.into(),
            failure_count: 2,
            last_failure_at: json!(1),
            last_action_summary: Some("rolled back zebra_action_marker".into()),
            recovery_available: true,
        },
    })
    .context;
    let unexpected = vec![
        ".env".to_string(),
        "README".into(),
        "config/app.yaml".into(),
    ];
    let diff = build_diff_ready_supervisor_context(DiffReadySupervisorContextBuildInput {
        artifact_ref: ArtifactRef::step("step-1", "민지의 로그인 폼"),
        source_ui_mode: SourceUiMode::Standard,
        locale: "ko-KR".into(),
        goal_summary: "민지의 로그인 폼 완성".into(),
        plan_summary: PlanSummary {
            step_count: 2,
            active_step: Some("로그인 폼".into()),
        },
        verification,
        feasibility,
        allowed_action_ids: vec![SupervisorActionId::OpenDiff],
        evidence_refs: vec![evidence(
            "diff.unexpected_files",
            "diff_ready_assessment",
            json!({ "totalCount": 3, "paths": unexpected }),
        )],
        diff_ready_assessment: DiffReadyReviewAssessment {
            eligible: true,
            reason_codes: vec!["outside_expected_files".into()],
            evidence_refs: vec!["diff.unexpected_files".into()],
            changed_file_count: 3,
            unexpected_files: unexpected.clone(),
            high_risk_files: vec![".env".into()],
            diff_viewed: false,
        },
    })
    .context;
    (retry, diff)
}

const LEAK_MARKERS: &[&str] = &[
    "zebra_fail_marker",
    "zebra_action_marker",
    "minji@example.com",
    "\".env\"",
    "README",
    "config/app.yaml",
];

// S-078 security review P1-1: the default session export must not carry the
// raw error text of a RetryLoop assessment or non-path-shaped file names of a
// DiffReady assessment, whether they arrive in `assessmentSummary`, the
// evidence refs, or card metadata.
#[test]
fn default_export_hashes_failure_text_and_unexpected_files_from_real_contexts() {
    let (db, sid) = seed();
    let (retry, diff) = realistic_supervisor_contexts();
    for (index, context) in [retry, diff].iter().enumerate() {
        let validation = dive_lib::dive::no_card_validation_result(
            dive_lib::dive::SupervisorDropReason::ProvokeFalse,
        );
        let log = dive_lib::dive::SupervisorEvaluationLog::from_validation(
            context,
            None,
            &validation,
            None,
            None,
            None,
        );
        assert!(log.assessment_summary.is_some());
        dive_event_log::append_supervisor_evaluation_to_conn(
            db.lock().unwrap().conn(),
            sid,
            &format!("eval-real-{index}"),
            &log,
        )
        .unwrap();
    }
    let out = ExportEngine::new(db)
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    for marker in LEAK_MARKERS {
        assert!(
            !out.contains(marker),
            "{marker} leaked into the default export: {out}"
        );
    }
    let evaluated = lines(&out)
        .into_iter()
        .filter(|record| record["type"] == "provocation.supervisor_evaluated")
        .collect::<Vec<_>>();
    assert!(
        evaluated[0]["payload"]["assessmentSummary"]["failureFingerprint"]
            .as_str()
            .unwrap()
            .starts_with("h:")
    );
    assert!(
        evaluated[1]["payload"]["assessmentSummary"]["unexpectedFiles"][0]
            .as_str()
            .unwrap()
            .starts_with("p:")
    );
}

fn seed_replay(db: &Arc<Mutex<dive_lib::Database>>, sid: Option<i64>, evaluation_id: &str) {
    use dive_lib::db::dao::supervision_replay::{self, NewSupervisionReplay, ReplaySurface};
    let (surface, context_json) = if evaluation_id.starts_with("prd") {
        (
            ReplaySurface::PrdInterview,
            json!({
                "draftJson": "{\"goal\":\"민지의 독서 기록 앱\"}",
                "missingConfirmable": "intent summary",
                "nextFocus": "capture_intent_summary",
                "conversation": "Student: 민지가 쓸 앱",
                "answer": "학생-42 민지의 독서 기록 앱",
                "jsonContractRetry": false
            }),
        )
    } else {
        // The exact SupervisorContext the production path stores.
        let (retry, diff) = realistic_supervisor_contexts();
        let context = if evaluation_id.contains("retry") {
            retry
        } else {
            diff
        };
        (
            ReplaySurface::Supervisor,
            serde_json::to_value(context).unwrap(),
        )
    };
    supervision_replay::insert(
        db.lock().unwrap().conn(),
        &NewSupervisionReplay {
            evaluation_id: evaluation_id.into(),
            surface,
            session_id: sid,
            project_id: None,
            prompt_version: "1.0.0+256c9520".into(),
            policy_version: Some("1.0.0".into()),
            model: Some("mock-model".into()),
            context_json: context_json.to_string(),
            raw_output: Some(
                "{\"question\":\"변경 파일이 목표와 맞나요?\",\"note\":\"token=abcd1234\"}".into(),
            ),
            validation_json: json!({"validationOutcome": "shown"}).to_string(),
        },
    )
    .unwrap();
}

// Spec 015 FR-021 / D-015-02: replay rows (full prompt inputs with student
// text) never enter the default export; `include_replay` is the explicit
// research replay export and runs them through the anonymizer.
#[test]
fn replay_rows_are_excluded_by_default_and_anonymized_when_included() {
    let (db, sid) = seed();
    seed_replay(&db, Some(sid), "sup-eval-1");
    seed_replay(&db, Some(sid), "sup-retry-1");
    seed_replay(&db, Some(sid), "prd-eval-1");
    seed_replay(&db, None, "sup-eval-unscoped");

    let default_out = ExportEngine::new(db.clone())
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    assert!(!default_out.contains("\"kind\":\"replay\""));
    assert!(!default_out.contains("sup-eval-1"));

    let out = ExportEngine::new(db.clone())
        .export_session_with_salt(
            sid,
            &ExportOptions {
                include_replay: true,
                ..ExportOptions::default()
            },
            "fixed-salt",
        )
        .unwrap();
    let replays = lines(&out)
        .into_iter()
        .filter(|record| record["kind"] == "replay")
        .collect::<Vec<_>>();
    assert_eq!(
        replays
            .iter()
            .map(|record| record["evaluation_id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["sup-eval-1", "sup-retry-1", "prd-eval-1"]
    );
    assert!(!out.contains("민지"), "student text must be hashed: {out}");
    for marker in LEAK_MARKERS {
        assert!(
            !out.contains(marker),
            "{marker} leaked into the replay export: {out}"
        );
    }
    assert!(!out.contains("abcd1234"), "secrets must be redacted: {out}");
    let supervisor = &replays[0];
    assert_eq!(supervisor["surface"], json!("supervisor"));
    assert_eq!(supervisor["prompt_version"], json!("1.0.0+256c9520"));
    assert_eq!(supervisor["context"]["event"], json!("diff_ready"));
    assert!(supervisor["context"]["goalSummary"]
        .as_str()
        .unwrap()
        .starts_with("h:"));
    assert!(
        supervisor["context"]["diffReadyAssessment"]["unexpectedFiles"][0]
            .as_str()
            .unwrap()
            .starts_with("p:")
    );
    assert!(
        replays[1]["context"]["retryLoopAssessment"]["failureFingerprint"]
            .as_str()
            .unwrap()
            .starts_with("h:")
    );
    // AI output stays readable apart from the redaction.
    assert!(supervisor["raw_output"]
        .as_str()
        .unwrap()
        .contains("변경 파일이 목표와 맞나요?"));
    assert_eq!(
        supervisor["validation"]["validationOutcome"],
        json!("shown")
    );
    let prd = &replays[2];
    assert!(prd["context"]["answer"].as_str().unwrap().starts_with("h:"));
    assert_eq!(prd["context"]["nextFocus"], json!("capture_intent_summary"));

    // With hashing off the prompt inputs are exported as stored (still
    // secret-redacted).
    let plain = ExportEngine::new(db)
        .export_session_with_salt(
            sid,
            &ExportOptions {
                include_replay: true,
                hash_user_text: false,
                hash_file_paths: false,
                hash_ids: false,
                ..ExportOptions::default()
            },
            "fixed-salt",
        )
        .unwrap();
    assert!(plain.contains("학생-42 민지의 독서 기록 앱"));
    assert!(!plain.contains("abcd1234"));
}

// PRD interview replies restate the student's goal and answers nearly
// verbatim, so with `hash_user_text` on their raw output is hashed; the
// supervisor and coach replies stay readable AI output (D-015-03). Secrets are
// redacted on every surface either way.
#[test]
fn replay_raw_output_is_hashed_as_user_text_only_for_the_prd_interview() {
    use dive_lib::db::dao::supervision_replay::{self, NewSupervisionReplay, ReplaySurface};
    let (db, sid) = seed();
    let surfaces = [
        (
            ReplaySurface::Supervisor,
            "sup",
            "변경 파일이 목표와 맞나요?",
        ),
        (
            ReplaySurface::Coach,
            "coach",
            "375px에서 열이 바뀌는지 보세요",
        ),
        (
            ReplaySurface::PrdInterview,
            "prd",
            "민지의 독서 기록 앱을 만들고 싶군요",
        ),
    ];
    for (surface, id, phrase) in surfaces {
        supervision_replay::insert(
            db.lock().unwrap().conn(),
            &NewSupervisionReplay {
                evaluation_id: format!("{id}-raw"),
                surface,
                session_id: Some(sid),
                project_id: None,
                prompt_version: "1.0.0+00000000".into(),
                policy_version: None,
                model: None,
                context_json: "{}".into(),
                raw_output: Some(format!("{phrase} token=abcd1234")),
                validation_json: "{}".into(),
            },
        )
        .unwrap();
    }
    let raw_outputs = |hash_user_text: bool| {
        let out = ExportEngine::new(db.clone())
            .export_session_with_salt(
                sid,
                &ExportOptions {
                    include_replay: true,
                    hash_user_text,
                    ..ExportOptions::default()
                },
                "fixed-salt",
            )
            .unwrap();
        assert!(
            !out.contains("abcd1234"),
            "secrets are always redacted: {out}"
        );
        lines(&out)
            .into_iter()
            .filter(|record| record["kind"] == "replay")
            .map(|record| {
                (
                    record["surface"].as_str().unwrap().to_string(),
                    record["raw_output"].as_str().unwrap().to_string(),
                )
            })
            .collect::<std::collections::HashMap<_, _>>()
    };

    let hashed = raw_outputs(true);
    assert!(hashed["supervisor"].starts_with("변경 파일이 목표와 맞나요?"));
    assert!(hashed["coach"].starts_with("375px에서 열이 바뀌는지 보세요"));
    assert!(hashed["prd_interview"].starts_with("h:"));
    assert!(!hashed["prd_interview"].contains("민지"));

    let plain = raw_outputs(false);
    assert!(plain["supervisor"].starts_with("변경 파일이 목표와 맞나요?"));
    assert!(plain["coach"].starts_with("375px에서 열이 바뀌는지 보세요"));
    assert!(plain["prd_interview"].starts_with("민지의 독서 기록 앱을 만들고 싶군요"));
}

// S-078 security review P2-6: a JSON reply is anonymized field by field —
// the coach's criterionSummary repeats student criteria (user text) and file
// labels are paths — while a supervisor question stays readable.
#[test]
fn replay_json_raw_output_is_anonymized_field_by_field() {
    use dive_lib::db::dao::supervision_replay::{self, NewSupervisionReplay, ReplaySurface};
    let (db, sid) = seed();
    let rows = [
        (
            ReplaySurface::Coach,
            "coach-json",
            json!({
                "criterionSummary": "민지가 로그인하면 환영 문구가 보인다",
                "recommendedChecks": [
                    {"kind": "file", "label": "src/LoginForm.tsx", "instruction": "파일을 열어 보세요"}
                ],
                "evidencePrompts": ["token=abcd1234 은 입력하지 마세요"]
            }),
        ),
        (
            ReplaySurface::Supervisor,
            "sup-json",
            json!({
                "schemaVersion": 1,
                "question": "변경 파일이 목표와 맞나요?",
                "evidenceRefIds": ["diff.changed_files"]
            }),
        ),
    ];
    for (surface, id, raw) in &rows {
        supervision_replay::insert(
            db.lock().unwrap().conn(),
            &NewSupervisionReplay {
                evaluation_id: (*id).into(),
                surface: *surface,
                session_id: Some(sid),
                project_id: None,
                prompt_version: "1.0.0+00000000".into(),
                policy_version: None,
                model: None,
                context_json: "{}".into(),
                raw_output: Some(raw.to_string()),
                validation_json: "{}".into(),
            },
        )
        .unwrap();
    }
    let export = |hash: bool| {
        let out = ExportEngine::new(db.clone())
            .export_session_with_salt(
                sid,
                &ExportOptions {
                    include_replay: true,
                    hash_user_text: hash,
                    hash_file_paths: hash,
                    ..ExportOptions::default()
                },
                "fixed-salt",
            )
            .unwrap();
        assert!(!out.contains("abcd1234"), "{out}");
        lines(&out)
            .into_iter()
            .filter(|record| record["kind"] == "replay")
            .map(|record| {
                let raw: Value =
                    serde_json::from_str(record["raw_output"].as_str().unwrap()).unwrap();
                (record["evaluation_id"].as_str().unwrap().to_string(), raw)
            })
            .collect::<std::collections::HashMap<_, _>>()
    };
    let hashed = export(true);
    assert!(hashed["coach-json"]["criterionSummary"]
        .as_str()
        .unwrap()
        .starts_with("h:"));
    assert!(hashed["coach-json"]["recommendedChecks"][0]["label"]
        .as_str()
        .unwrap()
        .starts_with("p:"));
    assert_eq!(
        hashed["sup-json"]["question"],
        json!("변경 파일이 목표와 맞나요?")
    );
    let plain = export(false);
    assert_eq!(
        plain["coach-json"]["criterionSummary"],
        json!("민지가 로그인하면 환영 문구가 보인다")
    );
    assert_eq!(
        plain["coach-json"]["recommendedChecks"][0]["label"],
        json!("src/LoginForm.tsx")
    );
}

#[test]
fn exported_question_text_is_plain_but_still_passes_pii_and_secret_detectors() {
    let (db, sid) = seed();
    let project_id = project_id_for_session(&db, sid);
    {
        let guard = db.lock().unwrap();
        let mut shown = card_event_payload(project_id, Some(sid), "card_shown");
        shown["question"] =
            json!("minji@example.com 계정으로 로그인해서 token=abcd1234 가 보이는지 확인했나요?");
        dive_event_log::append_provocation_event_to_conn(
            guard.conn(),
            Some(sid),
            "provocation.card_shown",
            &shown,
        )
        .unwrap();
        dive_event_log::append_supervisor_evaluation_to_conn(
            guard.conn(),
            sid,
            "eval-q",
            &serde_json::from_value(json!({
                "schemaVersion": 1,
                "event": "verify_entered",
                "artifactRef": {"kind": "step", "id": "step-1", "label": "Login"},
                "contextHash": "sha256:c",
                "evidenceHash": "sha256:e",
                "mode": "work",
                "evidenceRefs": [],
                "decisionSummary": {
                    "provoke": true,
                    "concern": "ai_self_report_only",
                    "severity": "caution",
                    "evidenceRefIds": ["agent.assistant_claim"],
                    "suggestedActionIds": ["open_diff"],
                    "strippedActionIds": [],
                    "question": "변경 내용으로 로그인 폼이 목표와 맞는지 확인할 수 있나요?"
                },
                "validationOutcome": "shown",
                "promptVersion": "1.0.0+256c9520",
                "policyVersion": "1.0.0"
            }))
            .unwrap(),
        )
        .unwrap();
    }
    let out = ExportEngine::new(db)
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    assert!(!out.contains("minji@example.com"), "{out}");
    assert!(!out.contains("abcd1234"), "{out}");
    let records = lines(&out);
    let evaluated = records
        .iter()
        .find(|record| record["type"] == "provocation.supervisor_evaluated")
        .unwrap();
    assert_eq!(
        evaluated["payload"]["decisionSummary"]["question"],
        json!("변경 내용으로 로그인 폼이 목표와 맞는지 확인할 수 있나요?")
    );
    assert_eq!(
        evaluated["payload"]["promptVersion"],
        json!("1.0.0+256c9520")
    );
    assert_eq!(evaluated["payload"]["policyVersion"], json!("1.0.0"));
}

#[test]
fn session_meta_exports_session_origin() {
    let (db, sid) = seed();
    for origin in ["classroom", "qa", "dev"] {
        db.lock()
            .unwrap()
            .conn()
            .execute(
                "UPDATE Session SET origin = ? WHERE id = ?",
                params![origin, sid],
            )
            .unwrap();
        let out = ExportEngine::new(db.clone())
            .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
            .unwrap();
        let meta = lines(&out)
            .into_iter()
            .find(|record| record["kind"] == "session_meta")
            .unwrap();
        assert_eq!(meta["origin"], json!(origin));
    }
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
fn export_preserves_005_eventlog_contracts_without_raw_sensitive_text() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: dive_event_log::RUNTIME_CAPABILITY_EVALUATED_EVENT.into(),
                payload: dive_event_log::runtime_capability_evaluated_payload(
                    "unavailable",
                    "opencode_zen",
                    Some("zen-model".into()),
                    Some("provider_not_pi_capable".into()),
                    Some("choose_supported_provider".into()),
                    "Provider token=secret-token-123 lacks Pi support",
                    100,
                ),
            },
        )
        .unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: dive_event_log::SUPERVISOR_EVALUATED_EVENT.into(),
                payload: json!({
                    "schemaVersion": 1,
                    "event": "scope_expansion",
                    "artifactRef": {"kind": "add_step_draft", "id": "draft-1", "label": "Analytics"},
                    "contextHash": "sha256:context",
                    "evidenceHash": "sha256:evidence",
                    "mode": "work",
                    "validationOutcome": "dropped",
                    "dropReason": "unknown_evidence_ref",
                    "cardId": null,
                    "evidenceRefs": [{
                        "id": "scope.assessment",
                        "source": "workmap",
                        "kind": "scope_expansion_assessment",
                        "label": "Scope assessment",
                        "verificationEvidence": false,
                        "valueSummary": {"kind": "raw", "rawText": "student@example.edu token=secret-token-123"}
                    }],
                    "decisionSummary": {
                        "provoke": true,
                        "concern": "scope_expansion",
                        "severity": "caution",
                        "evidenceRefIds": ["scope.assessment"],
                        "suggestedActionIds": ["link_criterion"],
                        "strippedActionIds": []
                    }
                }),
            },
        )
        .unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: dive_event_log::PLAN_ADJUSTMENT_OFFERED_EVENT.into(),
                payload: dive_event_log::plan_adjustment_offered_payload(
                    1,
                    2,
                    3,
                    "step-001",
                    "obj-1",
                    "offer-1",
                    "adjust_plan",
                    "Student minji@example.com asked to narrow scope",
                ),
            },
        )
        .unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: dive_event_log::PLAN_ADJUSTMENT_ACCEPTED_EVENT.into(),
                payload: dive_event_log::plan_adjustment_response_payload(
                    1, 2, 3, "step-001", "obj-1", "offer-1", "accepted",
                ),
            },
        )
        .unwrap();
    }

    let out = ExportEngine::new(db)
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();

    for event_type in [
        dive_event_log::RUNTIME_CAPABILITY_EVALUATED_EVENT,
        dive_event_log::SUPERVISOR_EVALUATED_EVENT,
        dive_event_log::PLAN_ADJUSTMENT_OFFERED_EVENT,
        dive_event_log::PLAN_ADJUSTMENT_ACCEPTED_EVENT,
    ] {
        assert!(out.contains(event_type), "missing {event_type}: {out}");
    }
    for raw in [
        "secret-token-123",
        "student@example.edu",
        "minji@example.com",
        "Student minji",
    ] {
        assert!(!out.contains(raw), "export leaked {raw}: {out}");
    }

    let records = lines(&out);
    let runtime = records
        .iter()
        .find(|record| {
            record["kind"] == "event"
                && record["type"] == dive_event_log::RUNTIME_CAPABILITY_EVALUATED_EVENT
        })
        .expect("runtime capability event");
    assert_eq!(runtime["payload"]["status"], "unavailable");
    assert_eq!(runtime["payload"]["reason_code"], "provider_not_pi_capable");
    assert!(runtime["payload"]["message"]
        .as_str()
        .is_some_and(|value| value.starts_with("h:")));

    let offered = records
        .iter()
        .find(|record| {
            record["kind"] == "event"
                && record["type"] == dive_event_log::PLAN_ADJUSTMENT_OFFERED_EVENT
        })
        .expect("plan adjustment offered event");
    assert_eq!(offered["payload"]["offer_id"], "offer-1");
    assert!(offered["payload"]["offer_summary"]
        .as_str()
        .is_some_and(|value| value.starts_with("h:")));

    let supervisor = records
        .iter()
        .find(|record| {
            record["kind"] == "event"
                && record["type"] == dive_event_log::SUPERVISOR_EVALUATED_EVENT
        })
        .expect("scope supervisor event");
    assert_eq!(supervisor["payload"]["event"], "scope_expansion");
    assert_eq!(supervisor["payload"]["dropReason"], "unknown_evidence_ref");
    assert_eq!(
        supervisor["payload"]["evidenceRefs"][0]["valueSummary"]["rawText"]["redacted"],
        true
    );
    assert!(
        supervisor["payload"]["evidenceRefs"][0]["valueSummary"]["rawText"]["reason"]
            .as_str()
            .is_some_and(|value| value.starts_with("h:"))
    );
}

#[test]
fn export_preserves_diff_ready_high_risk_reason_and_files() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        dive_event_log::append_to_conn(
            db_guard.conn(),
            Some(sid),
            dive_event_log::SUPERVISOR_EVALUATED_EVENT,
            json!({
                "schemaVersion": 1,
                "event": "diff_ready",
                "artifactRef": {"kind": "diff", "id": "step-1:diff", "label": "Changed work"},
                "contextHash": "sha256:diff-context",
                "evidenceHash": "sha256:diff-evidence",
                "validationOutcome": "shown",
                "dropReason": null,
                "cardId": "provocation:step-1:diff_scope_review:sha256:evidence",
                "supervisorEvaluationId": "eval-diff-high-risk",
                "decisionSummary": {
                    "provoke": true,
                    "concern": "diff_scope_drift",
                    "severity": "caution",
                    "evidenceRefIds": ["diff.changed_files"],
                    "suggestedActionIds": ["open_diff"],
                    "strippedActionIds": []
                },
                "assessmentSummary": {
                    "reasonCodes": ["high_risk_area"],
                    "evidenceRefs": ["diff.changed_files"],
                    "changedFileCount": 1,
                    "unexpectedFiles": [".env"],
                    "highRiskFiles": [".env"],
                    "diffViewed": false
                },
                "evidenceRefs": [{
                    "id": "diff.changed_files",
                    "source": "diff",
                    "kind": "changed_file",
                    "label": "Changed files",
                    "verificationEvidence": false
                }]
            }),
        )
        .unwrap();
    }

    let exported = ExportEngine::new(db)
        .export_session_with_salt(
            sid,
            &ExportOptions {
                hash_file_paths: false,
                hash_ids: false,
                ..ExportOptions::default()
            },
            "fixed-salt",
        )
        .unwrap();
    let records = lines(&exported);
    let supervisor = records
        .iter()
        .find(|record| {
            record["kind"] == "event"
                && record["type"] == dive_event_log::SUPERVISOR_EVALUATED_EVENT
                && record["payload"]["event"] == "diff_ready"
        })
        .expect("diff_ready supervisor event");

    assert_eq!(
        supervisor["payload"]["assessmentSummary"]["reasonCodes"],
        json!(["high_risk_area"])
    );
    assert_eq!(
        supervisor["payload"]["assessmentSummary"]["highRiskFiles"],
        json!([".env"])
    );
    assert_eq!(
        supervisor["payload"]["affectedFiles"]["highRiskFiles"],
        json!([".env"])
    );
}

#[test]
fn export_preserves_plan_generated_lifecycle_event_for_reconstruction() {
    let (db, sid) = seed();
    {
        let db_guard = db.lock().unwrap();
        event_log::insert(
            db_guard.conn(),
            &NewEventLog {
                session_id: Some(sid),
                r#type: dive_event_log::PLAN_GENERATED_EVENT.into(),
                payload: dive_event_log::plan_generated_payload(
                    1,
                    2,
                    "prd-1",
                    3,
                    2,
                    json!({
                        "total_criterion_count": 2,
                        "covered_criterion_ids": ["AC-001"],
                        "uncovered_criterion_ids": ["AC-002"],
                        "step_links": [{
                            "stable_step_id": "step-001",
                            "linked_criterion_ids": ["AC-001"]
                        }]
                    }),
                    "interview",
                ),
            },
        )
        .unwrap();
    }

    let out = ExportEngine::new(db)
        .export_session_with_salt(sid, &ExportOptions::default(), "fixed-salt")
        .unwrap();
    let records = lines(&out);
    let generated = records
        .iter()
        .find(|record| record["kind"] == "event" && record["type"] == "plan_generated")
        .expect("plan_generated event should export");

    assert_eq!(generated["payload"]["project_id"], json!(1));
    assert_eq!(generated["payload"]["plan_id"], json!(2));
    assert_eq!(generated["payload"]["project_spec_id"], json!("prd-1"));
    assert_eq!(generated["payload"]["project_spec_version"], json!(3));
    assert_eq!(generated["payload"]["step_count"], json!(2));
    assert_eq!(generated["payload"]["source"], json!("interview"));
    assert_eq!(
        generated["payload"]["evidenceSummary"]["planGenerated"],
        json!(true)
    );
    assert_eq!(
        generated["payload"]["criterion_coverage"]["covered_criterion_ids"],
        json!(["AC-001"])
    );
    assert_eq!(
        generated["payload"]["criterion_coverage"]["uncovered_criterion_ids"],
        json!(["AC-002"])
    );
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
