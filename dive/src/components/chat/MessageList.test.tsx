// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./types";
import { MessageList } from "./MessageList";

const completionMessages: ChatMessage[] = [
  {
    id: "assistant-1",
    kind: "assistant",
    createdAt: 1,
    content: "완료했습니다. 요구한 기능을 구현했습니다.",
    streaming: false,
  },
];

describe("MessageList supervision cards", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it("shows the AI self-report card while completion has no verification context", () => {
    render(
      <MessageList
        messages={completionMessages}
        provocation={{
          enabled: true,
          mode: "standard",
          sessionId: 1,
        }}
      />,
    );

    expect(screen.getByText("AI의 완료 보고만 있습니다")).toBeTruthy();
  });

  it("hides the AI self-report card once the active step is already approved", () => {
    render(
      <MessageList
        messages={completionMessages}
        provocation={{
          enabled: true,
          mode: "standard",
          sessionId: 1,
          suppressAiSelfReportOnly: true,
        }}
      />,
    );

    expect(screen.queryByText("AI의 완료 보고만 있습니다")).toBeNull();
  });
});
