// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { ChatInput } from "./ChatInput";

function renderChatInput() {
  render(<ChatInput onSend={vi.fn()} modelLabel="Test model" />);
}

describe("ChatInput ambiguity hints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useProjectSessionStore.setState({ loaded: true, providers: [] });
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useProjectSessionStore.setState({ loaded: false, providers: [] });
  });

  it("shows a visible Enter-to-send / Shift+Enter hint (P2-02)", () => {
    useLocaleStore.setState({ locale: "en" });
    renderChatInput();
    const hint = screen.getByTestId("chat-input-enter-hint");
    expect(hint.textContent).toContain("Enter to send");
    expect(hint.textContent).toContain("Shift+Enter");
  });

  // S-073: the Enter branch now goes through the shared composerKeys contract;
  // the observable behavior must be exactly what it was before.
  it("sends on plain Enter but not on Shift+Enter or an IME-composing Enter", () => {
    useLocaleStore.setState({ locale: "en" });
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} modelLabel="Test model" />);
    const textarea = screen.getByTestId("chat-input-textarea");

    fireEvent.change(textarea, { target: { value: "first line" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Process", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("first line");
    expect(textarea).toHaveProperty("value", "");
  });

  it("surfaces English vague-input hints under the English locale", () => {
    useLocaleStore.setState({ locale: "en" });
    renderChatInput();

    fireEvent.change(screen.getByTestId("chat-input-textarea"), {
      target: { value: "just make it nice" },
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getAllByTestId("ambiguity-hint").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("ambiguity-hint-list").textContent).toContain(
      "Name the specific thing",
    );
  });

  it("keeps Korean vague-input hints under the Korean locale", () => {
    useLocaleStore.setState({ locale: "ko" });
    renderChatInput();

    fireEvent.change(screen.getByTestId("chat-input-textarea"), {
      target: { value: "고쳐줘" },
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getAllByTestId("ambiguity-hint").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("ambiguity-hint-list").textContent).toContain("고쳐줘");
  });
});
