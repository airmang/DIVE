import type {
  AssistantMessageData,
  ChatMessage,
  ErrorMessageData,
  ExecutionEvidenceData,
  RuntimeActionKind,
  RuntimeRoutingDecisionData,
  SystemMessageData,
  ToolCallMessageData,
  ToolResultMessageData,
  UserMessageData,
} from "../components/chat/types";
import { translate, useLocaleStore } from "../i18n";
import type { AgentEvent, RuntimeSelection, RuntimeUnavailableReason } from "./agent-events";

export interface ChatSessionState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isTauri: boolean;
  error: string | null;
  runtimeSelection: RuntimeSelection | null;
  runStartedAt: number | null;
  cancelRequested: boolean;
  /** True while a session's persisted history is being fetched (drives the skeleton). */
  loadingHistory: boolean;
}

export function mergeMessagesById(
  messages: ChatMessage[],
  additions: ChatMessage[],
): ChatMessage[] {
  const indexById = new Map(messages.map((message, index) => [message.id, index]));
  const merged = [...messages];
  for (const addition of additions) {
    const existingIndex = indexById.get(addition.id);
    if (existingIndex === undefined) {
      indexById.set(addition.id, merged.length);
      merged.push(addition);
    } else {
      merged[existingIndex] = addition;
    }
  }
  return merged;
}

export function normalizeEvidenceStatus(
  status: ExecutionEvidenceData["status"] | "completed" | "denied",
  success: boolean,
): ExecutionEvidenceData["status"] {
  if (status === "completed") return success ? "passed" : "failed";
  if (status === "denied") return "cancelled";
  return status;
}

export function runtimeActionForTool(toolName: string): RuntimeActionKind | undefined {
  if (toolName === "preview_open") return "preview";
  if (toolName === "run_process") return "project_command";
  if (toolName === "run_terminal_script") return "terminal_script";
  return undefined;
}

function runtimeUnavailableMessage(reasonCode: RuntimeUnavailableReason): string {
  return translate(useLocaleStore.getState().locale, `runtime.capability.reasons.${reasonCode}`);
}

function normalizeRuntimeSelection(
  evt: Extract<AgentEvent, { type: "runtime_selected" }>,
): RuntimeSelection {
  if (evt.runtime === "pi_sidecar") {
    return {
      state: "ready",
      runtime: "pi_sidecar",
      provider: evt.provider,
      model: evt.model,
      reason: evt.reason,
      reasonCode: null,
      message: translate(useLocaleStore.getState().locale, "runtime.capability.ready_message"),
      setupAction: null,
      selectedAt: evt.created_at,
    };
  }

  const reasonCode: RuntimeUnavailableReason =
    evt.runtime === "legacy_loop" ? "legacy_requested" : "runtime_unavailable";
  return {
    state: "unavailable",
    runtime: null,
    provider: evt.provider,
    model: evt.model,
    reason: evt.reason,
    reasonCode,
    message: runtimeUnavailableMessage(reasonCode),
    setupAction: reasonCode === "legacy_requested" ? "choose_supported_provider" : "retry_runtime",
    selectedAt: evt.created_at,
  };
}

function normalizeRuntimeCapability(
  evt: Extract<AgentEvent, { type: "runtime_capability_evaluated" }>,
): RuntimeSelection {
  const displayMessage =
    evt.state === "unavailable" && evt.reasonCode
      ? runtimeUnavailableMessage(evt.reasonCode)
      : evt.message ||
        translate(useLocaleStore.getState().locale, "runtime.capability.ready_message");
  return {
    state: evt.state,
    runtime: evt.state === "ready" ? "pi_sidecar" : null,
    provider: evt.providerKind,
    model: evt.model ?? "unknown",
    reason: evt.message,
    reasonCode: evt.reasonCode,
    message: displayMessage,
    setupAction: evt.setupAction,
    selectedAt: evt.recordedAt,
  };
}

