import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalDecisionWithTime } from "../components/workmap/ApprovalJudgment";
import type {
  AssistantMessageData,
  ChatMessage,
  ErrorMessageData,
  ExecutionEvidenceData,
  RuntimeActionKind,
  RuntimeRoutingDecisionData,
  SystemMessageData,
  StaleApprovalStateData,
  ToolApprovalMetadata,
  PermissionApprovalWarningsData,
  ToolCallMessageData,
  ToolResultMessageData,
  UserMessageData,
} from "../components/chat/types";
import { translate, useLocaleStore } from "../i18n";
import { useSlideInStore } from "../stores/slideIn";
import type { PreviewSessionKind } from "../components/slide-in/types";

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

type AgentEventEnvelope = {
  session_id: number;
  event: AgentEvent;
};

type ChatEventPayload = AgentEvent | AgentEventEnvelope;

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

function unwrapAgentEvent(payload: ChatEventPayload, expectedSessionId: number): AgentEvent | null {
  if ("event" in payload) {
    return payload.session_id === expectedSessionId ? payload.event : null;
  }
  return payload;
}

type PendingToolCall = {
  id: string;
  sessionId: number;
  tool: string;
  paramsPreview: string;
  risk: "safe" | "warn" | "danger";
  diffPreview?: {
    path: string;
    before: string;
    after: string;
  } | null;
  diffPreviews?:
    | {
        path: string;
        before: string;
        after: string;
      }[]
    | null;
  approvalWarnings?: PermissionApprovalWarningsData | null;
  args: unknown;
};

export interface VerifyLogPayload {
  intent_match: boolean;
  test_result: "pass" | "fail" | "skipped";
  details: string;
  model: string;
  ran_at: number;
  test_command?: string | null;
  test_exit_code?: number | null;
  test_stdout?: string | null;
  test_stderr?: string | null;
}

export interface CheckpointRowPayload {
  id: number;
  session_id: number;
  card_id: number | null;
  git_sha: string;
  kind: "init" | "auto" | "manual" | string;
  label: string | null;
  created_at: number;
  changed_files?: string[];
  file_changes?: number;
  stats?: {
    added: number;
    removed: number;
    modified: number;
  };
  has_session_state_snapshot?: boolean;
}

interface CheckpointRestorePayload {
  restored_session_state: boolean;
}

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
  convertFileSrc: (path: string) => string;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined"
      ? null
      : (window as unknown as {
          __TAURI_INTERNALS__?: unknown;
        });
  if (!w?.__TAURI_INTERNALS__) return null;
  const [coreMod, eventMod] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return {
    invoke: coreMod.invoke as TauriApi["invoke"],
    convertFileSrc: coreMod.convertFileSrc,
    listen: eventMod.listen as unknown as TauriApi["listen"],
  };
}

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

export interface SendUserMessageContext {
  text: string;
  runMode?: "interview" | "plan" | "build" | "verify";
  planAccepted?: boolean;
  stepId?: number;
}

type BeforeSendUserMessage = (context: SendUserMessageContext) => boolean | Promise<boolean>;

function pendingToolCallToMessage(call: PendingToolCall): ToolCallMessageData {
  return {
    id: call.id,
    kind: "tool_call",
    createdAt: Date.now(),
    toolName: call.tool,
    paramsPreview: call.paramsPreview,
    status: "pending",
    risk: call.risk,
    runtimeAction: runtimeActionForTool(call.tool),
    diffPreview: call.diffPreview ?? null,
    diffPreviews: call.diffPreviews ?? null,
    approvalWarnings: call.approvalWarnings ?? null,
    args: call.args,
  };
}

function mergeMessagesById(messages: ChatMessage[], additions: ChatMessage[]): ChatMessage[] {
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

function stringFromRecord(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function splitTerminalLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, 200);
}

