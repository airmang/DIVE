// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { RuntimeSelection } from "../../hooks/useChatSession";
import { RuntimeBadge } from "./RuntimeBadge";

function runtimeSelection(overrides: Partial<RuntimeSelection> = {}): RuntimeSelection {
  return {
    state: "ready",
    runtime: "pi_sidecar",
    provider: "openai",
    model: "gpt-5.4",
    reason: "provider has Pi parity",
    reasonCode: null,
    message: "This provider can run through DIVE's supervised Pi runtime.",
    setupAction: null,
    selectedAt: 1,
    ...overrides,
  };
}

describe("RuntimeBadge runtime capability states", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => cleanup());

  it("shows supervised Pi readiness for the successful v2 runtime", () => {
    render(<RuntimeBadge selection={runtimeSelection()} />);

    expect(screen.getByTestId("runtime-badge").textContent).toContain("Supervised");
    expect(screen.getByTestId("runtime-selected-label").textContent).toBe("Supervised Pi ready");
    expect(screen.getByTestId("runtime-badge").getAttribute("title")).toBe(
      "This response is running through Supervised Pi ready. Provider: openai, model: gpt-5.4. Reason: provider has Pi parity",
    );
    expect(screen.queryByText("Legacy loop")).toBeNull();
  });

  it("renders old runtime requests as an explicit unavailable state", () => {
    render(
      <RuntimeBadge
        selection={runtimeSelection({
          state: "unavailable",
          runtime: null,
          reason: "legacy override requested",
          reasonCode: "legacy_requested",
          message: "A saved old-runtime request is not available for v2 work.",
          setupAction: "choose_supported_provider",
        })}
      />,
    );

    const badge = screen.getByTestId("runtime-badge");
    expect(screen.getByTestId("runtime-selected-label").textContent).toBe("Runtime unavailable");
    expect(badge.getAttribute("title")).toBe(
      "A saved old-runtime request is not available for v2 work. Provider: openai, model: gpt-5.4.",
    );
    expect(badge.textContent).not.toContain("Legacy loop");
  });
});
