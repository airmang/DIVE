// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { ProviderModelSelector } from "./ProviderModelSelector";
import type { ModelInfo } from "./providerModels";

const { LONG_CATALOG, catalogRef } = vi.hoisted(() => {
  const LONG_CATALOG = [
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
  ];
  // Mutable so individual tests can swap in a catalog carrying pi_executable
  // annotations without re-mocking the module (S-051 P2).
  return { LONG_CATALOG, catalogRef: { current: LONG_CATALOG as unknown[] } };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => (cmd === "provider_list_models" ? catalogRef.current : undefined),
}));

describe("ProviderModelSelector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
    catalogRef.current = LONG_CATALOG;
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

  // S-051 P2 D2.1: three pi_executable cases — annotated, all-null, and the
  // beginner-default hint for an unsupported selected model.
  it("groups Pi-verified models first and marks unsupported ones when annotation data is present", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const catalog: ModelInfo[] = [
      {
        id: "anthropic/claude-sonnet-4-6",
        display_name: "Anthropic - Claude Sonnet 4.6",
        pi_executable: true,
      },
      {
        id: "anthropic/claude-sonnet-5",
        display_name: "Anthropic - Claude Sonnet 5",
        pi_executable: false,
      },
      { id: "openai/gpt-5.4", display_name: "OpenAI - GPT-5.4", pi_executable: null },
    ];
    catalogRef.current = catalog;

    const { container } = render(
      <ProviderModelSelector
        providerId={1}
        providerKind="openrouter"
        selectedModel="anthropic/claude-sonnet-4-6"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Select provider model")).toBeTruthy();
    });

    const optgroups = container.querySelectorAll("optgroup");
    expect(optgroups.length).toBe(2);
    expect(optgroups[0].getAttribute("label")).toBe("Pi verified");
    expect(optgroups[1].getAttribute("label")).toBe("Full catalog");

    // The executable model is promoted into the recommended group...
    expect(optgroups[0].querySelector('option[value="anthropic/claude-sonnet-4-6"]')).toBeTruthy();
    // ...unsupported models stay listed (never hidden) but get the marker...
    const unsupportedOption = optgroups[1].querySelector(
      'option[value="anthropic/claude-sonnet-5"]',
    );
    expect(unsupportedOption?.textContent).toBe("Anthropic - Claude Sonnet 5 (Pi unsupported)");
    // ...and null/unknown models stay unmarked (fail open).
    const unknownOption = optgroups[1].querySelector('option[value="openai/gpt-5.4"]');
    expect(unknownOption?.textContent).toBe("OpenAI - GPT-5.4");
  });

  it("renders a flat unmarked list when no model in the catalog carries executability data", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    const { container } = render(
      <ProviderModelSelector
        providerId={1}
        providerKind="openrouter"
        selectedModel="openai/gpt-5.4-mini"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Select provider model")).toBeTruthy();
    });

    expect(container.querySelectorAll("optgroup").length).toBe(0);
    expect(screen.queryByTestId("provider-model-unsupported-hint")).toBeNull();
  });

  it("shows the beginner switch hint when the selected model is marked Pi-unsupported", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    catalogRef.current = [
      {
        id: "anthropic/claude-sonnet-4-6",
        display_name: "Anthropic - Claude Sonnet 4.6",
        pi_executable: true,
      },
      {
        id: "anthropic/claude-sonnet-5",
        display_name: "Anthropic - Claude Sonnet 5",
        pi_executable: false,
      },
    ] satisfies ModelInfo[];

    render(
      <ProviderModelSelector
        providerId={1}
        providerKind="openrouter"
        selectedModel="anthropic/claude-sonnet-5"
      />,
    );

    const hint = await screen.findByTestId("provider-model-unsupported-hint");
    expect(hint.textContent).toBe(
      "This model can't run supervised. Try Anthropic - Claude Sonnet 4.6 instead.",
    );
  });
});
