import type {
  ExecutionEvidenceData,
  PermissionApprovalWarningsData,
  RuntimeRoutingDecisionData,
  StaleApprovalStateData,
} from "../components/chat/types";

export type RuntimeSelectionState = "ready" | "unavailable";

export type RuntimeUnavailableReason =
  | "provider_not_configured"
  | "provider_not_pi_capable"
  | "legacy_requested"
  | "missing_credentials"
  | "missing_project_root"
  | "runtime_unavailable"
  | "model_not_executable";

export type RuntimeSetupAction =
  | "configure_provider"
  | "choose_supported_provider"
  | "add_credentials"
  | "open_project"
  | "retry_runtime"
  | "switch_model";

export interface RuntimeSelection {
  state: RuntimeSelectionState;
  runtime: "pi_sidecar" | string | null;
  provider: string;
  model: string;
  reason: string;
  reasonCode: RuntimeUnavailableReason | null;
  message: string;
  setupAction: RuntimeSetupAction | null;
  selectedAt: number;
}

/**
 * Mirror of `AgentEvent` (Rust src-tauri/src/agent/event.rs). Variants match
 * exactly so the Rust serde `type` tag drives dispatch here.
 */
export type AgentEvent =
  | {
      type: "user_message";
      id: string;
      content: string;
      created_at: number;
    }
  | {
      type: "runtime_selected";
      runtime: "pi_sidecar" | "legacy_loop" | string;
      provider: string;
      model: string;
      reason: string;
      created_at: number;
    }
  | {
      type: "runtime_capability_evaluated";
      state: RuntimeSelectionState;
      providerKind: string;
      model: string | null;
      reasonCode: RuntimeUnavailableReason | null;
      message: string;
      setupAction: RuntimeSetupAction | null;
      recordedAt: number;
    }
  | {
      type: "runtime_routing_decision";
      decisionId: string;
      inputKind: RuntimeRoutingDecisionData["inputKind"];
      outcome: RuntimeRoutingDecisionData["outcome"];
      reasonCode: string;
      evidenceRefs?: unknown[];
      message?: string;
      createdAt: number;
      toolCallId?: string | null;
    }
  | {
      type: "preview_open_requested";
      requestId: string;
      kind: "static_file" | "local_url" | "dev_server" | "auto";
      targetLabel: string;
      source: string;
      requestedAt: number;
    }
  | {
      type: "preview_open_result";
      requestId: string;
      kind?: "static_file" | "local_url" | "dev_server" | "auto";
      status: "ready" | "failed" | "unavailable";
      previewUrl?: string | null;
      assetFilePath?: string | null;
      targetLabel: string;
      reasonCode?: string | null;
      message: string;
      resolvedAt: number;
    }
  | {
      type: "project_command_result";
      toolCallId: string;
      commandLabel: string;
      executable: string;
      args: string[];
      timeoutSec: number;
      reason?: string | null;
      expectedEffect?: string | null;
      status: ExecutionEvidenceData["status"] | "completed" | "denied";
      success: boolean;
      exitCode?: number | null;
      summary: string;
      stdoutSummary?: string | null;
      stderrSummary?: string | null;
      createdAt: number;
    }
  | {
      type: "terminal_script_result";
      toolCallId: string;
      status: ExecutionEvidenceData["status"] | "completed" | "denied";
      success: boolean;
      exitCode?: number | null;
      summary: string;
      stdoutSummary?: string | null;
      stderrSummary?: string | null;
      truncated?: boolean;
      resolvedAt: number;
    }
  | {
      type: "tool_approval_stale";
      toolCallId: string;
      sessionId: number;
      detectedBy: StaleApprovalStateData["detectedBy"];
      message: string;
      resolvedAt: number;
    }
  | { type: "assistant_start"; id: string; created_at: number }
  | { type: "assistant_delta"; id: string; delta: string }
  | { type: "assistant_end"; id: string; content: string; finish_reason?: string }
  | {
      type: "reasoning";
      id: string;
      text: string;
      tool_call_id: string;
      created_at: number;
    }
  | {
      type: "tool_call_start";
      id: string;
      tool: string;
      params_preview: string;
      risk: "safe" | "warn" | "danger";
      diff_preview?: {
        path: string;
        before: string;
        after: string;
      } | null;
      diff_previews?:
        | {
            path: string;
            before: string;
            after: string;
          }[]
        | null;
      approval_warnings?: PermissionApprovalWarningsData | null;
      args: unknown;
    }
  | { type: "tool_call_approved"; id: string }
  | { type: "tool_call_denied"; id: string; reason: string }
  | {
      type: "tool_call_blocked";
      id: string;
      reason: { rule: string; pattern: string };
    }
  | {
      type: "tool_result";
      call_id: string;
      success: boolean;
      summary: string;
      full: unknown;
    }
  | {
      type: "agent_progress";
      kind: "heartbeat" | "reasoning" | "tool_running";
      message: string;
      created_at: number;
    }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; reason: string };

export type AgentEventEnvelope = {
  session_id: number;
  event: AgentEvent;
};

export type ChatEventPayload = AgentEvent | AgentEventEnvelope;

export function unwrapAgentEvent(
  payload: ChatEventPayload,
  expectedSessionId: number,
): AgentEvent | null {
  if ("event" in payload) {
    return payload.session_id === expectedSessionId ? payload.event : null;
  }
  return payload;
}
