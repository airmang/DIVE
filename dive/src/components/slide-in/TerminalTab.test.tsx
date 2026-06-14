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
});
