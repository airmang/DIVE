import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalDecisionWithTime } from "../components/workmap/ApprovalJudgment";
import type {
  ChatMessage,
  ErrorMessageData,
  ExecutionEvidenceData,
  SystemMessageData,
  ToolApprovalMetadata,
  PermissionApprovalWarningsData,
  ToolCallMessageData,
} from "../components/chat/types";
import { translate, useLocaleStore } from "../i18n";
import { useSlideInStore } from "../stores/slideIn";
import type { PreviewSessionKind } from "../components/slide-in/types";
import { loadTauriEvents, type TauriEventApi } from "../lib/tauri";
import { unwrapAgentEvent, type AgentEvent, type ChatEventPayload } from "./agent-events";
import {
  mergeMessagesById,
  normalizeEvidenceStatus,
  reduceChatSessionState,
  runtimeActionForTool,
  type ChatSessionState,
} from "./chat-session-reducer";

// The AgentEvent union + runtime types moved to ./agent-events and the pure
// reducer/normalizers to ./chat-session-reducer; re-export the surface external
// callers and unit tests still import from this module.
export { reduceChatSessionState } from "./chat-session-reducer";
export type { ChatSessionState } from "./chat-session-reducer";
export type {
  AgentEvent,
  RuntimeSelection,
  RuntimeSelectionState,
  RuntimeSetupAction,
  RuntimeUnavailableReason,
} from "./agent-events";

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
  const apiRef = useRef<TauriEventApi | null>(null);
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
    // Idempotent: safe to call from the cleanup fn and from the async body
    // below without double-invoking the resolved Tauri unlisten callback.
    const stopListening = () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
    };
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
      const api = await loadTauriEvents();
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
        // Cleanup may have already run while this listen() was pending — in
        // that case its `if (unsub) unsub()` saw unsub still null and could
        // not tear it down. Catch that here before the listener (and the
        // ever-growing bufferedEvents behind it) is allowed to leak.
        if (cancelled) {
          stopListening();
          return;
        }
        const [history, pending] = await Promise.all([
          api.invoke<ChatMessage[]>("message_list", { sessionId }),
          api.invoke<PendingToolCall[]>("pending_tool_calls", { sessionId }),
        ]);
        if (cancelled) {
          stopListening();
          return;
        }
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
        if (cancelled) {
          stopListening();
          return;
        }
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
      stopListening();
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
