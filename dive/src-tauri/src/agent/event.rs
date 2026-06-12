use serde::Serialize;
use serde_json::Value;

use crate::tools::{BlockReason, RiskLevel};

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
    RuntimeSelected {
        runtime: String,
        provider: String,
        model: String,
        reason: String,
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
        finish_reason: String,
    },
    Reasoning {
        id: String,
        text: String,
        tool_call_id: String,
        created_at: i64,
    },
    ToolCallStart {
        id: String,
        tool: String,
        params_preview: String,
        risk: RiskLevel,
        #[serde(skip_serializing_if = "Option::is_none")]
        diff_preview: Option<DiffPreview>,
        args: Value,
    },
    ToolCallApproved {
        id: String,
    },
    ToolCallDenied {
        id: String,
        reason: String,
    },
    ToolCallBlocked {
        id: String,
        reason: BlockReason,
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

/// Diff payload surfaced on `ToolCallStart` for edit_file / write_file so the
/// permission card can render the change before user approval.
#[derive(Debug, Clone, Serialize)]
pub struct DiffPreview {
    pub path: String,
    pub before: String,
    pub after: String,
}
