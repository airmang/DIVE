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

  it("does not show quarantined AI self-report rule cards in the chat stream by default", () => {
    render(
      <MessageList
        messages={completionMessages}
        provocation={{
          enabled: true,
          mode: "work",
          sessionId: 1,
        }}
      />,
    );

    expect(screen.queryByText("AI의 완료 보고만 있습니다")).toBeNull();
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("keeps the chat stream free of AI self-report rule cards when suppressed", () => {
    render(
      <MessageList
        messages={completionMessages}
        provocation={{
          enabled: true,
          mode: "work",
          sessionId: 1,
          suppressAiSelfReportOnly: true,
        }}
      />,
    );

    expect(screen.queryByText("AI의 완료 보고만 있습니다")).toBeNull();
  });
});