function appendToolResultToTerminal(evt: Extract<AgentEvent, { type: "tool_result" }>) {
  if (isPreviewOpenPayload(evt.full)) return;
  if (stringFromRecord(evt.full, "runtimeAction") === "project_command") return;
  if (stringFromRecord(evt.full, "runtimeAction") === "terminal_script") return;
  const { pushTerminalLine } = useSlideInStore.getState();
  const command = stringFromRecord(evt.full, "command");
  const stdout = stringFromRecord(evt.full, "stdout");
  const stderr = stringFromRecord(evt.full, "stderr");
  const prefix = evt.success ? "ok" : "fail";

  pushTerminalLine({
    kind: evt.success ? "info" : "stderr",
    text: command ? `$ ${command} — ${evt.summary}` : `[${prefix}] ${evt.summary}`,
  });
  if (stdout) {
    for (const line of splitTerminalLines(stdout)) {
      pushTerminalLine({ kind: "stdout", text: line });
    }
  }
  if (stderr) {
    for (const line of splitTerminalLines(stderr)) {
      pushTerminalLine({ kind: "stderr", text: line });
    }
  }
}

function appendProjectCommandResultToTerminal(
  evt: Extract<AgentEvent, { type: "project_command_result" }>,
) {
  const { pushTerminalLine } = useSlideInStore.getState();
  const commandLabel =
    evt.commandLabel ||
    [evt.executable, ...(Array.isArray(evt.args) ? evt.args : [])].filter(Boolean).join(" ");
  const exitText =
    evt.exitCode === null || evt.exitCode === undefined ? "" : ` (exit ${evt.exitCode})`;
  pushTerminalLine({
    kind: evt.success ? "info" : "stderr",
    text: `$ ${commandLabel} — ${evt.summary}${exitText}`,
  });
  if (evt.stdoutSummary) {
    for (const line of splitTerminalLines(evt.stdoutSummary)) {
      pushTerminalLine({ kind: "stdout", text: line });
    }
  }
  if (evt.stderrSummary) {
    for (const line of splitTerminalLines(evt.stderrSummary)) {
      pushTerminalLine({ kind: "stderr", text: line });
    }
  }
}

function appendTerminalScriptResultToTerminal(
  evt: Extract<AgentEvent, { type: "terminal_script_result" }>,
) {
  const { pushTerminalLine } = useSlideInStore.getState();
  const exitText =
    evt.exitCode === null || evt.exitCode === undefined ? "" : ` (exit ${evt.exitCode})`;
  const locale = useLocaleStore.getState().locale;
  const truncationText = evt.truncated
    ? ` · ${translate(locale, "slide_in.terminal.output_truncated")}`
    : "";
  pushTerminalLine({
    kind: evt.success ? "info" : "stderr",
    text: `[Terminal Script] ${evt.summary}${exitText}${truncationText}`,
  });
  if (evt.stdoutSummary) {
    for (const line of splitTerminalLines(evt.stdoutSummary)) {
      pushTerminalLine({ kind: "stdout", text: line });
    }
  }
  if (evt.stderrSummary) {
    for (const line of splitTerminalLines(evt.stderrSummary)) {
      pushTerminalLine({ kind: "stderr", text: line });
    }
  }
}

function isPreviewOpenPayload(value: unknown): value is {
  requestId: string;
  status: "ready" | "failed" | "unavailable";
  kind?: "static_file" | "local_url" | "dev_server" | "auto";
  previewUrl?: string | null;
  assetFilePath?: string | null;
  targetLabel: string;
  reasonCode?: string | null;
  message: string;
  resolvedAt?: number;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === "string" &&
    typeof record.status === "string" &&
    typeof record.targetLabel === "string" &&
    typeof record.message === "string"
  );
}

function previewSessionKind(value: unknown): PreviewSessionKind | undefined {
  return value === "static_file" || value === "local_url" || value === "dev_server"
    ? value
    : undefined;
}

function normalizeEvidenceStatus(
  status: ExecutionEvidenceData["status"] | "completed" | "denied",
  success: boolean,
): ExecutionEvidenceData["status"] {
  if (status === "completed") return success ? "passed" : "failed";
  if (status === "denied") return "cancelled";
  return status;
}

