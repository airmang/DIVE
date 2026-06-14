// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { RoadmapStep } from "../../features/roadmap";
import { StepDetailSlideIn } from "./StepDetailSlideIn";

function reviewStep(overrides: Partial<RoadmapStep> = {}): RoadmapStep {
  return {
    id: 1,
    position: 1,
    title: "버튼 문구 변경",
    description: "버튼 문구만 바꿔줘",
    assistSummary: "src/App.tsx의 버튼 문구를 수정한다",
    acceptanceCriteria: "버튼에 저장 문구가 보인다",
    retrospective: null,
    changeSummary: null,
    testCommand: "pnpm test",
    approvalProvenance: null,
    status: "review",
    wasRejected: false,
    progress: { ratio: 1, completedUnits: 1, totalUnits: 1 },
    isActive: true,
    isComplete: false,
    hasChanges: true,
    ...overrides,
  };
}

describe("StepDetailSlideIn recovery actions", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("routes unrelated-change revert review-card action to the Recovery surface", () => {
    const onOpenRecovery = vi.fn();

    render(
      <StepDetailSlideIn
        open
        step={reviewStep()}
        toolCallCount={1}
        verifyLog={null}
        verifyState="idle"
        verifyError={null}
        changedFiles={[{ path: "package.json", diff: null }]}
        onOpenChange={vi.fn()}
        onOpenCode={vi.fn()}
        onOpenPreview={vi.fn()}
        onOpenRecovery={onOpenRecovery}
        onVerifyFirst={vi.fn()}
        onApprovalDecision={vi.fn()}
        onGoToChat={vi.fn()}
        rollbackAvailable={false}
        provocation={{ enabled: true, mode: "standard", projectId: 1, sessionId: 2 }}
      />,
    );

    fireEvent.click(screen.getByText("관련 없는 변경 되돌리기"));

    expect(onOpenRecovery).toHaveBeenCalledTimes(1);
  });

  it("shows expected-vs-actual high-risk drift and keeps diff review separate from tests", () => {
    const onOpenCode = vi.fn();

    render(
      <StepDetailSlideIn
        open
        step={reviewStep()}
        toolCallCount={1}
        verifyLog={null}
        verifyState="idle"
        verifyError={null}
        changedFiles={[
          { path: "src/Button.tsx", diff: null },
          { path: "package.json", diff: null },
          { path: "src/auth.ts", diff: null },
        ]}
        planContext={{
          expectedFiles: ["src/Button.tsx"],
          verificationCommand: "pnpm test Button",
          verificationManualCheck: null,
          verificationKind: "command",
          dependencies: [],
          parallelGroup: null,
          purpose: "버튼 문구만 수정한다",
        }}
        onOpenChange={vi.fn()}
        onOpenCode={onOpenCode}
        onOpenPreview={vi.fn()}
        onOpenRecovery={vi.fn()}
        onVerifyFirst={vi.fn()}
        onApprovalDecision={vi.fn()}
        onGoToChat={vi.fn()}
        rollbackAvailable={false}
        provocation={{ enabled: true, mode: "standard", projectId: 1, sessionId: 2 }}
      />,
    );

    expect(screen.getByTestId("step-detail-change-bundle")).toBeTruthy();
    expect(screen.getByTestId("step-detail-expected-files").textContent).toContain(
      "src/Button.tsx",
    );
    expect(screen.getByTestId("step-detail-actual-files").textContent).toContain("package.json");
    expect(screen.getByTestId("step-detail-unexpected-high-risk-files").dataset.count).toBe("2");
    expect(screen.getByText("목표 밖 변경이 섞였을 수 있습니다")).toBeTruthy();
    expect(screen.getByTestId("decision-gate-reasons").textContent).toContain("package.json");
    expect(screen.queryByText("Diff 확인됨")).toBeNull();

    fireEvent.click(screen.getByTestId("step-detail-open-code"));

    expect(onOpenCode).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Diff 확인됨").length).toBeGreaterThan(0);
    expect(screen.queryByText("자동 테스트 통과")).toBeNull();
  });

  it("records preview observation before criterion confirmation unlocks direct approval", () => {
    const onOpenPreview = vi.fn();
    const onApprovalDecision = vi.fn();

    render(
      <StepDetailSlideIn
        open
        step={reviewStep()}
        toolCallCount={1}
        verifyLog={{
          intent_match: true,
          test_result: "skipped",
          details: "AI reported completion without external verification.",
          model: "mock",
          ran_at: 1,
        }}
        verifyState="idle"
        verifyError={null}
        changedFiles={[{ path: "src/App.tsx", diff: null }]}
        onOpenChange={vi.fn()}
        onOpenCode={vi.fn()}
        onOpenPreview={onOpenPreview}
        onOpenRecovery={vi.fn()}
        onVerifyFirst={vi.fn()}
        onApprovalDecision={onApprovalDecision}
        onGoToChat={vi.fn()}
        rollbackAvailable
        provocation={{ enabled: true, mode: "standard", projectId: 1, sessionId: 2 }}
      />,
    );

    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("프리뷰 확인"));

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getAllByTestId("verification-status-chip")
        .some((chip) => chip.dataset.statusId === "preview_checked"),
    ).toBe(true);
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("step-detail-criterion-confirm-checkbox"));

    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("decision-gate-approve"));

    expect(onApprovalDecision).toHaveBeenCalledWith({ outcome: "approved", note: null });
  });

  it("routes review-card test action to the verify flow", () => {
    const onVerifyFirst = vi.fn();

    render(
      <StepDetailSlideIn
        open
        step={reviewStep()}
        toolCallCount={1}
        verifyLog={{
          intent_match: true,
          test_result: "skipped",
          details: "AI reported completion without external verification.",
          model: "mock",
          ran_at: 1,
        }}
        verifyState="idle"
        verifyError={null}
        changedFiles={[{ path: "src/App.tsx", diff: null }]}
        onOpenChange={vi.fn()}
        onOpenCode={vi.fn()}
        onOpenPreview={vi.fn()}
        onOpenRecovery={vi.fn()}
        onVerifyFirst={onVerifyFirst}
        onApprovalDecision={vi.fn()}
        onGoToChat={vi.fn()}
        rollbackAvailable
        provocation={{ enabled: true, mode: "standard", projectId: 1, sessionId: 2 }}
      />,
    );

    fireEvent.click(screen.getByText("테스트 실행"));

    expect(onVerifyFirst).toHaveBeenCalledTimes(1);
  });
});
