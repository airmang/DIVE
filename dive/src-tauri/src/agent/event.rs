use serde::Serialize;
use serde_json::Value;

use crate::tools::RiskLevel;

/// UI-facing event emitted by the Agent Loop. Spec §8.1 defines the sequence;
/// `AgentEvent` flattens the Rust enum so the frontend adapter is
/// a straight JSON `type`-tag dispatch matching `ChatMessage` kinds.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    UserMessage {
        id: String,
        content: String,
        created_at: i64,
    },
    AssistantStart {
        id: String,
        created_at: i64,
    },
    AssistantDelta {
        id: String,
        delta: String,
    },
    AssistantEnd {
        id: String,
        content: String,
    },
    ToolCallStart {
        id: String,
        tool: String,
        params_preview: String,
        risk: RiskLevel,
    },
    ToolCallApproved {
        id: String,
    },
    ToolCallDenied {
        id: String,
        reason: String,
    },
    ToolResult {
        call_id: String,
        success: bool,
        summary: String,
        full: Value,
    },
    Error {
        message: String,
        retryable: bool,
    },
    Done {
        reason: String,
    },
}
