// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { ProviderModelSelector } from "./ProviderModelSelector";

const { LONG_CATALOG } = vi.hoisted(() => ({
  LONG_CATALOG: [
    { id: "anthropic/claude-sonnet-5", display_name: "Anthropic - Claude Sonnet 5" },
    { id: "openai/gpt-5.4", display_name: "OpenAI - GPT-5.4" },
    { id: "openai/gpt-5.4-mini", display_name: "OpenAI - GPT-5.4 Mini" },
    { id: "google/gemini-3", display_name: "Google - Gemini 3" },
    { id: "deepseek/deepseek-v4", display_name: "DeepSeek V4" },
    { id: "moonshotai/kimi-k2", display_name: "MoonshotAI - Kimi K2" },
    { id: "meta/llama-4", display_name: "Meta - Llama 4" },
    { id: "mistral/large-3", display_name: "Mistral - Large 3" },
    { id: "qwen/qwen-3", display_name: "Qwen 3" },
    { id: "x-ai/grok-5", display_name: "xAI - Grok 5" },
  ],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => (cmd === "provider_list_models" ? LONG_CATALOG : undefined),
}));

describe("ProviderModelSelector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    useLocaleStore.setState({ locale: "ko" });
  });

  it("uses localized model copy and keeps the select constrained", async () => {
    render(
      <ProviderModelSelector
        providerId={1}
        providerKind="openrouter"
        selectedModel="openai/gpt-5.4-mini"
      />,
    );

    expect(screen.getByText("Loading models…")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByLabelText("Select provider model")).toBeTruthy();
    });

    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.queryByText("모델")).toBeNull();
    expect(screen.getByTestId("provider-model-selector").className).toContain(
      "grid-cols-[minmax(3.5rem,auto)_minmax(0,1fr)]",
    );
    expect(screen.getByTestId("provider-model-select").className).toContain("w-full");
  });

  it("shows a search filter for long live catalogs and narrows the options", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    render(
      <ProviderModelSelector
        providerId={1}
        providerKind="openrouter"
        selectedModel="moonshotai/kimi-k2"
      />,
    );

    // The 10-item live catalog crosses the threshold, so the filter appears.
    const filter = await screen.findByTestId("provider-model-filter");
    expect(screen.getByText("Meta - Llama 4")).toBeTruthy();

    fireEvent.change(filter, { target: { value: "kimi" } });

    await waitFor(() => {
      expect(screen.queryByText("Meta - Llama 4")).toBeNull();
    });
    expect(screen.getByText("MoonshotAI - Kimi K2")).toBeTruthy();
  });
});
