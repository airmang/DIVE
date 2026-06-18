/**
 * Chat message types. DIVE_SPEC.md §5.3.1 defines the six kinds.
 * Shape kept close to Rust `ChatEvent` (§8.1) so the 2-3 adapter is simple.
 */

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMessageKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "system"
  | "error";

export interface BaseMessage {
  id: string;
  kind: ChatMessageKind;
  /** Unix ms — matches Rust `db::now_ms()`. */
  createdAt: number;
}

export interface UserMessageData extends BaseMessage {
  kind: "user";
  content: string;
}

export interface AssistantMessageData extends BaseMessage {
  kind: "assistant";
  content: string;
  /** True while `TextDelta` events still arriving; false after `End`. */
  streaming: boolean;
}

export interface ReasoningMessageData extends BaseMessage {
  kind: "reasoning";
  text: string;
  toolCallId: string;
}

export type RuntimeActionKind = "preview" | "project_command" | "terminal_script";

export type RuntimeRoutingOutcome =
  | "preview"
  | "project_command"
  | "terminal_script"
  | "blocked"
  | "rerouted"
  | "unavailable"
  | "stale";

export interface RuntimeRoutingDecisionData {
  decisionId: string;
  inputKind: RuntimeActionKind | "unknown";
  outcome: RuntimeRoutingOutcome;
  reasonCode: string;
  evidenceRefs?: unknown[];
  message?: string;
}

export interface ExecutionEvidenceData {
  evidenceId: string;
  source: RuntimeActionKind;
  status: "ready" | "passed" | "failed" | "blocked" | "unavailable" | "cancelled";
  summary: string;
  stdoutSummary?: string | null;
  stderrSummary?: string | null;
  exitCode?: number | null;
  previewTarget?: string | null;
}

export interface StaleApprovalStateData {
  toolCallId: string;
  detectedBy: "approval_click" | "deny_click" | "result_event" | "pending_refresh" | "session_reload";
  message: string;
  resolvedAt: number;
}

export interface ToolCallMessageData extends BaseMessage {
  kind: "tool_call";
  toolName: string;
  /** One-line preview of tool arguments. */
  paramsPreview: string;
  status: "pending" | "approved" | "denied" | "blocked" | "rerouted" | "stale";
  /** Populated when the backend emitted a `ToolCallStart` with risk + args. */
  risk?: "safe" | "warn" | "danger";
  runtimeAction?: RuntimeActionKind;
  routingDecision?: RuntimeRoutingDecisionData;
  executionEvidence?: ExecutionEvidenceData;
  diffPreview?: {
    path: string;
    before: string;
    after: string;
  } | null;
  args?: unknown;
  deniedReason?: string;
  /** Spec §9.2 — populated when a `tool_call_blocked` event arrived. */
  blockedReason?: {
    rule: string;
    pattern: string;
  };
}

export interface ToolApprovalMetadata {
  source: "provocation.continue_with_risk";
  cardId: string;
  cardType: string;
  actionId: string;
  riskReason: string;
  highRiskFiles: string[];
}

export interface ToolResultMessageData extends BaseMessage {
  kind: "tool_result";
  toolName: string;
  success: boolean;
  summary: string;
  runtimeAction?: RuntimeActionKind;
  executionEvidence?: ExecutionEvidenceData;
  full?: unknown;
}

export interface SystemMessageData extends BaseMessage {
  kind: "system";
  content: string;
}

export interface ErrorMessageData extends BaseMessage {
  kind: "error";
  message: string;
  retryable: boolean;
}

export type ChatMessage =
  | UserMessageData
  | AssistantMessageData
  | ReasoningMessageData
  | ToolCallMessageData
  | ToolResultMessageData
  | SystemMessageData
  | ErrorMessageData;
