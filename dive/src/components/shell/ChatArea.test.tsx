// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import type { ChatMessage } from "../chat/types";
import { ChatArea } from "./ChatArea";

const messages: ChatMessage[] = [
  {
    id: "u1",
    kind: "user",
    createdAt: 1,
    content: "Start the first planned step",
  },
  {
    id: "a1",
    kind: "assistant",
    createdAt: 2,
    content: "I will work from the approved plan.",
    streaming: false,
  },
];

describe("ChatArea PRD surface", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useChatComposerStore.setState({ pending: null });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it("keeps messages and composer available when the PRD is a collapsed reference", () => {
    render(
      <ChatArea
        messages={messages}
        onSendMessage={vi.fn()}
        prdSurface={<div data-testid="prd-reference-body">Saved PRD</div>}
        prdSurfaceMode="reference"
      />,
    );

    expect(screen.getByTestId("prd-reference-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("prd-reference-body")).toBeNull();
    expect(screen.getByTestId("message-list")).toBeTruthy();
    expect(screen.getByText("Start the first planned step")).toBeTruthy();
    expect(screen.getByTestId("chat-input-textarea")).not.toHaveProperty("disabled", true);

    fireEvent.click(screen.getByTestId("prd-reference-toggle"));

    expect(screen.getByTestId("prd-reference-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("prd-reference-body")).toBeTruthy();
    expect(screen.getByTestId("message-list")).toBeTruthy();
    expect(screen.getByTestId("chat-input-textarea")).toBeTruthy();
  });

  it("keeps plan draft approval ahead of PRD reference content", () => {
    render(
      <ChatArea
        messages={messages}
        onSendMessage={vi.fn()}
        prdSurface={<div data-testid="prd-reference-body">Saved PRD</div>}
        prdSurfaceMode="reference"
        planDraftApproval={<div data-testid="plan-draft-review">Review plan</div>}
      />,
    );

    expect(screen.getByTestId("plan-draft-review")).toBeTruthy();
    expect(screen.queryByTestId("prd-reference-toggle")).toBeNull();
    expect(screen.queryByTestId("message-list")).toBeNull();
    expect(screen.getByTestId("chat-input-textarea")).toBeTruthy();
  });

  it("shows the honest session-starting copy for an active, empty, non-loading session (S-056 D1)", () => {
    render(
      <ChatArea
        messages={[]}
        messagesLoading={false}
        onSendMessage={vi.fn()}
        emptyState={{
          title: "Session started",
          description: "No messages yet — send your first message below to get going.",
        }}
      />,
    );

    expect(screen.getByText("Session started")).toBeTruthy();
    expect(
      screen.getByText("No messages yet — send your first message below to get going."),
    ).toBeTruthy();
    // No CTA (the composer is the call to action) and no misleading
    // "click + New session" nudge, since a session already exists.
    expect(screen.queryByTestId("chat-empty-cta")).toBeNull();
    expect(screen.queryByTestId("learning-hint")).toBeNull();
    expect(screen.getByTestId("chat-input-textarea")).toBeTruthy();
  });

  it("keeps showing the history skeleton while loading even when session-starting emptyState is present", () => {
    render(
      <ChatArea
        messages={[]}
        messagesLoading={true}
        onSendMessage={vi.fn()}
        emptyState={{
          title: "Session started",
          description: "No messages yet — send your first message below to get going.",
        }}
      />,
    );

    expect(screen.getByTestId("chat-history-skeleton")).toBeTruthy();
    expect(screen.queryByText("Session started")).toBeNull();
  });

  it("keeps the legacy no-session fallback (with CTA, no misleading hint) unchanged", () => {
    const onAction = vi.fn();
    render(
      <ChatArea
        messages={[]}
        messagesLoading={false}
        onSendMessage={vi.fn()}
        emptyState={{
          title: "Start a work session",
          description: "Describe a goal so DIVE can draft a plan and roadmap.",
          actionLabel: "New session",
          onAction,
        }}
      />,
    );

    expect(screen.getByTestId("chat-empty-cta")).toBeTruthy();
    expect(screen.queryByTestId("learning-hint")).toBeNull();
  });

  it("shows the generic sidebar hint only for the true unhandled empty state (no emptyState prop)", () => {
    render(<ChatArea messages={[]} messagesLoading={false} onSendMessage={vi.fn()} />);

    expect(screen.getByText("Start a session to begin chatting")).toBeTruthy();
    expect(screen.getByTestId("learning-hint")).toBeTruthy();
  });

  it("inserts a suggested step prompt without sending until the user submits", () => {
    const onSendMessage = vi.fn();
    render(
      <ChatArea
        messages={messages}
        onSendMessage={onSendMessage}
        composerHint={{
          message: "A suggested prompt for this step is ready.",
          actionLabel: "Insert prompt",
          onAction: () => useChatComposerStore.getState().pushSeed("Run this planned step"),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-composer-hint-action"));

    const textarea = screen.getByTestId("chat-input-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Run this planned step");
    expect(onSendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chat-send"));

    expect(onSendMessage).toHaveBeenCalledWith("Run this planned step");
  });
});
