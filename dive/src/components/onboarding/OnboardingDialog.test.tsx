// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { OnboardingDialog } from "./OnboardingDialog";

describe("OnboardingDialog provider setup", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({
      loaded: true,
      providers: [],
      projects: [],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      error: null,
      connectProvider: vi.fn(),
      loadAll: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("marks opencode zen unavailable before credential setup", () => {
    render(<OnboardingDialog open onOpenChange={vi.fn()} />);

    const opencode = screen.getByTestId("onb-kind-opencode_zen") as HTMLButtonElement;
    const connect = screen.getByTestId("onb-connect") as HTMLButtonElement;

    expect(opencode.disabled).toBe(true);
    expect(opencode.dataset.unavailable).toBe("true");
    // S-045 (P2-21): beginner-facing reason, not the internal "Pi 런타임" jargon.
    expect(opencode.textContent).toContain("DIVE에서 아직 쓸 수 없어요");
    expect(opencode.textContent).not.toContain("Pi 런타임");
    expect(opencode.dataset.selected).toBe("false");

    fireEvent.click(opencode);
    expect(opencode.dataset.selected).toBe("false");
    expect(connect.disabled).toBe(false);
    expect(useProjectSessionStore.getState().connectProvider).not.toHaveBeenCalled();
  });

  it("glosses the API key with a plain-Korean helper + storage reassurance (P1-04)", () => {
    render(<OnboardingDialog open onOpenChange={vi.fn()} />);

    const help = screen.getByTestId("onb-api-key-help");
    expect(help.textContent).toContain("API 키 = AI 회사에서");
    expect(help.textContent).toContain("이 컴퓨터에만");
  });
});
