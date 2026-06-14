use serde::Deserialize;

use crate::agent::AgentEvent;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum SidecarEvent {
    Ready {
        model: String,
        enabled_tools: Vec<String>,
    },
    ToolCall {
        tool_call_id: String,
        name: String,
        #[allow(dead_code)]
        params: serde_json::Value,
    },
    AssistantDelta {
        delta: String,
    },
    ReasoningDelta {
        delta: String,
    },
    ToolCallEnd {
        #[allow(dead_code)]
        tool_call_id: String,
    },
    TurnSucceeded {
        assistant_text: String,
    },
    Error {
        message: String,
    },
    Heartbeat {
        #[allow(dead_code)]
        request_id: Option<String>,
        #[allow(dead_code)]
        turn_id: Option<String>,
        #[allow(dead_code)]
        ts: Option<u64>,
    },
}

pub(super) fn map_sidecar_delta_event(
    event: &SidecarEvent,
    assistant_id: &str,
) -> Option<AgentEvent> {
    match event {
        SidecarEvent::AssistantDelta { delta } => Some(AgentEvent::AssistantDelta {
            id: assistant_id.to_string(),
            delta: delta.clone(),
        }),
        // Legacy provider streaming stores reasoning deltas for assistant-message
        // persistence, but does not emit a UI-facing AgentEvent per token.
        SidecarEvent::ReasoningDelta { .. } => None,
        _ => None,
    }
}

pub(super) fn sidecar_event_name(event: &SidecarEvent) -> &'static str {
    match event {
        SidecarEvent::Ready { .. } => "ready",
        SidecarEvent::ToolCall { .. } => "tool_call",
        SidecarEvent::AssistantDelta { .. } => "assistant_delta",
        SidecarEvent::ReasoningDelta { .. } => "reasoning_delta",
        SidecarEvent::ToolCallEnd { .. } => "tool_call_end",
        SidecarEvent::TurnSucceeded { .. } => "turn_succeeded",
        SidecarEvent::Error { .. } => "error",
        SidecarEvent::Heartbeat { .. } => "heartbeat",
    }
}

pub(super) fn assert_supervisor_ready_boundary(enabled_tools: &[String]) -> Result<(), String> {
    if enabled_tools.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "SupervisorAgent ready.enabled_tools must be empty, got {:?}",
            enabled_tools
        ))
    }
}
