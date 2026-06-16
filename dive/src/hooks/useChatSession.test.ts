// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../i18n";
import {
  reduceChatSessionState,
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
});
