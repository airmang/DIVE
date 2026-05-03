//! Agent Loop integration tests — spec §8.2 scenarios.
//!
//! Uses `MockProvider` + in-memory tempdir project + tempfile SQLite so the
//! loop can be driven without network or Tauri runtime.

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use dive_lib::db::dao::{event_log, message, project, session};
use dive_lib::db::models::{NewProject, NewSession};
use dive_lib::Database;
use dive_lib::{ChatEvent, FinishReason, MockProvider};

use dive_lib::agent::{AgentError, AgentEvent, AgentLoop, AlwaysApproveHook, AlwaysDenyHook};
use dive_lib::tools::{ToolContext, ToolRegistry};

fn fresh_env() -> (
    Arc<Mutex<Database>>,
    tempfile::NamedTempFile,
    tempfile::TempDir,
    i64,
) {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let project_id = project::insert(
        db.conn(),
        &NewProject {
            name: "test".into(),
            path: project_root.path().to_string_lossy().into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    let session_id = session::insert(
        db.conn(),
        &NewSession {
            project_id,
            title: "s".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap();
    (Arc::new(Mutex::new(db)), db_file, project_root, session_id)
}

fn build_loop(
    db: Arc<Mutex<Database>>,
    project_root: &std::path::Path,
    provider: Arc<MockProvider>,
    permission: Arc<dyn dive_lib::agent::PermissionHook>,
    session_id: i64,
) -> AgentLoop {
    AgentLoop::builder()
        .provider(provider)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(permission)
        .db(db)
        .tool_ctx(ToolContext::new(project_root, session_id))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap()
}

#[tokio::test]
async fn scenario_a_text_only_response() {
    let (db, _db_file, root, sid) = fresh_env();
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("hello ".into()),
        ChatEvent::TextDelta("world".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = build_loop(
        db.clone(),
        root.path(),
        mock.clone(),
        Arc::new(AlwaysApproveHook),
        sid,
    );
    let mut events = Vec::new();
    let out = loop_.run(sid, "hi", &mut |e| events.push(e)).await.unwrap();
    assert!(out.starts_with("stopped:"));
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::AssistantDelta { delta, .. } if delta == "hello ")));
    assert!(events.iter().any(
        |e| matches!(e, AgentEvent::AssistantEnd { content, .. } if content == "hello world")
    ));
    assert_eq!(mock.request_count(), 1);
    let db_guard = db.lock().unwrap();
    let msgs = message::list_by_session(db_guard.conn(), sid, 10).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].role, "user");
    assert_eq!(msgs[1].role, "assistant");
    assert_eq!(msgs[1].content, "hello world");
}

#[tokio::test]
async fn scenario_b_tool_call_then_followup() {
    let (db, _db_file, root, sid) = fresh_env();
    std::fs::create_dir_all(root.path().join("src")).unwrap();
    std::fs::write(root.path().join("src/a.txt"), "x").unwrap();
    std::fs::write(root.path().join("src/b.txt"), "y").unwrap();

    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::TextDelta("Let me check.".into()),
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "list_dir".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"src"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("Found 2 files.".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let loop_ = build_loop(
        db.clone(),
        root.path(),
        mock.clone(),
        Arc::new(AlwaysApproveHook),
        sid,
    );
    let mut events = Vec::new();
    loop_
        .run(sid, "list files", &mut |e| events.push(e))
        .await
        .unwrap();
    assert_eq!(mock.request_count(), 2);
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::ToolCallStart { tool, .. } if tool == "list_dir"
    )));
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCallApproved { .. })));
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::ToolResult { success: true, summary, .. } if summary.contains("entries")
    )));
    let db_guard = db.lock().unwrap();
    let logs = event_log::list_by_session(db_guard.conn(), sid).unwrap();
    let kinds: Vec<&str> = logs.iter().map(|l| l.r#type.as_str()).collect();
    assert!(kinds.contains(&"user_message"));
    assert!(kinds.contains(&"tool_call_start"));
    assert!(kinds.contains(&"tool_result"));
}

#[tokio::test]
async fn scenario_c_tool_call_denied() {
    let (db, _db_file, root, sid) = fresh_env();
    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "write_file".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"f.txt","content":"x"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("Okay, skipping.".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let loop_ = build_loop(
        db.clone(),
        root.path(),
        mock.clone(),
        Arc::new(AlwaysDenyHook),
        sid,
    );
    let mut events = Vec::new();
    loop_
        .run(sid, "write please", &mut |e| events.push(e))
        .await
        .unwrap();
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::ToolCallDenied { reason, .. } if reason.contains("denies")
    )));
    assert!(!root.path().join("f.txt").exists());
}

#[tokio::test]
async fn scenario_d_write_outside_root_rejected() {
    let (db, _db_file, root, sid) = fresh_env();
    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "write_file".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"../escaped.txt","content":"x"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("Cannot.".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let loop_ = build_loop(
        db.clone(),
        root.path(),
        mock.clone(),
        Arc::new(AlwaysApproveHook),
        sid,
    );
    let mut events = Vec::new();
    loop_
        .run(sid, "write escape", &mut |e| events.push(e))
        .await
        .unwrap();
    // Tool should have been approved but run() returns a PathDenied ToolError
    // which the loop converts into a failed ToolResult + keeps conversation going.
    let result = events
        .iter()
        .find_map(|e| match e {
            AgentEvent::ToolResult {
                success, summary, ..
            } => Some((*success, summary.clone())),
            _ => None,
        })
        .expect("expected a ToolResult event");
    assert!(!result.0, "write outside root must fail");
    assert!(result.1.contains("path"));
    assert!(!root.path().parent().unwrap().join("escaped.txt").exists());
}

#[tokio::test]
async fn scenario_e_cancel_mid_stream() {
    let (db, _db_file, root, sid) = fresh_env();
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("start ".into()),
        ChatEvent::TextDelta("more".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let cancel = Arc::new(AtomicBool::new(true));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(cancel)
        .max_iterations(5)
        .build()
        .unwrap();
    let mut events = Vec::new();
    let result = loop_.run(sid, "hi", &mut |e| events.push(e)).await;
    assert!(matches!(result, Err(AgentError::Cancelled)));
}