function runtimeSystemMessage(selection: RuntimeSelection): string {
  const locale = useLocaleStore.getState().locale;
  if (selection.state === "ready") {
    const label = translate(locale, "runtime.capability.ready_label");
    return `Runtime: ${label} · ${selection.provider}/${selection.model} · ${selection.reason}`;
  }
  const label = translate(locale, "runtime.capability.unavailable_label");
  return `${label}: ${selection.message} · ${selection.provider}/${selection.model}`;
}

/**
 * `runTerminal` mirrors the hook's per-run terminal latch (see `runTerminalRef` in
 * `useChatSession`): true once `done`/`error` has fired for the current run and no
 * later run-start event has arrived yet. Callers outside the hook may omit it — it
 * only affects the `agent_progress` case, which otherwise would let a straggler
 * heartbeat resurrect `isStreaming` after the run has already ended (S-052 D2).
 */
export function reduceChatSessionState(
  prev: ChatSessionState,
  evt: AgentEvent,
  runTerminal = false,
): ChatSessionState {
  switch (evt.type) {
    case "user_message": {
      const m: UserMessageData = {
        id: evt.id,
        kind: "user",
        createdAt: evt.created_at,
        content: evt.content,
      };
      return { ...prev, messages: [...prev.messages, m] };
    }
    case "runtime_selected": {
      const selection = normalizeRuntimeSelection(evt);
      const m: SystemMessageData = {
        id: `runtime-${evt.created_at}`,
        kind: "system",
        createdAt: evt.created_at,
        content: runtimeSystemMessage(selection),
      };
      return {
        ...prev,
        runtimeSelection: selection,
        messages: mergeMessagesById(prev.messages, [m]),
      };
    }
    case "runtime_capability_evaluated": {
      const selection = normalizeRuntimeCapability(evt);
      const m: SystemMessageData = {
        id: `runtime-capability-${evt.recordedAt}`,
        kind: "system",
        createdAt: evt.recordedAt,
        content: runtimeSystemMessage(selection),
      };
      return {
        ...prev,
        runtimeSelection: selection,
        messages: mergeMessagesById(prev.messages, [m]),
      };
    }
    case "runtime_routing_decision": {
      const decision: RuntimeRoutingDecisionData = {
        decisionId: evt.decisionId,
        inputKind: evt.inputKind,
        outcome: evt.outcome,
        reasonCode: evt.reasonCode,
        evidenceRefs: evt.evidenceRefs ?? [],
        message: evt.message,
      };
      const status =
        evt.outcome === "rerouted"
          ? "rerouted"
          : evt.outcome === "stale"
            ? "stale"
            : evt.outcome === "blocked"
              ? "blocked"
              : evt.outcome === "unavailable"
                ? "denied"
                : undefined;
      const messages = evt.toolCallId
        ? prev.messages.map((m) =>
            m.id === evt.toolCallId && m.kind === "tool_call"
              ? {
                  ...m,
                  status: status ?? m.status,
                  routingDecision: decision,
                  deniedReason: evt.message ?? m.deniedReason,
                }
              : m,
          )
        : prev.messages;
      const m: SystemMessageData = {
        id: `runtime-routing-${evt.decisionId}`,
        kind: "system",
        createdAt: evt.createdAt,
        content:
          evt.message ??
          translate(useLocaleStore.getState().locale, "runtime.actions.stale_no_command_ran"),
      };
      return { ...prev, messages: mergeMessagesById(messages, [m]) };
    }
    case "preview_open_requested": {
      const m: SystemMessageData = {
        id: `preview-request-${evt.requestId}`,
        kind: "system",
        createdAt: evt.requestedAt,
        content: `${translate(useLocaleStore.getState().locale, "runtime.actions.preview")}: ${
          evt.targetLabel
        }`,
      };
      return { ...prev, messages: mergeMessagesById(prev.messages, [m]) };
    }
    case "preview_open_result": {
      const evidence: ExecutionEvidenceData = {
        evidenceId: `preview-${evt.requestId}`,
        source: "preview",
        status: evt.status === "ready" ? "ready" : evt.status,
        summary: evt.message,
        previewTarget: evt.targetLabel,
      };
      const m: ToolResultMessageData = {
        id: `preview-result-${evt.requestId}`,
        kind: "tool_result",
        createdAt: evt.resolvedAt,
        toolName: "preview_open",
        success: evt.status === "ready",
        summary: evt.message,
        runtimeAction: "preview",
        executionEvidence: evidence,
        full: evt,
      };
      return { ...prev, messages: mergeMessagesById(prev.messages, [m]) };
    }
    case "assistant_start": {
      const m: AssistantMessageData = {
        id: evt.id,
        kind: "assistant",
        createdAt: evt.created_at,
        content: "",
        streaming: true,
      };
      return { ...prev, messages: [...prev.messages, m] };
    }
    case "assistant_delta": {
      const hasPlaceholder = prev.messages.some((m) => m.id === evt.id && m.kind === "assistant");
      if (hasPlaceholder) {
        return {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === evt.id && m.kind === "assistant"
              ? { ...m, content: m.content + evt.delta }
              : m,
          ),
        };
      }
      // Reattaching mid-stream: assistant_start fired before this hook instance
      // (re)mounted, so there is no placeholder to append to. Upsert one instead
      // of silently dropping the delta, mirroring the mergeMessagesById pattern
      // tool_call_start already uses for the same kind of replay.
      const started: AssistantMessageData = {
        id: evt.id,
        kind: "assistant",
        createdAt: Date.now(),
        content: evt.delta,
        streaming: true,
      };
      return { ...prev, messages: mergeMessagesById(prev.messages, [started]) };
    }
    case "assistant_end": {
      const hasPlaceholder = prev.messages.some((m) => m.id === evt.id && m.kind === "assistant");
      const ended: AssistantMessageData = {
        id: evt.id,
        kind: "assistant",
        createdAt: Date.now(),
        content: evt.content,
        streaming: false,
      };
      const messages = hasPlaceholder
        ? prev.messages.map((m) =>
            m.id === evt.id && m.kind === "assistant"
              ? { ...m, content: evt.content, streaming: false }
              : m,
          )
        : mergeMessagesById(prev.messages, [ended]);
      if (evt.finish_reason === "length") {
        const error: ErrorMessageData = {
          id: `err-${Date.now()}`,
          kind: "error",
          createdAt: Date.now(),
          message:
            "assistant_length: assistant response stopped because the model hit its output limit",
          retryable: true,
        };
        messages.push(error);
      }
      return {
        ...prev,
        messages,
        isStreaming: false,
        runStartedAt: null,
        cancelRequested: false,
      };
    }
    case "reasoning": {
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: evt.id,
            kind: "reasoning",
            createdAt: evt.created_at,
            text: evt.text,
            toolCallId: evt.tool_call_id,
          },
        ],
      };
    }
    case "tool_call_start": {
      const m: ToolCallMessageData = {
        id: evt.id,
        kind: "tool_call",
        createdAt: Date.now(),
        toolName: evt.tool,
        paramsPreview: evt.params_preview,
        status: "pending",
        risk: evt.risk,
        runtimeAction: runtimeActionForTool(evt.tool),
        diffPreview: evt.diff_preview ?? null,
        diffPreviews: evt.diff_previews ?? null,
        approvalWarnings: evt.approval_warnings ?? null,
        args: evt.args,
      };
      return {
        ...prev,
        messages: mergeMessagesById(prev.messages, [m]),
        isStreaming: true,
        runStartedAt: prev.runStartedAt ?? Date.now(),
        cancelRequested: false,
      };
    }
    case "tool_call_approved": {
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === evt.id && m.kind === "tool_call" ? { ...m, status: "approved" } : m,
        ),
      };
    }
    case "tool_call_denied": {
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === evt.id && m.kind === "tool_call"
            ? { ...m, status: "denied", deniedReason: evt.reason }
            : m,
        ),
      };
    }
    case "tool_call_blocked": {
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === evt.id && m.kind === "tool_call"
            ? { ...m, status: "blocked", blockedReason: evt.reason }
            : m,
        ),
      };
    }
    case "tool_result": {
      const toolCall = prev.messages.find((m) => m.id === evt.call_id && m.kind === "tool_call") as
        | ToolCallMessageData
        | undefined;
      const runtimeAction = runtimeActionForTool(toolCall?.toolName ?? "");
      const m: ToolResultMessageData = {
        id: `tr-${evt.call_id}`,
        kind: "tool_result",
        createdAt: Date.now(),
        toolName: toolCall?.toolName ?? "tool",
        success: evt.success,
        summary: evt.summary,
        runtimeAction,
        full: evt.full,
      };
      const messages = prev.messages.map((message) => {
        if (
          message.id !== evt.call_id ||
          message.kind !== "tool_call" ||
          message.status !== "pending"
        ) {
          return message;
        }
        return evt.success
          ? { ...message, status: "approved" as const }
          : { ...message, status: "denied" as const, deniedReason: evt.summary };
      });
      return { ...prev, messages: [...messages, m] };
    }
    case "project_command_result":
    case "terminal_script_result": {
      const source = evt.type === "project_command_result" ? "project_command" : "terminal_script";
      const eventTime = evt.type === "project_command_result" ? evt.createdAt : evt.resolvedAt;
      const evidence: ExecutionEvidenceData = {
        evidenceId: `${source}-${evt.toolCallId}-${eventTime}`,
        source,
        status: normalizeEvidenceStatus(evt.status, evt.success),
        summary: evt.summary,
        stdoutSummary: evt.stdoutSummary ?? null,
        stderrSummary: evt.stderrSummary ?? null,
        exitCode: evt.exitCode ?? null,
      };
      const result: ToolResultMessageData = {
        id: `tr-${evt.toolCallId}`,
        kind: "tool_result",
        createdAt: eventTime,
        toolName: source === "project_command" ? "run_process" : "run_terminal_script",
        success: evt.success,
        summary: evt.summary,
        runtimeAction: source,
        executionEvidence: evidence,
        full: evt,
      };
      const messages = prev.messages.map((m) =>
        m.id === evt.toolCallId && m.kind === "tool_call"
          ? {
              ...m,
              status: evt.success
                ? ("approved" as const)
                : m.routingDecision?.outcome === "rerouted"
                  ? ("rerouted" as const)
                  : ("denied" as const),
              deniedReason: evt.success ? m.deniedReason : evt.summary,
              executionEvidence: evidence,
            }
          : m,
      );
      return { ...prev, messages: mergeMessagesById(messages, [result]) };
    }
    case "tool_approval_stale": {
      const messages = prev.messages.map((m) =>
        m.id === evt.toolCallId && m.kind === "tool_call"
          ? {
              ...m,
              status: "stale" as const,
              deniedReason: evt.message,
            }
          : m,
      );
      const stale: ErrorMessageData = {
        id: `stale-${evt.toolCallId}-${evt.resolvedAt}`,
        kind: "error",
        createdAt: evt.resolvedAt,
        message: evt.message,
        retryable: false,
      };
      return { ...prev, messages: mergeMessagesById(messages, [stale]) };
    }
    case "agent_progress": {
      if (runTerminal) return prev;
      return {
        ...prev,
        isStreaming: true,
        runStartedAt: prev.runStartedAt ?? evt.created_at,
        cancelRequested: false,
      };
    }
    case "error": {
      const m: ErrorMessageData = {
        id: `err-${Date.now()}`,
        kind: "error",
        createdAt: Date.now(),
        message: evt.message,
        retryable: evt.retryable,
      };
      return {
        ...prev,
        messages: [...prev.messages, m],
        isStreaming: false,
        runStartedAt: null,
        cancelRequested: false,
      };
    }
    case "done": {
      const m: SystemMessageData = {
        id: `done-${Date.now()}`,
        kind: "system",
        createdAt: Date.now(),
        content: `세션 종료 (${evt.reason})`,
      };
      return {
        ...prev,
        messages: [...prev.messages, m],
        isStreaming: false,
        runStartedAt: null,
        cancelRequested: false,
      };
    }
  }
}
