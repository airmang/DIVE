// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
      provocationScaffoldMode: "work",
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

  it("keeps terminal regeneration-loop rule cards quarantined from shipped builds", () => {
    render(<TerminalTab />);

    expect(screen.queryByTestId("provocation-card")).toBeNull();
    expect(screen.queryByText("마지막 변경 되돌리기")).toBeNull();
    expect(screen.getAllByTestId("terminal-line")).toHaveLength(3);
  });

  it("does not expose quarantined terminal rule actions by default", () => {
    render(<TerminalTab />);

    expect(screen.queryByText("에러 로그 요약 / 재현 단계 만들기")).toBeNull();
    expect(screen.queryByText("범위 줄이기 / 계획 조정")).toBeNull();
    expect(screen.queryByText("AI 재시도")).toBeNull();
    expect(useChatComposerStore.getState().pending).toBeNull();
    expect(screen.queryByTestId("terminal-provocation-action-status")).toBeNull();
  });

  it("renders bounded Project Command stdout, stderr, exit status, and summary lines", () => {
    useSlideInStore.setState({
      terminalLines: [
        {
          id: "cmd",
          kind: "info",
          text: "$ pnpm test — exit 0 - tests passed (exit 0)",
          timestamp: 10,
        },
        { id: "out", kind: "stdout", text: "stdout: all tests passed", timestamp: 11 },
        { id: "err", kind: "stderr", text: "stderr: warning summary", timestamp: 12 },
      ],
    });

    render(<TerminalTab />);

    const lines = screen.getAllByTestId("terminal-line");
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toContain("pnpm test");
    expect(lines[0].textContent).toContain("exit 0");
    expect(lines[1].textContent).toContain("stdout: all tests passed");
    expect(lines[2].textContent).toContain("stderr: warning summary");
    expect(lines[2].getAttribute("data-kind")).toBe("stderr");
  });

  it("renders bounded Terminal Script output and truncation markers", () => {
    useSlideInStore.setState({
      terminalLines: [
        {
          id: "script",
          kind: "info",
          text: "[Terminal Script] terminal script completed with exit 0 (exit 0) · 출력이 잘렸습니다.",
          timestamp: 20,
        },
        {
          id: "out",
          kind: "stdout",
          text: "stdout: partial output ... [truncated]",
          timestamp: 21,
        },
        { id: "err", kind: "stderr", text: "stderr: warning summary", timestamp: 22 },
      ],
    });

    render(<TerminalTab />);

    const lines = screen.getAllByTestId("terminal-line");
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toContain("Terminal Script");
    expect(lines[0].textContent).toContain("exit 0");
    expect(lines[0].textContent).toContain("출력이 잘렸습니다.");
    expect(lines[1].textContent).toContain("[truncated]");
    expect(lines[2].getAttribute("data-kind")).toBe("stderr");
  });
});
