import { describe, expect, it } from "vitest";
import { reduceChatSessionState, type ChatSessionState } from "./chat-session-reducer";

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

describe("reduceChatSessionState assistant stream reattach", () => {
  it("appends deltas onto the placeholder created by assistant_start", () => {
    let state = initialState();
    state = reduceChatSessionState(state, { type: "assistant_start", id: "a1", created_at: 1 });
    state = reduceChatSessionState(state, { type: "assistant_delta", id: "a1", delta: "Hel" });
    state = reduceChatSessionState(state, { type: "assistant_delta", id: "a1", delta: "lo" });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "a1",
      kind: "assistant",
      content: "Hello",
      streaming: true,
    });
  });

  it("upserts a placeholder for an unmatched assistant_delta instead of dropping it", () => {
    // Simulates reattaching to a session while an assistant turn is still
    // streaming: assistant_start fired before this reducer instance existed, so
    // there is no placeholder message for the incoming delta.
    const state = reduceChatSessionState(initialState(), {
      type: "assistant_delta",
      id: "a1",
      delta: "Hello",
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "a1",
      kind: "assistant",
      content: "Hello",
      streaming: true,
    });
  });

  it("upserts a placeholder for an unmatched assistant_end and marks it complete", () => {
    const state = reduceChatSessionState(initialState(), {
      type: "assistant_end",
      id: "a1",
      content: "Hello, world!",
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "a1",
      kind: "assistant",
      content: "Hello, world!",
      streaming: false,
    });
    expect(state.isStreaming).toBe(false);
  });

  it("finalizes an existing streaming placeholder on assistant_end without duplicating it", () => {
    let state = initialState();
    state = reduceChatSessionState(state, { type: "assistant_start", id: "a1", created_at: 1 });
    state = reduceChatSessionState(state, { type: "assistant_delta", id: "a1", delta: "partial" });
    state = reduceChatSessionState(state, {
      type: "assistant_end",
      id: "a1",
      content: "final answer",
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "a1",
      kind: "assistant",
      content: "final answer",
      streaming: false,
    });
  });

  it("reconstructs the full in-flight response across a reattach: delta then end for the same unmatched id", () => {
    // Mirrors the real reattach path: the reducer is fresh (no assistant_start
    // ever seen by this instance) and receives the buffered/live events that
    // arrive after the hook remounts mid-turn.
    let state = initialState();
    state = reduceChatSessionState(state, { type: "assistant_delta", id: "a1", delta: "Hel" });
    state = reduceChatSessionState(state, { type: "assistant_end", id: "a1", content: "Hello!" });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "a1",
      kind: "assistant",
      content: "Hello!",
      streaming: false,
    });
  });
});

describe("reduceChatSessionState cancelRequested", () => {
  it("keeps a pending cancelRequested through agent_progress instead of wiping it", () => {
    let state = { ...initialState(), isStreaming: true, cancelRequested: true };
    state = reduceChatSessionState(state, {
      type: "agent_progress",
      kind: "heartbeat",
      message: "still working",
      created_at: 1,
    });

    expect(state.cancelRequested).toBe(true);
  });

  it("keeps a pending cancelRequested through tool_call_start instead of wiping it", () => {
    let state = { ...initialState(), isStreaming: true, cancelRequested: true };
    state = reduceChatSessionState(state, {
      type: "tool_call_start",
      id: "tc1",
      tool: "read_file",
      params_preview: "path: file.ts",
      risk: "safe",
      args: { path: "file.ts" },
    });

    expect(state.cancelRequested).toBe(true);
  });

  it("still clears cancelRequested on terminal events (assistant_end/error/done)", () => {
    let state = { ...initialState(), isStreaming: true, cancelRequested: true };
    state = reduceChatSessionState(state, {
      type: "assistant_end",
      id: "a1",
      content: "done",
    });

    expect(state.cancelRequested).toBe(false);
  });
});
