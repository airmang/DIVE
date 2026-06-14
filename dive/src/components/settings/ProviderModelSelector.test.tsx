// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import { ProviderModelSelector } from "./ProviderModelSelector";

describe("ProviderModelSelector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => {
    cleanup();
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
});
