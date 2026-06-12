//! Agent Loop integration tests — spec §8.2 scenarios.
//!
//! Uses `MockProvider` + in-memory tempdir project + tempfile SQLite so the
//! loop can be driven without network or Tauri runtime.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use async_trait::async_trait;
use dive_lib::db::dao::{card, event_log, message, project, session, workmap};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};
use dive_lib::Database;
use dive_lib::{
    ChatEvent, ChatRequest, FinishReason, LlmProvider, Message, MockProvider, ModelInfo,
    ProviderError,
};
use futures::stream::{self, BoxStream};
use futures::StreamExt;

use dive_lib::agent::{
    AgentError, AgentEvent, AgentLoop, AgentRunMode, AlwaysApproveHook, AlwaysDenyHook,
    AwaitUserHook, PendingApprovals, PermissionDecision, StepContext,
};
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
    // Seed one card so card-aware prompts and message persistence have context.
    card::insert(
        db.conn(),
        &NewCard {
            session_id,
            title: "test card".into(),
            instruction: None,
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
    (Arc::new(Mutex::new(db)), db_file, project_root, session_id)
}

fn fresh_env_no_cards() -> (
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

struct PendingProviderResponse {
    called: Arc<AtomicBool>,
}

#[async_trait]
impl LlmProvider for PendingProviderResponse {
    fn id(&self) -> &str {
        "pending-provider-response"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "pending-model".into(),
            display_name: "Pending".into(),
        }]
    }

    async fn chat(
        &self,
        _req: ChatRequest,
    ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        self.called.store(true, Ordering::SeqCst);
        std::future::pending().await
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
}

struct PendingStreamProvider;

#[async_trait]
impl LlmProvider for PendingStreamProvider {
    fn id(&self) -> &str {
        "pending-stream"
    }

    fn list_models(&self) -> Vec<ModelInfo> {
        vec![ModelInfo {
            id: "pending-model".into(),
            display_name: "Pending".into(),
        }]
    }

    async fn chat(
        &self,
        _req: ChatRequest,
    ) -> Result<BoxStream<'static, ChatEvent>, ProviderError> {
        Ok(stream::pending().boxed())
    }

    async fn refresh_auth(&mut self) -> Result<(), ProviderError> {
        Ok(())
    }
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
    let out = loop_
        .run(sid, "API키: sk-abc123", &mut |e| events.push(e))
        .await
        .unwrap();
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
    let logs = event_log::list_by_session(db_guard.conn(), sid).unwrap();
    let kinds: Vec<&str> = logs.iter().map(|l| l.r#type.as_str()).collect();
    assert!(kinds.contains(&"stage_enter"));
    assert!(kinds.contains(&"stage_exit"));
    assert!(kinds.contains(&"user_message"));
    let encoded_logs = serde_json::to_string(&logs).unwrap();
    assert!(
        !encoded_logs.contains("sk-abc123"),
        "EventLog must not contain raw API keys: {encoded_logs}"
    );
}

#[tokio::test]
async fn assistant_end_event_includes_length_finish_reason() {
    let (db, _db_file, root, sid) = fresh_env();
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("{\"plan_input\":".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Length,
        },
    ]]));
    let loop_ = build_loop(db, root.path(), mock, Arc::new(AlwaysApproveHook), sid);

    let mut events = Vec::new();
    loop_
        .run(sid, "finish interview", &mut |e| events.push(e))
        .await
        .unwrap();

    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::AssistantEnd {
            content,
            finish_reason,
            ..
        } if content == "{\"plan_input\":" && finish_reason == "length"
    )));
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
    assert!(kinds.contains(&"tool_approve"));
    assert!(kinds.contains(&"tool_result"));
    assert!(kinds.contains(&"tool_complete"));
}

