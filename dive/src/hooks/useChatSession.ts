import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantMessageData,
  ChatMessage,
  ErrorMessageData,
  SystemMessageData,
  ToolCallMessageData,
  ToolResultMessageData,
  UserMessageData,
} from "../components/chat/types";

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
  | { type: "assistant_start"; id: string; created_at: number }
  | { type: "assistant_delta"; id: string; delta: string }
  | { type: "assistant_end"; id: string; content: string }
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

type Envelope = AgentEvent & { session_id: number };

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
}

export function useChatSession(sessionId: number) {
  const [state, setState] = useState<State>({
    messages: [],
    isStreaming: false,
    isTauri: false,
    error: null,
  });
  const apiRef = useRef<TauriApi | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const api = await loadTauri();
      if (cancelled) return;
      apiRef.current = api;
      if (!api) {
        setState((s) => ({ ...s, isTauri: false }));
        return;
      }
      setState((s) => ({ ...s, isTauri: true }));
      unsub = await api.listen<Envelope>(`chat://event/${sessionId}`, (e) => {
        setState((prev) => reduce(prev, e.payload));
      });
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [sessionId]);

  const sendUserMessage = useCallback(
    async (text: string, stage?: "d" | "i" | "v" | "e") => {
      const api = apiRef.current;
      if (!api) {
        setState((s) => ({
          ...s,
          error: "Tauri IPC unavailable — run `pnpm tauri:dev`",
        }));
        return;
      }
      setState((s) => ({ ...s, isStreaming: true, error: null }));
      try {
        await api.invoke<void>("chat_send", {
          sessionId,
          text,
          stage: stage ?? null,
        });
      } catch (err) {
        setState((s) => ({
          ...s,
          isStreaming: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [sessionId],
  );

  const cancel = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
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
    ) => {
      const api = apiRef.current;
      if (!api) return null;
      return api.invoke<string>("card_transition", { cardId, transition });
    },
    [],
  );

  return {
    ...state,
    sendUserMessage,
    cancel,
    approveToolCall,
    denyToolCall,
    setCurrentCard,
    updateCardInstruction,
    transitionCardRemote,
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
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === evt.id && m.kind === "assistant"
            ? { ...m, content: evt.content, streaming: false }
            : m,
        ),
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
      return { ...prev, messages: [...prev.messages, m] };
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
      const m: ToolResultMessageData = {
        id: `tr-${evt.call_id}`,
        kind: "tool_result",
        createdAt: Date.now(),
        toolName: "result",
        success: evt.success,
        summary: evt.summary,
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
      return { ...prev, messages: [...prev.messages, m], isStreaming: false };
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
      };
    }
  }
}
