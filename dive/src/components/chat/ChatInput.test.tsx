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
    // Shift+Enter keeps its default (the newline): dispatchEvent returns true
    // only when nothing called preventDefault.
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(true);
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    // Legacy IME placeholder: the key IS "Enter"; only keyCode says composing.
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
    expect(onSend).toHaveBeenCalledWith("first line");
    expect(textarea).toHaveProperty("value", "");
  });

  it("opens the pre-send check on Ctrl/Cmd+Shift+Enter instead of sending", () => {
    useLocaleStore.setState({ locale: "en" });
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        modelLabel="Test model"
        promptCheckMock={{ issues: [], refined_text: "checked", approximate_tokens: 1 }}
      />,
    );
    const textarea = screen.getByTestId("chat-input-textarea");

    // Nothing to check yet: neither opens nor sends, and the default stands.
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, ctrlKey: true })).toBe(true);
    expect(screen.queryByTestId("prompt-check-dialog")).toBeNull();

    fireEvent.change(textarea, { target: { value: "make the list sortable" } });
    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, metaKey: true })).toBe(
      false,
    );

    expect(screen.getByTestId("prompt-check-dialog")).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveProperty("value", "make the list sortable");
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
