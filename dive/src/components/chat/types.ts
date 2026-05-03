/**
 * Chat message types. DIVE_SPEC.md §5.3.1 defines the six kinds.
 * Shape kept close to Rust `ChatEvent` (§8.1) so the 2-3 adapter is simple.
 */

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMessageKind =
  | "user"
  | "assistant"
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

export interface ToolCallMessageData extends BaseMessage {
  kind: "tool_call";
  toolName: string;
  /** One-line preview of tool arguments. */
  paramsPreview: string;
  status: "pending" | "approved" | "denied";
  /** Populated when the backend emitted a `ToolCallStart` with risk + args. */
  risk?: "safe" | "warn" | "danger";
  diffPreview?: {
    path: string;
    before: string;
    after: string;
  } | null;
  args?: unknown;
  deniedReason?: string;
}

export interface ToolResultMessageData extends BaseMessage {
  kind: "tool_result";
  toolName: string;
  success: boolean;
  summary: string;
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
  | ToolCallMessageData
  | ToolResultMessageData
  | SystemMessageData
  | ErrorMessageData;
