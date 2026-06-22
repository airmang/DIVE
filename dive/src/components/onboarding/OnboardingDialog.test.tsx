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
    expect(opencode.textContent).toContain("확인된 Pi 런타임 지원이 없습니다");
    expect(opencode.dataset.selected).toBe("false");

    fireEvent.click(opencode);
    expect(opencode.dataset.selected).toBe("false");
    expect(connect.disabled).toBe(false);
    expect(useProjectSessionStore.getState().connectProvider).not.toHaveBeenCalled();
  });
});
