use serde::Serialize;
use serde_json::Value;

use crate::db::models::RuntimeCapabilityState;
use crate::tools::runtime::{
    PreviewRequestKind, RuntimeInputKind, RuntimeRoutingOutcome, StaleApprovalDetectedBy,
};
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
    RuntimeCapabilityEvaluated {
        #[serde(flatten)]
        capability: RuntimeCapabilityState,
    },
    RuntimeRoutingDecision {
        #[serde(rename = "decisionId")]
        decision_id: String,
        #[serde(rename = "toolCallId", skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        #[serde(rename = "inputKind")]
        input_kind: RuntimeInputKind,
        outcome: RuntimeRoutingOutcome,
        #[serde(rename = "reasonCode")]
        reason_code: String,
        #[serde(rename = "evidenceRefs")]
        evidence_refs: Vec<Value>,
        message: String,
        #[serde(rename = "createdAt")]
        created_at: i64,
    },
    PreviewOpenRequested {
        #[serde(rename = "requestId")]
        request_id: String,
        kind: PreviewRequestKind,
        #[serde(rename = "targetLabel")]
        target_label: String,
        source: String,
        #[serde(rename = "requestedAt")]
        requested_at: i64,
    },
    PreviewOpenResult {
        #[serde(rename = "requestId")]
        request_id: String,
        status: String,
        #[serde(rename = "previewUrl", skip_serializing_if = "Option::is_none")]
        preview_url: Option<String>,
        #[serde(rename = "targetLabel")]
        target_label: String,
        #[serde(rename = "reasonCode", skip_serializing_if = "Option::is_none")]
        reason_code: Option<String>,
        message: String,
        #[serde(rename = "resolvedAt")]
        resolved_at: i64,
    },
    ProjectCommandResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "commandLabel")]
        command_label: String,
        executable: String,
        args: Vec<String>,
        #[serde(rename = "timeoutSec")]
        timeout_sec: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(rename = "expectedEffect", skip_serializing_if = "Option::is_none")]
        expected_effect: Option<String>,
        status: String,
        success: bool,
        #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        summary: String,
        #[serde(rename = "stdoutSummary", skip_serializing_if = "Option::is_none")]
        stdout_summary: Option<String>,
        #[serde(rename = "stderrSummary", skip_serializing_if = "Option::is_none")]
        stderr_summary: Option<String>,
        #[serde(rename = "createdAt")]
        created_at: i64,
    },
    TerminalScriptResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        status: String,
        success: bool,
        #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        summary: String,
        #[serde(rename = "stdoutSummary", skip_serializing_if = "Option::is_none")]
        stdout_summary: Option<String>,
        #[serde(rename = "stderrSummary", skip_serializing_if = "Option::is_none")]
        stderr_summary: Option<String>,
        truncated: bool,
        #[serde(rename = "resolvedAt")]
        resolved_at: i64,
    },
    ToolApprovalStale {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "sessionId")]
        session_id: i64,
        #[serde(rename = "detectedBy")]
        detected_by: StaleApprovalDetectedBy,
        message: String,
        #[serde(rename = "resolvedAt")]
        resolved_at: i64,
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