function runtimeActionForTool(toolName: string): RuntimeActionKind | undefined {
  if (toolName === "preview_open") return "preview";
  if (toolName === "run_process") return "project_command";
  if (toolName === "run_terminal_script") return "terminal_script";
  return undefined;
}

function reroutedPreviewTarget(
  evt: Extract<AgentEvent, { type: "runtime_routing_decision" }>,
): { kind: "static_file" | "local_url"; target: string } | null {
  if (evt.outcome !== "rerouted" || !Array.isArray(evt.evidenceRefs)) return null;
  for (const item of evt.evidenceRefs) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const target = record.previewTarget;
    if (typeof target !== "string" || target.trim().length === 0) continue;
    const kind = record.previewKind === "local_url" ? "local_url" : "static_file";
    return { kind, target };
  }
  return null;
}

function appendRuntimeEvidenceToSlideIn(evidence: ExecutionEvidenceData) {
  useSlideInStore.getState().appendRuntimeEvidence({
    evidenceId: evidence.evidenceId,
    source: evidence.source,
    status: evidence.status,
    summary: evidence.summary,
    stdoutSummary: evidence.stdoutSummary ?? null,
    stderrSummary: evidence.stderrSummary ?? null,
    exitCode: evidence.exitCode ?? null,
    previewTarget: evidence.previewTarget ?? null,
    recordedAt: Date.now(),
  });
}

/**
 * Events that begin a fresh run when the previous run is latched terminal
 * (backend-initiated supervisor/verify turns arrive on the same channel
 * without going through `sendUserMessage`).
 */
const RUN_START_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "assistant_start",
  "tool_call_start",
  "user_message",
]);

/** Events that clear the stall timer without arming a new wait. */
const STALL_CLEAR_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "assistant_end",
  "tool_call_start",
  "tool_call_approved",
  "tool_call_denied",
  "tool_call_blocked",
]);

