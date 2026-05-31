use std::sync::{atomic::AtomicBool, Arc, Mutex};

use dive_lib::agent::{AgentEvent, AgentLoop, AlwaysApproveHook};
use dive_lib::db::dao::{card, project, session};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};
use dive_lib::mcp::{
    McpClient, McpServerRegistry, McpServerRow, McpToolAdapter, McpToolInfo, MockTransport,
};
use dive_lib::tools::{RiskLevel, Tool, ToolContext, ToolRegistry};
use dive_lib::{ChatEvent, FinishReason, MockProvider};

fn fresh_env() -> (
    Arc<Mutex<dive_lib::Database>>,
    tempfile::TempDir,
    tempfile::NamedTempFile,
    i64,
) {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = dive_lib::Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let project_id = project::insert(
        db.conn(),
        &NewProject {
            name: "t".into(),
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
    card::insert(
        db.conn(),
        &NewCard {
            session_id,
            title: "c".into(),
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
    (Arc::new(Mutex::new(db)), project_root, db_file, session_id)
}

fn build_row(default_risk: &str) -> McpServerRow {
    McpServerRow {
        id: 1,
        label: "fs".into(),
        transport: "http".into(),
        command: None,
        args: None,
        env: None,
        url: Some("http://stub/rpc".into()),
        headers: None,
        default_risk: default_risk.into(),
        enabled: true,
        created_at: 0,
        updated_at: 0,
    }
}

#[test]
fn adapter_qualified_name_uses_prefix() {
    let client = Arc::new(McpClient::new(Box::new(MockTransport::new(vec![]))));
    let adapter = McpToolAdapter::new(
        "fs",
        "read_file".into(),
        None,
        serde_json::json!({}),
        RiskLevel::Safe,
        None,
        client,
    );
    assert_eq!(adapter.name(), "mcp__fs__read_file");
}

#[tokio::test]
async fn build_adapters_and_register_into_tool_registry() {
    let row = build_row("caution");
    let client = Arc::new(McpClient::new(Box::new(MockTransport::new(vec![]))));
    let tools = vec![
        McpToolInfo {
            name: "reader".into(),
            description: Some("Read bytes".into()),
            input_schema: serde_json::json!({"type": "object"}),
            risk_hint: Some("safe".into()),
        },
        McpToolInfo {
            name: "writer".into(),
            description: Some("Write bytes".into()),
            input_schema: serde_json::json!({"type": "object"}),
            risk_hint: Some("danger".into()),
        },
    ];
    let adapters = McpServerRegistry::build_adapters(&row, client, &tools).unwrap();
    assert_eq!(adapters.len(), 2);

    let mut registry = ToolRegistry::with_builtins();
    McpServerRegistry::register_adapters(&mut registry, adapters);

    let reader = registry.get("mcp__fs__reader").expect("reader registered");
    assert_eq!(reader.risk_level(), RiskLevel::Warn);

    let writer = registry.get("mcp__fs__writer").expect("writer registered");
    assert_eq!(writer.risk_level(), RiskLevel::Danger);

    assert!(
        registry.get("read_file").is_some(),
        "built-in tools must be preserved"
    );
}

#[tokio::test]
async fn agent_invokes_mcp_tool_through_permission_pipeline() {
    let (db, project_root, _dbfile, session_id) = fresh_env();

    let transport = MockTransport::new(vec![serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"content": [{"type": "text", "text": "42"}]},
    })]);
    let mcp_client = Arc::new(McpClient::new(Box::new(transport)));
    let row = build_row("safe");
    let tools_meta = vec![McpToolInfo {
        name: "compute".into(),
        description: None,
        input_schema: serde_json::json!({"type": "object"}),
        risk_hint: None,
    }];
    let adapters = McpServerRegistry::build_adapters(&row, mcp_client, &tools_meta).unwrap();
    let mut registry = ToolRegistry::with_builtins();
    McpServerRegistry::register_adapters(&mut registry, adapters);
    let registry = Arc::new(registry);

    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "mcp__fs__compute".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"x":7}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("got it".into()),
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));

    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(registry)
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(project_root.path(), session_id))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(3)
        .build()
        .unwrap();

    let mut events: Vec<AgentEvent> = Vec::new();
    let _ = loop_
        .run(session_id, "use mcp", &mut |e| events.push(e))
        .await;

    let approved_mcp = events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCallApproved { id, .. } if id == "call-1"));
    assert!(approved_mcp, "mcp tool should pass permission hook");

    let tool_result = events
        .iter()
        .find_map(|e| match e {
            AgentEvent::ToolResult {
                call_id, summary, ..
            } if call_id == "call-1" => Some(summary.clone()),
            _ => None,
        })
        .expect("expected ToolResult for mcp__fs__compute");
    assert!(
        tool_result.contains("42"),
        "summary should carry mcp text content, got: {tool_result}"
    );
}

#[tokio::test]
async fn agent_surfaces_error_for_unknown_mcp_tool() {
    let (db, project_root, _dbfile, session_id) = fresh_env();

    let registry = Arc::new(ToolRegistry::with_builtins());
    let mock = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::ToolCallStart {
                id: "call-x".into(),
                name: "mcp__nope__missing".into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-x".into(),
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

    let loop_ = AgentLoop::builder()
        .provider(mock)
        .registry(registry)
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(project_root.path(), session_id))
        .model("mock-model")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(3)
        .build()
        .unwrap();

    let mut events: Vec<AgentEvent> = Vec::new();
    let _ = loop_.run(session_id, "nope", &mut |e| events.push(e)).await;

    let not_registered = events.iter().any(|e| {
        matches!(
            e,
            AgentEvent::ToolResult { success: false, summary, .. }
                if summary.contains("not registered")
        )
    });
    assert!(
        not_registered,
        "unknown mcp tool must produce not-registered ToolResult"
    );
}
