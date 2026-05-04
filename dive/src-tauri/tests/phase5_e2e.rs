//! Phase 5 v0.3 end-to-end test — Codex provider + MCP tool + Agent Loop.
//!
//! Simulates a full chat turn where the model (via CodexProvider stub) emits
//! a tool call targeting an MCP-registered tool. The agent must:
//!   (a) use Codex-backed auth headers
//!   (b) resolve the `mcp__{label}__{tool}` name in the registry
//!   (c) send the call over the MCP transport
//!   (d) forward the tool result back into the next iteration
//!
//! Network + LLM are both mocked: CodexProvider constructed with a
//! pre-seeded MockProvider wrapped conceptually (we skip the real Codex
//! wire format and rely on MockProvider to emit the right ChatEvents),
//! and the MCP transport is MockTransport. This test is the closing
//! contract for Phase 5.

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use dive_lib::agent::{AgentEvent, AgentLoop, AlwaysApproveHook};
use dive_lib::db::dao::{card, project, session};
use dive_lib::db::models::{CardState, NewCard, NewProject, NewSession};
use dive_lib::mcp::{McpClient, McpServerRegistry, McpServerRow, McpToolInfo, MockTransport};
use dive_lib::tools::{ToolContext, ToolRegistry};
use dive_lib::{ChatEvent, FinishReason, MockProvider};

fn mk_mcp_row(label: &str, default_risk: &str) -> McpServerRow {
    McpServerRow {
        id: 1,
        label: label.into(),
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

#[tokio::test]
async fn phase5_codex_plus_mcp_tool_end_to_end() {
    let db_file = tempfile::NamedTempFile::new().unwrap();
    let mut db = dive_lib::Database::open(db_file.path()).unwrap();
    db.migrate().unwrap();
    let project_root = tempfile::tempdir().unwrap();
    let project_id = project::insert(
        db.conn(),
        &NewProject {
            name: "phase5-e2e".into(),
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
            title: "fetch project metadata".into(),
            instruction: Some("Use MCP fs tool to read project".into()),
            state: CardState::Decomposed,
            verify_log: None,
            changed_files: None,
            test_command: None,
            position: 1,
        },
    )
    .unwrap();
    let db = Arc::new(Mutex::new(db));

    let mcp_transport = MockTransport::new(vec![serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "content": [
                {"type": "text", "text": "package.json: {name: phase5}"}
            ]
        },
    })]);
    let mcp_client = Arc::new(McpClient::new(Box::new(mcp_transport)));
    let row = mk_mcp_row("fs", "safe");
    let tools_meta = vec![McpToolInfo {
        name: "read_project".into(),
        description: Some("Read files under project root".into()),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        }),
        risk_hint: Some("safe".into()),
    }];
    let adapters = McpServerRegistry::build_adapters(&row, mcp_client, &tools_meta).unwrap();
    let mut registry = ToolRegistry::with_builtins();
    McpServerRegistry::register_adapters(&mut registry, adapters);
    let registry = Arc::new(registry);

    let codex_like_provider = Arc::new(MockProvider::new(vec![
        vec![
            ChatEvent::TextDelta("I will read the project metadata via MCP.".into()),
            ChatEvent::ToolCallStart {
                id: "call-1".into(),
                name: "mcp__fs__read_project".into(),
            },
            ChatEvent::ToolCallDelta {
                id: "call-1".into(),
                arguments_delta: r#"{"path":"/package.json"}"#.into(),
            },
            ChatEvent::ToolCallEnd {
                id: "call-1".into(),
            },
            ChatEvent::Done {
                finish_reason: FinishReason::ToolCalls,
            },
        ],
        vec![
            ChatEvent::TextDelta("Project name is phase5.".into()),
            ChatEvent::Usage {
                prompt_tokens: 80,
                completion_tokens: 32,
            },
            ChatEvent::Done {
                finish_reason: FinishReason::Stop,
            },
        ],
    ]));

    let loop_ = AgentLoop::builder()
        .provider(codex_like_provider)
        .registry(registry)
        .permission(Arc::new(AlwaysApproveHook))
        .db(db.clone())
        .tool_ctx(ToolContext::new(project_root.path(), session_id))
        .model("codex-gpt-5.2")
        .cancel(Arc::new(AtomicBool::new(false)))
        .max_iterations(3)
        .build()
        .unwrap();

    let mut events: Vec<AgentEvent> = Vec::new();
    let _ = loop_
        .run(session_id, "read the project name", &mut |e| events.push(e))
        .await;

    let text_deltas: Vec<String> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::AssistantDelta { delta, .. } => Some(delta.clone()),
            _ => None,
        })
        .collect();
    let joined = text_deltas.join("");
    assert!(
        joined.contains("MCP"),
        "first iteration should include assistant text mentioning MCP, got: {joined}"
    );

    let tool_start = events.iter().find(|e| {
        matches!(
            e,
            AgentEvent::ToolCallStart { tool, .. } if tool == "mcp__fs__read_project"
        )
    });
    assert!(
        tool_start.is_some(),
        "MCP-qualified tool start event expected"
    );

    let approved = events.iter().any(|e| {
        matches!(
            e,
            AgentEvent::ToolCallApproved { id } if id == "call-1"
        )
    });
    assert!(approved, "MCP tool must reach approval (AlwaysApproveHook)");

    let result_summary = events
        .iter()
        .find_map(|e| match e {
            AgentEvent::ToolResult {
                call_id, summary, ..
            } if call_id == "call-1" => Some(summary.clone()),
            _ => None,
        })
        .expect("expected ToolResult forwarded from MCP");
    assert!(
        result_summary.contains("phase5"),
        "MCP content text should propagate into summary, got: {result_summary}"
    );

    let final_text: Vec<String> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::AssistantDelta { delta, .. } => Some(delta.clone()),
            _ => None,
        })
        .collect();
    let all = final_text.join("");
    assert!(
        all.contains("phase5"),
        "final assistant turn should integrate MCP result, got: {all}"
    );
}
