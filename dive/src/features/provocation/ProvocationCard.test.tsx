// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProvocationCard } from "./ProvocationCard";
import { ProvocationCardHost } from "./ProvocationCardHost";
import type { ProvocationCard as ProvocationCardData } from "./types";

function reviewCard(
  overrides: Partial<ProvocationCardData> = {},
): ProvocationCardData {
  return {
    id: "card-1",
    type: "missing_verification_step",
    stage: "instruct",
    severity: "caution",
    title: "검증 단계가 빠졌습니다",
    message: "이 계획에는 만드는 단계는 있지만, 틀렸음을 확인하는 단계가 없습니다.",
    evidence: [{ source: "plan", label: "검증/실행/테스트 단계", value: "없음" }],
    actions: [{ id: "add", label: "검증 단계 추가", kind: "add_verification_step" }],
    modeCopy: {
      guided:
        "AI가 만든 뒤 무엇을 실행하거나 비교해야 하는지 계획에 있어야 승인 판단이 쉬워집니다.",
    },
    createdAt: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProvocationCard scaffold modes", () => {
  afterEach(() => cleanup());

  it("renders Guided with title, message, evidence, explanation, and actions", () => {
    render(<ProvocationCard card={reviewCard()} mode="guided" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("guided");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.getByText(/틀렸음을 확인하는 단계/)).toBeTruthy();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText(/승인 판단이 쉬워집니다/)).toBeTruthy();
    expect(screen.getByText("검증 단계 추가")).toBeTruthy();
  });

  it("renders Standard without the Guided explanation", () => {
    render(<ProvocationCard card={reviewCard()} mode="standard" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("standard");
    expect(screen.getByText(/틀렸음을 확인하는 단계/)).toBeTruthy();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText("검증 단계 추가")).toBeTruthy();
  });

  it("renders Expert compactly while keeping evidence and actions", () => {
    render(<ProvocationCard card={reviewCard({ severity: "risk" })} mode="expert" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("expert");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.queryByText(/틀렸음을 확인하는 단계/)).toBeNull();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText("검증 단계 추가")).toBeTruthy();
  });
});

describe("ProvocationCardHost Expert filtering", () => {
  afterEach(() => cleanup());

  it("suppresses low-risk cards in Expert mode", () => {
    render(
      <ProvocationCardHost
        cards={[reviewCard({ id: "low-risk", severity: "caution" })]}
        mode="expert"
      />,
    );

    expect(screen.queryByTestId("provocation-host")).toBeNull();
  });

  it("keeps risk cards visible in Expert mode", () => {
    render(
      <ProvocationCardHost
        cards={[
          reviewCard({
            id: "risk",
            severity: "risk",
            type: "ai_self_report_only",
            title: "AI의 완료 보고만 있습니다",
          }),
        ]}
        mode="expert"
      />,
    );

    expect(screen.getByTestId("provocation-card").dataset.severity).toBe("risk");
    expect(screen.getByText("AI의 완료 보고만 있습니다")).toBeTruthy();
  });
});
