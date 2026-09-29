// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { ProvocationLogInput } from "./logging";
import { ProvocationCardHost } from "./ProvocationCardHost";
import type { ProvocationCard as ProvocationCardData } from "./types";

const logged = vi.hoisted(() => [] as ProvocationLogInput[]);

vi.mock("./logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./logging")>();
  return {
    ...actual,
    logProvocationEvent: vi.fn(async (input: ProvocationLogInput) => {
      logged.push(input);
    }),
  };
});

function reviewCard(overrides: Partial<ProvocationCardData> = {}): ProvocationCardData {
  return {
    id: "card-a",
    type: "missing_verification_step",
    stage: "instruct",
    severity: "caution",
    title: "검증 단계가 빠졌습니다",
    prompt: "이 계획이 틀렸는지 무엇으로 확인할 건가요?",
    message: "이 계획에는 만드는 단계는 있지만, 틀렸음을 확인하는 단계가 없습니다.",
    evidence: [{ source: "plan", label: "검증/실행/테스트 단계", value: "없음" }],
    actions: [{ id: "diff", label: "변경 보기", kind: "open_diff" }],
    createdAt: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

const RESPONSE_EVENTS = new Set([
  "provocation.action_clicked",
  "provocation.dismissed",
  "provocation.marked_irrelevant",
  "provocation.continued_with_risk",
]);

function eventsOf(type: ProvocationLogInput["eventType"]) {
  return logged.filter((input) => input.eventType === type);
}

/** SC-002: each card_shown exposure has exactly one terminal event. */
function expectOneTerminalEventPerExposure() {
  for (const shown of eventsOf("provocation.card_shown")) {
    const later = logged.filter(
      (input) => input !== shown && input.exposureId === shown.exposureId,
    );
    const firstResponse = later.findIndex((input) => RESPONSE_EVENTS.has(input.eventType));
    const unanswered = later.filter((input) => input.eventType === "provocation.card_unanswered");
    if (firstResponse >= 0) {
      expect(unanswered).toHaveLength(0);
    } else {
      expect(unanswered).toHaveLength(1);
    }
  }
}

const context = { projectId: 3, sessionId: 9, stage: "instruct" as const };

describe("ProvocationCardHost exposure logging (spec 015 FR-004)", () => {
  beforeEach(() => {
    logged.length = 0;
    useLocaleStore.setState({ locale: "ko" });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-29T00:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it("logs one card_shown and a response with latency, and no card_unanswered after it", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    const shown = eventsOf("provocation.card_shown");
    expect(shown).toHaveLength(1);
    expect(shown[0].exposureId).toMatch(/^exp-/);
    expect(shown[0].context).toMatchObject({ projectId: 3, sessionId: 9 });

    vi.advanceTimersByTime(2500);
    fireEvent.click(screen.getByText("변경 보기"));
    const clicked = eventsOf("provocation.action_clicked");
    expect(clicked).toHaveLength(1);
    expect(clicked[0].exposureId).toBe(shown[0].exposureId);
    expect(clicked[0].responseLatencyMs).toBe(2500);

    // Leaving view after a response is not "unanswered".
    view.rerender(<ProvocationCardHost cards={[]} context={context} mode="work" />);
    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(eventsOf("provocation.card_unanswered")).toHaveLength(0);
    expectOneTerminalEventPerExposure();
  });

  it("logs card_unanswered(replaced) with visibleMs when another card replaces it", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    vi.advanceTimersByTime(4000);
    view.rerender(
      <ProvocationCardHost
        cards={[reviewCard({ id: "card-b", title: "다른 검토 카드" })]}
        context={context}
        mode="work"
      />,
    );

    const unanswered = eventsOf("provocation.card_unanswered");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({
      unansweredReason: "replaced",
      visibleMs: 4000,
      exposureId: eventsOf("provocation.card_shown")[0].exposureId,
    });
    expect(unanswered[0].card.id).toBe("card-a");
    const shownIds = eventsOf("provocation.card_shown").map((input) => input.card.id);
    expect(shownIds).toEqual(["card-a", "card-b"]);

    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expectOneTerminalEventPerExposure();
  });

  it("does not treat a same-id, same-question re-render as a new exposure", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    view.rerender(
      <ProvocationCardHost
        cards={[reviewCard({ title: "같은 카드, 새 객체" })]}
        context={{ ...context, sessionId: 10 }}
        mode="work"
      />,
    );
    expect(eventsOf("provocation.card_shown")).toHaveLength(1);
    expect(eventsOf("provocation.card_unanswered")).toHaveLength(0);

    // The exposure keeps the session it was shown in.
    fireEvent.click(screen.getByText("변경 보기"));
    expect(eventsOf("provocation.action_clicked")[0].context).toMatchObject({
      projectId: 3,
      sessionId: 9,
    });
  });

  it("logs card_unanswered(removed) when the card leaves with nothing replacing it", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    vi.advanceTimersByTime(900);
    view.rerender(<ProvocationCardHost cards={[]} context={context} mode="work" />);
    const unanswered = eventsOf("provocation.card_unanswered");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({ unansweredReason: "removed", visibleMs: 900 });
    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(eventsOf("provocation.card_unanswered")).toHaveLength(1);
  });

  it("closes card A under card A's context when card and context change together", () => {
    const stepA = { projectId: 3, sessionId: 9, stage: "verify" as const, taskId: "step-a" };
    const stepB = { projectId: 3, sessionId: 10, stage: "verify" as const, taskId: "step-b" };
    const view = render(<ProvocationCardHost cards={[reviewCard()]} context={stepA} mode="work" />);
    view.rerender(
      <ProvocationCardHost
        cards={[reviewCard({ id: "card-b", title: "B 단계 카드" })]}
        context={stepB}
        mode="guided"
      />,
    );
    const [unanswered] = eventsOf("provocation.card_unanswered");
    expect(unanswered.card.id).toBe("card-a");
    expect(unanswered.context).toMatchObject({ sessionId: 9, taskId: "step-a" });
    expect(unanswered.mode).toBe("work");
    const shownB = eventsOf("provocation.card_shown")[1];
    expect(shownB.card.id).toBe("card-b");
    expect(shownB.context).toMatchObject({ sessionId: 10, taskId: "step-b" });
    expect(shownB.mode).toBe("guided");
  });

  it("opens a new exposure when the same card id asks a different question", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    vi.advanceTimersByTime(1500);
    view.rerender(
      <ProvocationCardHost
        cards={[reviewCard({ prompt: "목표 요약이 바뀌었는데, 지금도 맞나요?" })]}
        context={context}
        mode="work"
      />,
    );
    const shown = eventsOf("provocation.card_shown");
    expect(shown.map((input) => input.card.prompt)).toEqual([
      "이 계획이 틀렸는지 무엇으로 확인할 건가요?",
      "목표 요약이 바뀌었는데, 지금도 맞나요?",
    ]);
    expect(shown[0].exposureId).not.toBe(shown[1].exposureId);
    const [unanswered] = eventsOf("provocation.card_unanswered");
    expect(unanswered).toMatchObject({
      unansweredReason: "replaced",
      visibleMs: 1500,
      exposureId: shown[0].exposureId,
    });
    expect(unanswered.card.prompt).toBe("이 계획이 틀렸는지 무엇으로 확인할 건가요?");
    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expectOneTerminalEventPerExposure();
  });

  it("logs card_unanswered(unmounted) once when the host unmounts", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    vi.advanceTimersByTime(1200);
    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    const unanswered = eventsOf("provocation.card_unanswered");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({ unansweredReason: "unmounted", visibleMs: 1200 });
    expectOneTerminalEventPerExposure();
  });

  it("does not double-count an exposure under StrictMode remounting", () => {
    const view = render(
      <StrictMode>
        <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />
      </StrictMode>,
    );
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(eventsOf("provocation.card_shown")).toHaveLength(1);
    expect(eventsOf("provocation.card_unanswered")).toHaveLength(0);

    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(eventsOf("provocation.card_unanswered")).toHaveLength(1);
    expectOneTerminalEventPerExposure();
  });

  it("logs card_unanswered(page_hidden) on pagehide and nothing more on unmount", () => {
    const view = render(
      <ProvocationCardHost cards={[reviewCard()]} context={context} mode="work" />,
    );
    vi.advanceTimersByTime(300);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    const unanswered = eventsOf("provocation.card_unanswered");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]).toMatchObject({ unansweredReason: "page_hidden", visibleMs: 300 });
  });

  it("closes a dismissed exposure with the dismiss response only", () => {
    const view = render(
      <ProvocationCardHost
        cards={[reviewCard(), reviewCard({ id: "card-b", title: "다음 검토 카드" })]}
        context={context}
        mode="work"
      />,
    );
    vi.advanceTimersByTime(700);
    fireEvent.click(screen.getByTestId("provocation-dismiss"));
    const dismissed = eventsOf("provocation.dismissed");
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].card.id).toBe("card-a");
    expect(dismissed[0].responseLatencyMs).toBe(700);

    view.unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    // The first card was answered; the second one (shown after the dismiss)
    // left unanswered at unmount.
    const unanswered = eventsOf("provocation.card_unanswered");
    expect(unanswered.map((input) => input.card.id)).toEqual(["card-b"]);
    expectOneTerminalEventPerExposure();
  });
});
