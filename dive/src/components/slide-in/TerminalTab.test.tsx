// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import { useSlideInStore } from "../../stores/slideIn";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { TerminalTab } from "./TerminalTab";

function seedRepeatedTerminalError() {
  useSlideInStore.setState({
    terminalLines: [
      { id: "e1", kind: "stderr", text: "TypeError: x is undefined", timestamp: 1 },
      { id: "e2", kind: "stderr", text: "TypeError: x is undefined", timestamp: 2 },
      { id: "e3", kind: "stderr", text: "TypeError: x is undefined", timestamp: 3 },
    ],
  });
}

describe("TerminalTab review-card actions", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useLocaleStore.setState({ locale: "ko" });
    useUiPreferencesStore.setState({
      enableProvocationCards: true,
      provocationScaffoldMode: "standard",
    });
    useChatComposerStore.setState({ pending: null });
    seedRepeatedTerminalError();
  });

  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "ko" });
    useSlideInStore.setState({ terminalLines: [] });
    useChatComposerStore.setState({ pending: null });
  });

  it("renders a terminal regeneration-loop card with rollback explicitly unavailable", () => {
    render(<TerminalTab />);

    expect(screen.getByTestId("provocation-card").dataset.cardType).toBe("regeneration_loop");
    const rollbackButton = screen.getByText("마지막 변경 되돌리기").closest("button");
    expect(rollbackButton).not.toBeNull();
    expect((rollbackButton as HTMLButtonElement).disabled).toBe(true);
    expect(rollbackButton?.textContent).toContain("복구 경로 없음");
  });

  it("seeds repro, scope, and recovery-first retry requests from terminal actions", () => {
    render(<TerminalTab />);

    fireEvent.click(screen.getByText("에러 로그 요약 / 재현 단계 만들기"));
    expect(useChatComposerStore.getState().pending?.seed).toContain("재현 단계");
    expect(screen.getByTestId("terminal-provocation-action-status").textContent).toContain(
      "재현 단계",
    );

    fireEvent.click(screen.getByText("범위 줄이기 / 계획 조정"));
    expect(useChatComposerStore.getState().pending?.seed).toContain("작은 범위");
    expect(screen.getByTestId("terminal-provocation-action-status").textContent).toContain(
      "범위 축소",
    );

    fireEvent.click(screen.getByText("AI 재시도"));
    expect(useChatComposerStore.getState().pending?.seed).toContain("복구 지점");
    expect(screen.getByTestId("terminal-provocation-action-status").textContent).toContain(
      "recovery-first",
    );
  });
});