#[tokio::test]
async fn repeated_identical_tool_calls_stop_before_spinning() {
    let (db, _db_file, root, sid) = fresh_env();
    let repeated_turn = |id: &str| {
        vec![
            ChatEvent::ToolCallStart {
                id: id.to_string(),
                name: "list_dir".into(),
            },
            ChatEvent::ToolCallDelta {
                id: id.to_string(),
                arguments_delta: r#"{"path":"."}"#.into(),
            },
            ChatEvent::ToolCallEnd { id: id.to_string() },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ]
    };
    let mock = Arc::new(MockProvider::new(vec![
        repeated_turn("call-1"),
        repeated_turn("call-2"),
        repeated_turn("call-3"),
        vec![
            ChatEvent::TextDelta("This should not be reached.".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let loop_ = AgentLoop::builder()
        .provider(mock.clone())
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .run_mode(AgentRunMode::Build)
        .plan_accepted(true)
        .max_iterations(5)
        .build()
        .unwrap();

    let mut events = Vec::new();
    let result = loop_
        .run(sid, "keep checking", &mut |e| events.push(e))
        .await;

    assert!(matches!(
        result,
        Err(AgentError::Internal(message)) if message.contains("repeated tool calls")
    ));
    assert_eq!(mock.request_count(), 3);
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::Done { reason } if reason == "repeated_tool_calls")
    ));

    let db_guard = db.lock().unwrap();
    let logs = event_log::list_by_session(db_guard.conn(), sid).unwrap();
    assert!(logs
        .iter()
        .any(|row| row.r#type == "stage_exit" && row.payload["reason"] == "repeated_tool_calls"));
}

#[tokio::test]
async fn tool_call_followup_replays_reasoning_content_and_writes_index() {
    let (db, _db_file, root, sid) = fresh_env();

    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ReasoningDelta("Need to inspect the project first.".into()),
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "list_dir".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"."}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::ReasoningDelta("Now create the starter file.".into()),
            ChatEvent::ToolCallStart {
                id: "call-2".into(),
                name: "write_file".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-2".into(),
                arguments_delta: r#"{"path":"index.html","content":"<!doctype html><html><head><title>QA</title></head><body><h1>DIVE QA</h1></body></html>"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-2".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("Created index.html.".into()),
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
        .run(sid, "inspect", &mut |e| events.push(e))
        .await
        .unwrap();

    let requests = mock.requests_snapshot();
    assert_eq!(requests.len(), 3);
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, AgentEvent::AssistantDelta { delta, .. } if delta.contains("Need to inspect"))),
        "reasoning deltas must stay hidden from the UI stream"
    );

    let assistant = requests[1]
        .messages
        .iter()
        .find_map(|message| match message {
            Message::Assistant {
                reasoning_content,
                tool_calls,
                ..
            } if tool_calls.as_ref().is_some_and(|calls| !calls.is_empty()) => {
                reasoning_content.as_deref()
            }
            _ => None,
        })
        .expect("second provider request should include assistant reasoning for tool turn");
    assert_eq!(assistant, "Need to inspect the project first.");
    assert!(
        root.path().join("index.html").exists(),
        "list_dir follow-up should reach write_file and create index.html"
    );

    let db_guard = db.lock().unwrap();
    let messages = message::list_by_session(db_guard.conn(), sid, 10).unwrap();
    let persisted = messages
        .iter()
        .find(|row| row.role == "assistant" && row.tool_calls.is_some())
        .expect("tool-call assistant message persisted");
    assert_eq!(
        persisted.reasoning_content.as_deref(),
        Some("Need to inspect the project first.")
    );
}

#[tokio::test]
async fn product_path_build_step_creates_code_output_and_records_changed_files() {
    let (db, _db_file, root, sid) = fresh_env();
    let card_id = {
        let db_guard = db.lock().unwrap();
        let card_id = card::list_by_session(db_guard.conn(), sid).unwrap()[0].id;
        db_guard
            .conn()
            .execute(
                "UPDATE Card SET instruction = ? WHERE id = ?",
                ("Write a single-file todo app in index.html.", card_id),
            )
            .unwrap();
        workmap::set_current_card(db_guard.conn(), sid, Some(card_id)).unwrap();
        card_id
    };

    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-write-index".into(),
                name: "write_file".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-write-index".into(),
                arguments_delta: r#"{"path":"index.html","content":"<!doctype html><html><head><title>DIVE QA</title></head><body><main><h1>DIVE Todo</h1><input aria-label=\"New todo\"><button>Add</button></main><script>localStorage.setItem('dive-qa','ready');</script></body></html>"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-write-index".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("Created index.html and wired the todo shell.".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .run_mode(AgentRunMode::Build)
        .plan_accepted(true)
        .step_context(Some(StepContext {
            step_id: 1,
            title: "Create browser todo app".into(),
            instruction_seed: Some("Write a single-file todo app in index.html.".into()),
            acceptance_criteria: Some("index.html exists and includes todo UI.".into()),
            expected_files: Some(r#"["index.html"]"#.into()),
        }))
        .max_iterations(5)
        .build()
        .unwrap();

    let mut events = Vec::new();
    loop_
        .run(
            sid,
            "Build the approved first roadmap step.",
            &mut |event| events.push(event),
        )
        .await
        .unwrap();

    let index_path = root.path().join("index.html");
    assert!(index_path.exists(), "build step should create index.html");
    let content = std::fs::read_to_string(index_path).unwrap();
    assert!(content.contains("DIVE Todo"));

    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolCallStart {
            tool,
            diff_preview: Some(diff),
            ..
        } if tool == "write_file" && diff.path == "index.html" && diff.after.contains("DIVE Todo")
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolResult {
            success: true,
            summary,
            ..
        } if summary.contains("index.html")
    )));

    let db_guard = db.lock().unwrap();
    let card = card::get_by_id(db_guard.conn(), card_id)
        .unwrap()
        .expect("current card should still exist");
    assert_eq!(card.changed_files, Some(serde_json::json!(["index.html"])));
    let logs = event_log::list_by_session(db_guard.conn(), sid).unwrap();
    assert!(logs.iter().any(|row| {
        row.r#type == "card_changed_files"
            && row.payload["paths"] == serde_json::json!(["index.html"])
    }));
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