export function useChatSession(
  sessionId: number | null,
  onAgentEvent?: (event: AgentEvent) => void,
  beforeSendUserMessage?: BeforeSendUserMessage,
) {
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  /** True when no run is currently in flight (initial, or since the last `done`/`error`). */
  const runTerminalRef = useRef(true);
  const [state, setState] = useState<ChatSessionState>({
    messages: [],
    isStreaming: false,
    isTauri: false,
    error: null,
    runtimeSelection: null,
    runStartedAt: null,
    cancelRequested: false,
    loadingHistory: false,
  });
  const apiRef = useRef<TauriApi | null>(null);
  const onAgentEventRef = useRef<typeof onAgentEvent>(onAgentEvent);
  const beforeSendUserMessageRef = useRef<typeof beforeSendUserMessage>(beforeSendUserMessage);
  const lastRetryableIntentRef = useRef<SendUserMessageContext | null>(null);
  useEffect(() => {
    onAgentEventRef.current = onAgentEvent;
  }, [onAgentEvent]);
  useEffect(() => {
    beforeSendUserMessageRef.current = beforeSendUserMessage;
  }, [beforeSendUserMessage]);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  /** Bumps run identity and clears the terminal latch — called at the start of every run. */
  const startNewRun = useCallback(() => {
    runIdRef.current += 1;
    runTerminalRef.current = false;
    return runIdRef.current;
  }, []);

  const appendErrorMessage = useCallback((message: string, retryable = true, id?: string) => {
    const m: ErrorMessageData = {
      id: id ?? `err-${Date.now()}`,
      kind: "error",
      createdAt: Date.now(),
      message,
      retryable,
    };
    setState((s) => ({
      ...s,
      messages: mergeMessagesById(s.messages, [m]),
      isStreaming: false,
      error: message,
      runStartedAt: null,
      cancelRequested: false,
    }));
  }, []);

  const expireToolApproval = useCallback((toolCallId: string, message: string) => {
    const createdAt = Date.now();
    const error: ErrorMessageData = {
      id: `err-${createdAt}`,
      kind: "error",
      createdAt,
      message,
      retryable: false,
    };
    setState((s) => ({
      ...s,
      messages: [
        ...s.messages.map((m) =>
          m.id === toolCallId && m.kind === "tool_call" && m.status === "pending"
            ? { ...m, status: "stale" as const, deniedReason: message }
            : m,
        ),
        error,
      ],
      isStreaming: false,
      error: message,
      runStartedAt: null,
      cancelRequested: false,
    }));
  }, []);

  const armStallTimer = useCallback(() => {
    clearStallTimer();
    const armedRunId = runIdRef.current;
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null;
      if (runIdRef.current !== armedRunId || runTerminalRef.current) return;
      appendErrorMessage(
        translate(useLocaleStore.getState().locale, "chat.stall_timeout"),
        true,
        `stall-${armedRunId}`,
      );
    }, 45000);
  }, [appendErrorMessage, clearStallTimer]);

  const refreshPendingApprovals = useCallback(async () => {
    if (sessionId === null) return;
    const api = apiRef.current;
    if (!api) return;
    const pending = await api.invoke<PendingToolCall[]>("pending_tool_calls", { sessionId });
    if (pending.length === 0) return;
    setState((s) => ({
      ...s,
      messages: mergeMessagesById(s.messages, pending.map(pendingToolCallToMessage)),
      isStreaming: true,
      runStartedAt: s.runStartedAt ?? Date.now(),
      cancelRequested: false,
    }));
  }, [sessionId]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    let historyLoaded = false;
    const bufferedEvents: AgentEvent[] = [];
    clearStallTimer();
    runTerminalRef.current = true;
    setState({
      messages: [],
      isStreaming: false,
      isTauri: false,
      error: null,
      runtimeSelection: null,
      runStartedAt: null,
      cancelRequested: false,
      loadingHistory: sessionId !== null,
    });
    (async () => {
      if (sessionId === null) {
        apiRef.current = null;
        return;
      }
      const api = await loadTauri();
      if (cancelled) return;
      apiRef.current = api;
      if (!api) {
        setState((s) => ({ ...s, isTauri: false, loadingHistory: false }));
        return;
      }
      const applyEventSideEffects = (payload: AgentEvent) => {
        if (payload.type === "tool_result") {
          appendToolResultToTerminal(payload);
          if (isPreviewOpenPayload(payload.full)) {
            const { setPreviewSession, open } = useSlideInStore.getState();
            const displayUrl =
              payload.full.previewUrl ??
              (payload.full.assetFilePath ? api.convertFileSrc(payload.full.assetFilePath) : null);
            setPreviewSession({
              requestId: payload.full.requestId,
              status: payload.full.status,
              kind: previewSessionKind(payload.full.kind),
              previewUrl: displayUrl,
              assetFilePath: payload.full.assetFilePath ?? null,
              targetLabel: payload.full.targetLabel,
              errorReason: payload.full.reasonCode ?? null,
              updatedAt: payload.full.resolvedAt ?? Date.now(),
            });
            if (payload.full.status === "ready" && displayUrl) {
              open({ tab: "preview", previewUrl: displayUrl });
            }
          }
        }
        if (payload.type === "preview_open_result") {
          const { setPreviewSession, open } = useSlideInStore.getState();
          const displayUrl =
            payload.previewUrl ??
            (payload.assetFilePath ? api.convertFileSrc(payload.assetFilePath) : null);
          setPreviewSession({
            requestId: payload.requestId,
            status: payload.status,
            kind: previewSessionKind(payload.kind),
            previewUrl: displayUrl,
            assetFilePath: payload.assetFilePath ?? null,
            targetLabel: payload.targetLabel,
            errorReason: payload.reasonCode ?? null,
            updatedAt: payload.resolvedAt,
          });
          if (payload.status === "ready" && displayUrl) {
            open({ tab: "preview", previewUrl: displayUrl });
          }
        }
        if (payload.type === "runtime_routing_decision" && sessionId !== null) {
          const reroute = reroutedPreviewTarget(payload);
          if (reroute) {
            void api.invoke("preview_open", {
              request: {
                sessionId,
                kind: reroute.kind,
                target: reroute.target,
                source: "reroute",
                locale: useLocaleStore.getState().locale,
              },
            });
          }
        }
        if (payload.type === "project_command_result") {
          appendProjectCommandResultToTerminal(payload);
          appendRuntimeEvidenceToSlideIn({
            evidenceId: `project-command-${payload.toolCallId}-${payload.createdAt}`,
            source: "project_command",
            status: normalizeEvidenceStatus(payload.status, payload.success),
            summary: payload.summary,
            stdoutSummary: payload.stdoutSummary ?? null,
            stderrSummary: payload.stderrSummary ?? null,
            exitCode: payload.exitCode ?? null,
          });
        }
        if (payload.type === "terminal_script_result") {
          appendTerminalScriptResultToTerminal(payload);
          appendRuntimeEvidenceToSlideIn({
            evidenceId: `terminal-script-${payload.toolCallId}-${payload.resolvedAt}`,
            source: "terminal_script",
            status: normalizeEvidenceStatus(payload.status, payload.success),
            summary: payload.summary,
            stdoutSummary: payload.stdoutSummary ?? null,
            stderrSummary: payload.stderrSummary ?? null,
            exitCode: payload.exitCode ?? null,
          });
        }
        if (payload.type === "done" || payload.type === "error") {
          runTerminalRef.current = true;
          clearStallTimer();
        } else {
          if (runTerminalRef.current && RUN_START_EVENT_TYPES.has(payload.type)) {
            startNewRun();
          }
          if (runTerminalRef.current) {
            // Straggler from a run that already ended — must not resurrect the timer.
          } else if (STALL_CLEAR_EVENT_TYPES.has(payload.type)) {
            clearStallTimer();
          } else {
            armStallTimer();
          }
        }
        onAgentEventRef.current?.(payload);
      };
      try {
        unsub = await api.listen<ChatEventPayload>(`chat://event/${sessionId}`, (e) => {
          const payload = unwrapAgentEvent(e.payload, sessionId);
          if (payload === null) return;
          if (!historyLoaded) {
            bufferedEvents.push(payload);
            return;
          }
          applyEventSideEffects(payload);
          const runTerminal = runTerminalRef.current;
          setState((prev) => reduceChatSessionState(prev, payload, runTerminal));
        });
        const [history, pending] = await Promise.all([
          api.invoke<ChatMessage[]>("message_list", { sessionId }),
          api.invoke<PendingToolCall[]>("pending_tool_calls", { sessionId }),
        ]);
        if (cancelled) return;
        historyLoaded = true;
        const pendingMessages = pending.map(pendingToolCallToMessage);
        const replayEvents = bufferedEvents.splice(0);
        replayEvents.forEach(applyEventSideEffects);
        const replayRunTerminal = runTerminalRef.current;
        setState((s) => {
          let next: ChatSessionState = {
            ...s,
            messages: mergeMessagesById(history, pendingMessages),
            isStreaming: pendingMessages.length > 0 || s.isStreaming,
            isTauri: true,
            error: null,
            runStartedAt:
              pendingMessages.length > 0 ? (s.runStartedAt ?? Date.now()) : s.runStartedAt,
            loadingHistory: false,
          };
          for (const event of replayEvents) {
            next = reduceChatSessionState(next, event, replayRunTerminal);
          }
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        historyLoaded = true;
        setState((s) => ({
          ...s,
          isTauri: true,
          loadingHistory: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
    return () => {
      cancelled = true;
      clearStallTimer();
      if (unsub) unsub();
    };
  }, [armStallTimer, clearStallTimer, sessionId, startNewRun]);

  const sendUserMessage = useCallback(
    async (
      text: string,
      runMode?: "interview" | "plan" | "build" | "verify",
      planAccepted?: boolean,
      stepId?: number,
    ) => {
      if (sessionId === null) {
        setState((s) => ({
          ...s,
          error: "세션을 선택하거나 생성하세요.",
        }));
        return;
      }
      const api = apiRef.current;
      if (!api) {
        appendErrorMessage("Tauri IPC unavailable — run `pnpm tauri:dev`", true);
        return;
      }
      const shouldSend = await beforeSendUserMessageRef.current?.({
        text,
        runMode,
        planAccepted,
        stepId,
      });
      if (shouldSend === false) return;
      lastRetryableIntentRef.current = { text, runMode, planAccepted, stepId };
      startNewRun();
      armStallTimer();
      setState((s) => ({
        ...s,
        isStreaming: true,
        error: null,
        runStartedAt: Date.now(),
        cancelRequested: false,
      }));
      try {
        await api.invoke<void>("chat_send", {
          sessionId,
          text,
          runMode: runMode ?? null,
          locale: useLocaleStore.getState().locale,
          planAccepted: planAccepted ?? null,
          stepId: stepId ?? null,
        });
        clearStallTimer();
        setState((s) => ({
          ...s,
          isStreaming: false,
          error: null,
          runStartedAt: null,
          cancelRequested: false,
        }));
      } catch (err) {
        clearStallTimer();
        appendErrorMessage(err instanceof Error ? err.message : String(err), true);
        await refreshPendingApprovals().catch(() => {});
      }
    },
    [
      appendErrorMessage,
      armStallTimer,
      clearStallTimer,
      refreshPendingApprovals,
      sessionId,
      startNewRun,
    ],
  );

  const retryLastUserMessage = useCallback(() => {
    const last = lastRetryableIntentRef.current;
    if (!last) return false;
    void sendUserMessage(last.text, last.runMode, last.planAccepted, last.stepId);
    return true;
  }, [sendUserMessage]);

  const cancel = useCallback(async () => {
    if (sessionId === null) return;
    const api = apiRef.current;
    if (!api) return;
    setState((s) => (s.isStreaming ? { ...s, cancelRequested: true } : s));
    await api.invoke<void>("chat_cancel", { sessionId });
  }, [sessionId]);

  const approveToolCall = useCallback(
    async (toolCallId: string, modifiedArgs?: unknown, approvalMetadata?: ToolApprovalMetadata) => {
      const api = apiRef.current;
      if (!api) return;
      try {
        const resolved = await api.invoke<boolean>("tool_approve", {
          toolCallId,
          modifiedArgs: modifiedArgs ?? null,
          approvalMetadata: approvalMetadata ?? null,
          sessionId,
        });
        if (!resolved) {
          expireToolApproval(
            toolCallId,
            translate(useLocaleStore.getState().locale, "chat.tool_approval_stale_approve"),
          );
          await refreshPendingApprovals().catch(() => {});
        }
      } catch (err) {
        appendErrorMessage(err instanceof Error ? err.message : String(err), true);
        await refreshPendingApprovals().catch(() => {});
      }
    },
    [appendErrorMessage, expireToolApproval, refreshPendingApprovals, sessionId],
  );

  const denyToolCall = useCallback(
    async (toolCallId: string, reason?: string) => {
      const api = apiRef.current;
      if (!api) return;
      try {
        const resolved = await api.invoke<boolean>("tool_deny", {
          toolCallId,
          reason: reason ?? null,
          locale: useLocaleStore.getState().locale,
          sessionId,
        });
        if (!resolved) {
          expireToolApproval(
            toolCallId,
            translate(useLocaleStore.getState().locale, "chat.tool_approval_stale_deny"),
          );
          await refreshPendingApprovals().catch(() => {});
        }
      } catch (err) {
        appendErrorMessage(err instanceof Error ? err.message : String(err), true);
        await refreshPendingApprovals().catch(() => {});
      }
    },
    [appendErrorMessage, expireToolApproval, refreshPendingApprovals, sessionId],
  );

  const setCurrentCard = useCallback(
    async (cardId: number | null) => {
      if (sessionId === null) return;
      const api = apiRef.current;
      if (!api) return;
      await api.invoke<void>("workmap_set_current_card", {
        sessionId,
        cardId,
      });
    },
    [sessionId],
  );

  const updateCardInstruction = useCallback(async (cardId: number, instruction: string) => {
    const api = apiRef.current;
    if (!api) return null;
    return api.invoke<string>("card_update_instruction", {
      cardId,
      instruction,
    });
  }, []);

  const transitionCardRemote = useCallback(
    async (
      cardId: number,
      transition:
        | "enter_instruct"
        | "request_verify"
        | "approve"
        | "reject"
        | "reopen_from_reject"
        | "extend",
      approveForce = false,
      judgment?: ApprovalDecisionWithTime,
    ) => {
      const api = apiRef.current;
      if (!api) return null;
      return api.invoke<string>("card_transition", {
        cardId,
        transition,
        approveForce,
        judgment: judgment ?? null,
      });
    },
    [],
  );

  const verifyCard = useCallback(
    async (cardId: number) => {
      if (sessionId === null) return null;
      const api = apiRef.current;
      if (!api) return null;
      return api.invoke<VerifyLogPayload>("card_verify", {
        sessionId,
        cardId,
        locale: useLocaleStore.getState().locale,
      });
    },
    [sessionId],
  );

  const createCheckpoint = useCallback(
    async (cardId: number | null, label?: string) => {
      if (sessionId === null) return null;
      const api = apiRef.current;
      if (!api) return null;
      return api.invoke<CheckpointRowPayload>("checkpoint_create", {
        sessionId,
        cardId,
        label: label ?? null,
      });
    },
    [sessionId],
  );

  const listCheckpoints = useCallback(async () => {
    if (sessionId === null) return [];
    const api = apiRef.current;
    if (!api) return [];
    return api.invoke<CheckpointRowPayload[]>("checkpoint_list", { sessionId });
  }, [sessionId]);

  const restoreCheckpoint = useCallback(
    async (checkpointId: number) => {
      const api = apiRef.current;
      if (!api) return { restored_session_state: false };
      const result = await api.invoke<CheckpointRestorePayload>("checkpoint_restore", {
        checkpointId,
      });
      if (result.restored_session_state && sessionId !== null) {
        const [history, pending] = await Promise.all([
          api.invoke<ChatMessage[]>("message_list", { sessionId }),
          api.invoke<PendingToolCall[]>("pending_tool_calls", { sessionId }),
        ]);
        const pendingMessages = pending.map(pendingToolCallToMessage);
        setState((s) => ({
          ...s,
          messages: mergeMessagesById(history, pendingMessages),
          isStreaming: pendingMessages.length > 0,
          runStartedAt: pendingMessages.length > 0 ? (s.runStartedAt ?? Date.now()) : null,
          error: null,
        }));
        return result;
      }

      const createdAt = Date.now();
      const marker: SystemMessageData = {
        id: `checkpoint-restore-${checkpointId}-${createdAt}`,
        kind: "system",
        createdAt,
        content: translate(useLocaleStore.getState().locale, "recovery.restore_chat_marker", {
          checkpoint: checkpointId,
        }),
      };
      setState((s) => ({
        ...s,
        messages: mergeMessagesById(s.messages, [marker]),
      }));
      return result;
    },
    [sessionId],
  );

  return {
    ...state,
    sendUserMessage,
    retryLastUserMessage,
    cancel,
    approveToolCall,
    denyToolCall,
    setCurrentCard,
    updateCardInstruction,
    transitionCardRemote,
    verifyCard,
    createCheckpoint,
    listCheckpoints,
    restoreCheckpoint,
  };
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
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === evt.id && m.kind === "assistant" ? { ...m, content: m.content + evt.delta } : m,
        ),
      };
    }
    case "assistant_end": {
      const messages = prev.messages.map((m) =>
        m.id === evt.id && m.kind === "assistant"
          ? { ...m, content: evt.content, streaming: false }
          : m,
      );
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
