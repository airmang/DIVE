// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import { useSlideInStore } from "../stores/slideIn";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `converted:${path}`),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  convertFileSrc: tauriMocks.convertFileSrc,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

import {
  reduceChatSessionState,
  useChatSession,
  type AgentEvent,
  type ChatSessionState,
} from "./useChatSession";

function initialState(): ChatSessionState {
  return {
    messages: [],
    isStreaming: false,
    isTauri: true,
    error: null,
    runtimeSelection: null,
    runStartedAt: null,
    cancelRequested: false,
    loadingHistory: false,
  };
}

function runtimeSelected(overrides: Partial<Extract<AgentEvent, { type: "runtime_selected" }>>) {
  return {
    type: "runtime_selected",
    runtime: "pi_sidecar",
    provider: "openai",
    model: "gpt-5.4",
    reason: "provider has Pi parity",
    created_at: 10,
    ...overrides,
  } satisfies Extract<AgentEvent, { type: "runtime_selected" }>;
}

function runtimeCapability(
  overrides: Partial<Extract<AgentEvent, { type: "runtime_capability_evaluated" }>>,
) {
  return {
    type: "runtime_capability_evaluated",
    state: "unavailable",
    providerKind: "opencode_zen",
    model: "zen-test",
    reasonCode: "provider_not_pi_capable",
    message: "Provider opencode_zen does not have confirmed Pi runtime support.",
    setupAction: "choose_supported_provider",
    recordedAt: 12,
    ...overrides,
  } satisfies Extract<AgentEvent, { type: "runtime_capability_evaluated" }>;
}