#[tokio::test]
async fn cancel_while_waiting_for_provider_response() {
    let (db, _db_file, root, sid) = fresh_env();
    let cancel = Arc::new(AtomicBool::new(false));
    let provider_called = Arc::new(AtomicBool::new(false));
    let loop_ = AgentLoop::builder()
        .provider(Arc::new(PendingProviderResponse {
            called: provider_called.clone(),
        }))
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("pending-model")
        .cancel(cancel.clone())
        .max_iterations(5)
        .build()
        .unwrap();

    let canceller = {
        let cancel = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            cancel.store(true, Ordering::SeqCst);
        })
    };
    let mut events = Vec::new();
    let result = tokio::time::timeout(
        Duration::from_millis(300),
        loop_.run(sid, "hi", &mut |event| events.push(event)),
    )
    .await
    .expect("cancel should interrupt pending provider response");
    canceller.await.unwrap();

    assert!(provider_called.load(Ordering::SeqCst));
    assert!(matches!(result, Err(AgentError::Cancelled)));
    assert!(events.iter().all(|event| !matches!(
        event,
        AgentEvent::AssistantDelta { .. } | AgentEvent::ToolResult { .. }
    )));
}

#[tokio::test]
async fn cancel_while_waiting_for_stream_chunk() {
    let (db, _db_file, root, sid) = fresh_env();
    let cancel = Arc::new(AtomicBool::new(false));
    let loop_ = AgentLoop::builder()
        .provider(Arc::new(PendingStreamProvider))
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("pending-model")
        .cancel(cancel.clone())
        .max_iterations(5)
        .build()
        .unwrap();

    let canceller = {
        let cancel = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            cancel.store(true, Ordering::SeqCst);
        })
    };
    let mut events = Vec::new();
    let result = tokio::time::timeout(
        Duration::from_millis(300),
        loop_.run(sid, "hi", &mut |event| events.push(event)),
    )
    .await
    .expect("cancel should interrupt pending stream chunk");
    canceller.await.unwrap();

    assert!(matches!(result, Err(AgentError::Cancelled)));
    assert!(events.iter().all(|event| !matches!(
        event,
        AgentEvent::AssistantDelta { .. } | AgentEvent::ToolResult { .. }
    )));
}

