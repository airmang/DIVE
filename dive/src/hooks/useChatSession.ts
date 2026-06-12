import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalDecisionWithTime } from "../components/workmap/ApprovalJudgment";
import type {
  AssistantMessageData,
  ChatMessage,
  ErrorMessageData,
  SystemMessageData,
  ToolCallMessageData,
  ToolResultMessageData,
  UserMessageData,
} from "../components/chat/types";
import { translate, useLocaleStore } from "../i18n";
import { useSlideInStore } from "../stores/slideIn";

/**
 * Mirror of `AgentEvent` (Rust src-tauri/src/agent/event.rs). Variants match
 * exactly so the Rust serde `type` tag drives dispatch here.
 */
type AgentEvent =
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
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; reason: string };

type AgentEventEnvelope = {
  session_id: number;
  event: AgentEvent;
};

type ChatEventPayload = AgentEvent | AgentEventEnvelope;

export interface RuntimeSelection {
  runtime: "pi_sidecar" | "legacy_loop" | string;
  provider: string;
  model: string;
  reason: string;
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
}

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
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
    listen: eventMod.listen as unknown as TauriApi["listen"],
  };
}

interface State {
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
    diffPreview: call.diffPreview ?? null,
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
  return text.split(/\r?\n/).filter((line) => line.length > 0).slice(0, 200);
}

function appendToolResultToTerminal(evt: Extract<AgentEvent, { type: "tool_result" }>) {
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

export function useChatSession(
  sessionId: number | null,
  onAgentEvent?: (event: AgentEvent) => void,
  beforeSendUserMessage?: BeforeSendUserMessage,
) {
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<State>({
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

  const appendErrorMessage = useCallback((message: string, retryable = true) => {
    const m: ErrorMessageData = {
      id: `err-${Date.now()}`,
      kind: "error",
      createdAt: Date.now(),
      message,
      retryable,
    };
    setState((s) => ({
      ...s,
      messages: [...s.messages, m],
      isStreaming: false,
      error: message,
      runStartedAt: null,
      cancelRequested: false,
    }));
  }, []);

  const armStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      appendErrorMessage(translate(useLocaleStore.getState().locale, "chat.stall_timeout"), true);
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
        }
        if (
          payload.type === "done" ||
          payload.type === "error" ||
          payload.type === "assistant_end" ||
          payload.type === "tool_call_start" ||
          payload.type === "tool_call_approved"
        ) {
          clearStallTimer();
        } else {
          armStallTimer();
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
          setState((prev) => reduce(prev, payload));
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
        setState((s) => {
          let next: State = {
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
            next = reduce(next, event);
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
  }, [armStallTimer, clearStallTimer, sessionId]);

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
    [appendErrorMessage, armStallTimer, clearStallTimer, refreshPendingApprovals, sessionId],
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

  const approveToolCall = useCallback(async (toolCallId: string, modifiedArgs?: unknown) => {
    const api = apiRef.current;
    if (!api) return;
    await api.invoke<boolean>("tool_approve", {
      toolCallId,
      modifiedArgs: modifiedArgs ?? null,
    });
  }, []);

  const denyToolCall = useCallback(async (toolCallId: string, reason?: string) => {
    const api = apiRef.current;
    if (!api) return;
    await api.invoke<boolean>("tool_deny", {
      toolCallId,
      reason: reason ?? null,
    });
  }, []);

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

  const restoreCheckpoint = useCallback(async (checkpointId: number) => {
    const api = apiRef.current;
    if (!api) return;
    await api.invoke<void>("checkpoint_restore", { checkpointId });
  }, []);

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

function reduce(prev: State, evt: AgentEvent): State {
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
      const selection: RuntimeSelection = {
        runtime: evt.runtime,
        provider: evt.provider,
        model: evt.model,
        reason: evt.reason,
        selectedAt: evt.created_at,
      };
      const label =
        evt.runtime === "pi_sidecar"
          ? "Pi sidecar runtime"
          : evt.runtime === "legacy_loop"
            ? "DIVE legacy loop"
            : evt.runtime;
      const m: SystemMessageData = {
        id: `runtime-${evt.created_at}`,
        kind: "system",
        createdAt: evt.created_at,
        content: `Runtime: ${label} · ${evt.provider}/${evt.model} · ${evt.reason}`,
      };
      return {
        ...prev,
        runtimeSelection: selection,
        messages: mergeMessagesById(prev.messages, [m]),
      };
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
        diffPreview: evt.diff_preview ?? null,
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
      const m: ToolResultMessageData = {
        id: `tr-${evt.call_id}`,
        kind: "tool_result",
        createdAt: Date.now(),
        toolName: toolCall?.toolName ?? "tool",
        success: evt.success,
        summary: evt.summary,
        full: evt.full,
      };
      return { ...prev, messages: [...prev.messages, m] };
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