describe("useChatSession runtime event reducer", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useSlideInStore.setState({
      isOpen: false,
      activeTab: "code",
      changedFiles: [],
      changeSummary: null,
      emptyReason: null,
      selectedFilePath: null,
      previewUrl: null,
      previewSession: null,
      previewRequestContext: null,
      runtimeEvidence: [],
      terminalLines: [],
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    tauriMocks.listeners.clear();
    tauriMocks.convertFileSrc.mockClear();
    tauriMocks.invoke.mockReset();
    tauriMocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "message_list") return [];
      if (cmd === "pending_tool_calls") return [];
      throw new Error(`unexpected invoke: ${cmd}`);
    });
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockImplementation(
      async (event: string, handler: (event: { payload: unknown }) => void) => {
        tauriMocks.listeners.set(event, handler);
        return () => {
          tauriMocks.listeners.delete(event);
        };
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("records pi_sidecar as the supervised ready runtime", () => {
    const next = reduceChatSessionState(initialState(), runtimeSelected({}));

    expect(next.runtimeSelection).toMatchObject({
      state: "ready",
      runtime: "pi_sidecar",
      reasonCode: null,
      setupAction: null,
      message: "This provider can run through DIVE's supervised Pi runtime.",
    });
    const message = next.messages[0];
    expect(message?.kind).toBe("system");
    if (!message || message.kind !== "system") throw new Error("expected system message");
    expect(message.content).toContain("Supervised Pi ready");
    expect(message.content).not.toContain("legacy_loop");
  });

  it("quarantines legacy_loop as an unavailable capability state", () => {
    const next = reduceChatSessionState(
      initialState(),
      runtimeSelected({
        runtime: "legacy_loop",
        reason: "legacy override requested",
      }),
    );

    expect(next.runtimeSelection).toMatchObject({
      state: "unavailable",
      runtime: null,
      reasonCode: "legacy_requested",
      setupAction: "choose_supported_provider",
      message: "A saved old-runtime request is not available for v2 work.",
    });
    const message = next.messages[0];
    expect(message?.kind).toBe("system");
    if (!message || message.kind !== "system") throw new Error("expected system message");
    expect(message.content).toContain("Runtime unavailable");
    expect(message.content).toContain("old-runtime request");
    expect(message.content).not.toContain("legacy_loop");
    expect(message.content).not.toContain("DIVE legacy loop");
  });

  it("treats unknown runtimes as unavailable instead of successful selections", () => {
    const next = reduceChatSessionState(
      initialState(),
      runtimeSelected({
        runtime: "unsupported_runtime",
        reason: "provider lacks supervised runtime support",
      }),
    );

    expect(next.runtimeSelection).toMatchObject({
      state: "unavailable",
      runtime: null,
      reasonCode: "runtime_unavailable",
      setupAction: "retry_runtime",
    });
    const message = next.messages[0];
    expect(message?.kind).toBe("system");
    if (!message || message.kind !== "system") throw new Error("expected system message");
    expect(message.content).toContain("Runtime unavailable");
    expect(message.content).not.toContain("unsupported_runtime");
  });

  it("records backend runtime capability blocks without rendering legacy success", () => {
    const next = reduceChatSessionState(initialState(), runtimeCapability({}));

    expect(next.runtimeSelection).toMatchObject({
      state: "unavailable",
      runtime: null,
      provider: "opencode_zen",
      reasonCode: "provider_not_pi_capable",
      setupAction: "choose_supported_provider",
    });
    const message = next.messages[0];
    expect(message?.kind).toBe("system");
    if (!message || message.kind !== "system") throw new Error("expected system message");
    expect(message.content).toContain("Runtime unavailable");
    expect(message.content).toContain("confirmed Pi runtime support");
    expect(message.content).not.toContain("legacy_loop");
  });

  it("uses localized reason copy for backend runtime capability blocks", () => {
    useLocaleStore.setState({ locale: "ko" });

    const next = reduceChatSessionState(
      initialState(),
      runtimeCapability({
        reasonCode: "missing_credentials",
        message: "Provider credentials are missing or unavailable.",
      }),
    );

    expect(next.runtimeSelection).toMatchObject({
      state: "unavailable",
      reason: "Provider credentials are missing or unavailable.",
      message: "Provider 인증 정보가 없거나 사용할 수 없습니다.",
    });
    const message = next.messages[0];
    expect(message?.kind).toBe("system");
    if (!message || message.kind !== "system") throw new Error("expected system message");
    expect(message.content).toContain("Provider 인증 정보가 없거나 사용할 수 없습니다.");
    expect(message.content).not.toContain("Provider credentials are missing");
  });

  it("closes a pending tool card when a failure result arrives without approval", () => {
    const pending = reduceChatSessionState(initialState(), {
      type: "tool_call_start",
      id: "tool-1",
      tool: "run_process",
      params_preview: "command: powershell.exe",
      risk: "danger",
      args: { command: "powershell.exe" },
    });

    const next = reduceChatSessionState(pending, {
      type: "tool_result",
      call_id: "tool-1",
      success: false,
      summary: "invalid input: shell executable not allowed",
      full: { error: "invalid input: shell executable not allowed" },
    });

    const call = next.messages.find((message) => message.id === "tool-1");
    expect(call?.kind).toBe("tool_call");
    if (!call || call.kind !== "tool_call") throw new Error("expected tool call");
    expect(call.status).toBe("denied");
    expect(call.deniedReason).toBe("invalid input: shell executable not allowed");
  });

  it("groups Project Command result evidence with the direct argv tool call", () => {
    const pending = reduceChatSessionState(initialState(), {
      type: "tool_call_start",
      id: "cmd-1",
      tool: "run_process",
      params_preview: 'command: "pnpm test"',
      risk: "danger",
      args: {
        command: "pnpm",
        args: ["test"],
        timeout_sec: 60,
        reason: "Run the step verification command.",
        expected_effect: "Runs tests without changing project files.",
      },
    });

    const next = reduceChatSessionState(pending, {
      type: "project_command_result",
      toolCallId: "cmd-1",
      commandLabel: "pnpm test",
      executable: "pnpm",
      args: ["test"],
      timeoutSec: 60,
      reason: "Run the step verification command.",
      expectedEffect: "Runs tests without changing project files.",
      status: "completed",
      success: true,
      exitCode: 0,
      summary: "exit 0 - tests passed",
      stdoutSummary: "ok",
      stderrSummary: "",
      createdAt: 50,
    });

    const call = next.messages.find((message) => message.id === "cmd-1");
    expect(call?.kind).toBe("tool_call");
    if (!call || call.kind !== "tool_call") throw new Error("expected tool call");
    expect(call.status).toBe("approved");
    expect(call.executionEvidence).toMatchObject({
      source: "project_command",
      status: "passed",
      summary: "exit 0 - tests passed",
      stdoutSummary: "ok",
      stderrSummary: "",
      exitCode: 0,
    });

    const result = next.messages.find((message) => message.id === "tr-cmd-1");
    expect(result?.kind).toBe("tool_result");
    if (!result || result.kind !== "tool_result") throw new Error("expected tool result");
    expect(result.runtimeAction).toBe("project_command");
    expect(result.executionEvidence?.status).toBe("passed");
    expect(result.full).toMatchObject({
      commandLabel: "pnpm test",
      executable: "pnpm",
      timeoutSec: 60,
    });
  });

  it("keeps preview shell workaround reroutes as no-command-ran tool states", () => {
    const pending = reduceChatSessionState(initialState(), {
      type: "tool_call_start",
      id: "preview-open-1",
      tool: "run_process",
      params_preview: 'command: "open index.html"',
      risk: "danger",
      args: { command: "open", args: ["index.html"] },
    });

    const routed = reduceChatSessionState(pending, {
      type: "runtime_routing_decision",
      decisionId: "route-1",
      toolCallId: "preview-open-1",
      inputKind: "project_command",
      outcome: "rerouted",
      reasonCode: "preview_open_shell_workaround",
      evidenceRefs: [{ previewTarget: "index.html", commandRan: false }],
      message: "DIVE did not run the command. Use Preview for this local result.",
      createdAt: 40,
    });

    const next = reduceChatSessionState(routed, {
      type: "project_command_result",
      toolCallId: "preview-open-1",
      commandLabel: "open index.html",
      executable: "open",
      args: ["index.html"],
      timeoutSec: 30,
      status: "blocked",
      success: false,
      exitCode: null,
      summary: "DIVE did not run the command. Use Preview for this local result.",
      stdoutSummary: "",
      stderrSummary: "",
      createdAt: 41,
    });

    const call = next.messages.find((message) => message.id === "preview-open-1");
    expect(call?.kind).toBe("tool_call");
    if (!call || call.kind !== "tool_call") throw new Error("expected tool call");
    expect(call.status).toBe("rerouted");
    expect(call.routingDecision).toMatchObject({
      outcome: "rerouted",
      reasonCode: "preview_open_shell_workaround",
    });
    expect(call.deniedReason).toContain("DIVE did not run");
    expect(call.executionEvidence).toMatchObject({
      source: "project_command",
      status: "blocked",
      summary: "DIVE did not run the command. Use Preview for this local result.",
    });
  });

  it("closes stale approvals with no-command-ran copy", () => {
    const pending = reduceChatSessionState(initialState(), {
      type: "tool_call_start",
      id: "stale-1",
      tool: "run_process",
      params_preview: 'command: "pnpm test"',
      risk: "danger",
      args: { command: "pnpm", args: ["test"] },
    });

    const next = reduceChatSessionState(pending, {
      type: "tool_approval_stale",
      toolCallId: "stale-1",
      sessionId: 1,
      detectedBy: "approval_click",
      message: "This approval request is no longer active. DIVE did not run the command.",
      resolvedAt: 55,
    });

    const call = next.messages.find((message) => message.id === "stale-1");
    expect(call?.kind).toBe("tool_call");
    if (!call || call.kind !== "tool_call") throw new Error("expected tool call");
    expect(call.status).toBe("stale");
    expect(call.deniedReason).toContain("did not run");
    expect(
      next.messages.some((message) => message.kind === "error" && message.id.startsWith("stale-")),
    ).toBe(true);
  });

  it("uses static preview URLs before falling back to asset conversion", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "preview_open_result",
            requestId: "preview-1",
            status: "ready",
            previewUrl: "http://127.0.0.1:49152/index.html",
            assetFilePath: "/project/index.html",
            targetLabel: "index.html",
            reasonCode: null,
            message: "Preview opened.",
            resolvedAt: 123,
          } satisfies Extract<AgentEvent, { type: "preview_open_result" }>,
        },
      });
    });

    await waitFor(() =>
      expect(useSlideInStore.getState().previewSession?.previewUrl).toBe(
        "http://127.0.0.1:49152/index.html",
      ),
    );
    expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
    expect(useSlideInStore.getState().previewSession).toMatchObject({
      assetFilePath: "/project/index.html",
      targetLabel: "index.html",
      status: "ready",
    });
    expect(useSlideInStore.getState().previewUrl).toBe("http://127.0.0.1:49152/index.html");
    expect(useSlideInStore.getState().previewUrl).not.toBe("asset://project/index.html");
    expect(useSlideInStore.getState().activeTab).toBe("preview");
  });

  it("uses Pi progress events as liveness without adding chat messages", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    vi.useFakeTimers();

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "assistant_start",
            id: "assistant-1",
            created_at: 100,
          } satisfies Extract<AgentEvent, { type: "assistant_start" }>,
        },
      });
    });

    act(() => {
      vi.advanceTimersByTime(44_000);
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "agent_progress",
            kind: "heartbeat",
            message: "Pi runtime heartbeat received.",
            created_at: 101,
          } satisfies Extract<AgentEvent, { type: "agent_progress" }>,
        },
      });
    });

    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);
    expect(result.current.messages).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(44_000);
    });
    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.messages.some((message) => message.kind === "error")).toBe(true);
  });

  it("does not surface an error card for a straggler after done (S-052 D1)", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    vi.useFakeTimers();

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "assistant_start",
            id: "assistant-1",
            created_at: 100,
          } satisfies Extract<AgentEvent, { type: "assistant_start" }>,
        },
      });
    });
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: { type: "done", reason: "completed" } satisfies Extract<
            AgentEvent,
            { type: "done" }
          >,
        },
      });
    });

    expect(result.current.isStreaming).toBe(false);

    act(() => {
      vi.advanceTimersByTime(45_001);
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "agent_progress",
            kind: "heartbeat",
            message: "Pi runtime heartbeat received.",
            created_at: 200,
          } satisfies Extract<AgentEvent, { type: "agent_progress" }>,
        },
      });
    });

    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);
    expect(result.current.isStreaming).toBe(false);
  });

  it("stays free of error cards across two stragglers 45s+ apart after done (S-052 D1)", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    vi.useFakeTimers();

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "assistant_start",
            id: "assistant-1",
            created_at: 100,
          } satisfies Extract<AgentEvent, { type: "assistant_start" }>,
        },
      });
    });
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: { type: "done", reason: "completed" } satisfies Extract<
            AgentEvent,
            { type: "done" }
          >,
        },
      });
    });

    act(() => {
      vi.advanceTimersByTime(45_001);
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "tool_result",
            call_id: "stale-tool",
            success: true,
            summary: "late straggler result",
            full: {},
          } satisfies Extract<AgentEvent, { type: "tool_result" }>,
        },
      });
    });
    act(() => {
      vi.advanceTimersByTime(45_001);
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "agent_progress",
            kind: "heartbeat",
            message: "Pi runtime heartbeat received.",
            created_at: 300,
          } satisfies Extract<AgentEvent, { type: "agent_progress" }>,
        },
      });
    });

    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);
  });

  it("fires exactly one stall card for 45s of true silence mid-run (S-052 D1)", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    vi.useFakeTimers();

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "assistant_start",
            id: "assistant-1",
            created_at: 100,
          } satisfies Extract<AgentEvent, { type: "assistant_start" }>,
        },
      });
    });

    // Two heartbeats keep the run alive without ever clearing it to done.
    act(() => {
      vi.advanceTimersByTime(30_000);
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "agent_progress",
            kind: "heartbeat",
            message: "Pi runtime heartbeat received.",
            created_at: 101,
          } satisfies Extract<AgentEvent, { type: "agent_progress" }>,
        },
      });
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "agent_progress",
            kind: "heartbeat",
            message: "Pi runtime heartbeat received.",
            created_at: 102,
          } satisfies Extract<AgentEvent, { type: "agent_progress" }>,
        },
      });
    });

    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(45_001);
    });

    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(1);
  });

  it("resets the latch for a new run and dedupes a repeat fire within the same run (S-052 D1/D3)", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    vi.useFakeTimers();

    // Run 1: starts and ends cleanly.
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "assistant_start",
            id: "assistant-1",
            created_at: 100,
          } satisfies Extract<AgentEvent, { type: "assistant_start" }>,
        },
      });
    });
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: { type: "done", reason: "completed" } satisfies Extract<
            AgentEvent,
            { type: "done" }
          >,
        },
      });
    });

    // Run 2 begins after the latch — a backend-initiated turn with no sendUserMessage.
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "assistant_start",
            id: "assistant-2",
            created_at: 200,
          } satisfies Extract<AgentEvent, { type: "assistant_start" }>,
        },
      });
    });

    act(() => {
      vi.advanceTimersByTime(45_001);
    });

    const firstFireErrors = result.current.messages.filter((message) => message.kind === "error");
    expect(firstFireErrors).toHaveLength(1);
    expect(firstFireErrors[0]?.id).toBe("stall-2");

    // Another straggler in the same (still non-terminal) run re-arms the timer; a
    // second fire must dedupe onto the same stable id, not add a second card.
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "agent_progress",
            kind: "heartbeat",
            message: "Pi runtime heartbeat received.",
            created_at: 201,
          } satisfies Extract<AgentEvent, { type: "agent_progress" }>,
        },
      });
    });
    act(() => {
      vi.advanceTimersByTime(45_001);
    });

    const secondFireErrors = result.current.messages.filter((message) => message.kind === "error");
    expect(secondFireErrors).toHaveLength(1);
    expect(secondFireErrors[0]?.id).toBe("stall-2");
  });

  it("leaves isStreaming false when agent_progress arrives after done (S-052 D2)", () => {
    const doneState = reduceChatSessionState(initialState(), {
      type: "done",
      reason: "completed",
    });
    expect(doneState.isStreaming).toBe(false);

    const next = reduceChatSessionState(
      doneState,
      {
        type: "agent_progress",
        kind: "heartbeat",
        message: "Pi runtime heartbeat received.",
        created_at: 999,
      },
      /* runTerminal */ true,
    );

    expect(next.isStreaming).toBe(false);
    expect(next).toBe(doneState);
  });

  it("clears the stall timer on tool_call_denied and tool_call_blocked (S-052 D1)", async () => {
    const { result } = renderHook(() => useChatSession(42));

    await waitFor(() => expect(result.current.loadingHistory).toBe(false));
    const handler = tauriMocks.listeners.get("chat://event/42");
    if (!handler) throw new Error("expected chat event listener");

    vi.useFakeTimers();

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "tool_call_start",
            id: "tool-1",
            tool: "run_process",
            params_preview: "command: pnpm test",
            risk: "danger",
            args: { command: "pnpm", args: ["test"] },
          } satisfies Extract<AgentEvent, { type: "tool_call_start" }>,
        },
      });
    });
    // Arms the timer, so tool_call_denied clearing it below is a real assertion.
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "reasoning",
            id: "reason-1",
            text: "considering the request",
            tool_call_id: "tool-1",
            created_at: 100,
          } satisfies Extract<AgentEvent, { type: "reasoning" }>,
        },
      });
    });
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "tool_call_denied",
            id: "tool-1",
            reason: "user declined",
          } satisfies Extract<AgentEvent, { type: "tool_call_denied" }>,
        },
      });
    });

    act(() => {
      vi.advanceTimersByTime(45_001);
    });
    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);

    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "tool_call_start",
            id: "tool-2",
            tool: "run_process",
            params_preview: "command: rm -rf /",
            risk: "danger",
            args: { command: "rm", args: ["-rf", "/"] },
          } satisfies Extract<AgentEvent, { type: "tool_call_start" }>,
        },
      });
    });
    // Arms the timer again, so tool_call_blocked clearing it below is a real assertion.
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "reasoning",
            id: "reason-2",
            text: "considering the request",
            tool_call_id: "tool-2",
            created_at: 200,
          } satisfies Extract<AgentEvent, { type: "reasoning" }>,
        },
      });
    });
    act(() => {
      handler({
        payload: {
          session_id: 42,
          event: {
            type: "tool_call_blocked",
            id: "tool-2",
            reason: { rule: "no-rm-rf", pattern: "rm -rf /" },
          } satisfies Extract<AgentEvent, { type: "tool_call_blocked" }>,
        },
      });
    });

    act(() => {
      vi.advanceTimersByTime(45_001);
    });
    expect(result.current.messages.filter((message) => message.kind === "error")).toHaveLength(0);
  });
});