#[tokio::test]
async fn scenario_f_await_user_hook_approved() {
    let (db, _db_file, root, sid) = fresh_env();
    std::fs::create_dir_all(root.path().join("sub")).unwrap();
    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "list_dir".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"sub"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("done".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let pending = PendingApprovals::new();
    let hook = Arc::new(AwaitUserHook::new(pending.clone(), false));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(hook)
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap();

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();
    let pending_clone = pending.clone();

    let run_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let r = loop_.run(sid, "go", &mut |e| buf.push(e)).await;
        events_clone.lock().unwrap().extend(buf);
        r
    });

    // wait for the hook to register the pending approval
    for _ in 0..50 {
        if pending_clone.pending_count() > 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(pending_clone.pending_count(), 1, "hook should have parked");
    assert!(pending_clone.resolve("call-1", PermissionDecision::approved()));

    run_task.await.unwrap().unwrap();
    let evts = events.lock().unwrap();
    assert!(evts
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCallApproved { .. })));
    assert!(evts
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolResult { success: true, .. })));
}

#[tokio::test]
async fn scenario_g_await_user_hook_modified_args() {
    let (db, _db_file, root, sid) = fresh_env();
    std::fs::create_dir_all(root.path().join("a")).unwrap();
    std::fs::create_dir_all(root.path().join("b")).unwrap();
    std::fs::write(root.path().join("a/x"), "").unwrap();
    std::fs::write(root.path().join("b/y1"), "").unwrap();
    std::fs::write(root.path().join("b/y2"), "").unwrap();

    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "list_dir".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"a"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("ok".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let pending = PendingApprovals::new();
    let hook = Arc::new(AwaitUserHook::new(pending.clone(), false));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(hook)
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap();

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();
    let pending_clone = pending.clone();

    let run_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let r = loop_.run(sid, "go", &mut |e| buf.push(e)).await;
        events_clone.lock().unwrap().extend(buf);
        r
    });

    for _ in 0..50 {
        if pending_clone.pending_count() > 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    // Approve with modified_args pointing to directory "b" instead of "a"
    let override_args = serde_json::json!({ "path": "b" });
    pending_clone.resolve("call-1", PermissionDecision::approved_with(override_args));
    run_task.await.unwrap().unwrap();

    let evts = events.lock().unwrap();
    let summary = evts
        .iter()
        .find_map(|e| match e {
            AgentEvent::ToolResult {
                summary,
                success: true,
                ..
            } => Some(summary.clone()),
            _ => None,
        })
        .expect("expected a ToolResult");
    assert!(summary.contains("b: 2 entries"), "got {summary}");
}

#[tokio::test]
async fn scenario_h_await_user_hook_denied_with_reason() {
    let (db, _db_file, root, sid) = fresh_env();
    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "write_file".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"out.txt","content":"x"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("ok".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));
    let pending = PendingApprovals::new();
    let hook = Arc::new(AwaitUserHook::new(pending.clone(), false));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(hook)
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap();

    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();
    let pending_clone = pending.clone();

    let run_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let r = loop_.run(sid, "write", &mut |e| buf.push(e)).await;
        events_clone.lock().unwrap().extend(buf);
        r
    });

    for _ in 0..50 {
        if pending_clone.pending_count() > 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    pending_clone.resolve(
        "call-1",
        PermissionDecision::denied("user refused destructive write"),
    );
    run_task.await.unwrap().unwrap();

    let evts = events.lock().unwrap();
    assert!(evts.iter().any(|e| matches!(
        e,
        AgentEvent::ToolCallDenied { reason, .. } if reason.contains("refused")
    )));
    assert!(!root.path().join("out.txt").exists());
}

#[tokio::test]
async fn diff_preview_populated_for_write_and_edit() {
    let (db, _db_file, root, sid) = fresh_env();
    std::fs::write(root.path().join("hello.txt"), "old content").unwrap();

    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-w".into(),
                name: "write_file".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-w".into(),
                arguments_delta: r#"{"path":"hello.txt","content":"new content"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-w".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        }],
    ]));
    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap();

    let mut events = Vec::new();
    loop_
        .run(sid, "replace", &mut |e| events.push(e))
        .await
        .unwrap();

    let dp = events.iter().find_map(|e| match e {
        AgentEvent::ToolCallStart {
            diff_preview: Some(d),
            ..
        } => Some(d.clone()),
        _ => None,
    });
    let dp = dp.expect("expected diff_preview on write_file");
    assert_eq!(dp.before, "old content");
    assert_eq!(dp.after, "new content");
    assert!(dp.path.ends_with("hello.txt"));
}

#[tokio::test]
async fn plan_first_allows_empty_workmap_after_plan_accepted() {
    let (db, _db_file, root, sid) = fresh_env_no_cards();
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("allowed".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = AgentLoop::builder()
        .provider(mock.clone())
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .plan_accepted(true)
        .build()
        .unwrap();

    let mut events = Vec::new();
    let result = loop_.run(sid, "hi", &mut |e| events.push(e)).await;
    assert!(result.unwrap().starts_with("stopped:"));
    assert!(
        !events.iter().any(|e| matches!(
            e,
            AgentEvent::Error {
                retryable: false,
                ..
            }
        )),
        "legacy D gate must not block plan-first runtime"
    );
    assert_eq!(mock.request_count(), 1, "provider should be called");
}

#[tokio::test]
async fn plan_first_allows_empty_workmap_before_plan_accepted() {
    let (db, _db_file, root, sid) = fresh_env_no_cards();
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("hello".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = AgentLoop::builder()
        .provider(mock.clone())
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db)
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap();

    let mut events = Vec::new();
    let result = loop_
        .run(sid, "I want to build a calculator", &mut |e| events.push(e))
        .await;
    assert!(
        result.is_ok(),
        "plan-first runtime must let the first plan-mode message through, got {result:?}"
    );
    assert!(
        mock.request_count() >= 1,
        "provider should have been called"
    );
}

#[tokio::test]
async fn agent_loop_no_longer_emits_gate_bypassed_events() {
    let (db, _db_file, root, sid) = fresh_env_no_cards();
    let mock = Arc::new(MockProvider::new(vec![vec![
        ChatEvent::TextDelta("allowed".into()),
        ChatEvent::Done {
            finish_reason: FinishReason::Stop,
        },
    ]]));
    let loop_ = AgentLoop::builder()
        .provider(mock.clone())
        .registry(Arc::new(ToolRegistry::with_builtins()))
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(root.path(), sid))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(5)
        .build()
        .unwrap();

    let mut events = Vec::new();
    let result = loop_.run(sid, "hi", &mut |e| events.push(e)).await;
    assert!(result.unwrap().starts_with("stopped:"));
    assert_eq!(
        mock.request_count(),
        1,
        "provider should be called in ablation"
    );
    let db_guard = db.lock().unwrap();
    let logs = event_log::list_by_session(db_guard.conn(), sid).unwrap();
    assert!(
        logs.iter().all(|row| row.r#type != "gate_bypassed"),
        "legacy gate bypass events should disappear with runtime gate removal"
    );
}
