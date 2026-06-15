// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { RoadmapStep } from "../../features/roadmap";
import { evaluateProvocationSupervisor, type ProvocationCard } from "../../features/provocation";
import { StepDetailSlideIn } from "./StepDetailSlideIn";

vi.mock("../../features/provocation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/provocation")>();
  return {
    ...actual,
    evaluateProvocationSupervisor: vi.fn(),
  };
});

const evaluateMock = vi.mocked(evaluateProvocationSupervisor);

function lastSupervisorRequest() {
  return evaluateMock.mock.calls[evaluateMock.mock.calls.length - 1]?.[0];
}

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

function supervisorCard(overrides: Partial<ProvocationCard> = {}): ProvocationCard {
  return {
    id: "provocation:step-1:ai_self_report_only:sha256:test",
    type: "ai_self_report_only",
    stage: "verify",
    severity: "caution",
    title: "확인 필요 카드",
    prompt: "AI는 완료됐다고 했지만, 변경 내용을 직접 확인할 수 있나요?",
    message: "확인 가능한 증거를 먼저 살펴보세요.",
    evidence: [{ refId: "agent.assistant_claim", label: "AI 완료 주장", source: "agent" }],
    actions: [{ id: "open_diff", kind: "open_diff", label: "변경 보기" }],
    primaryActionId: "open_diff",
    modeCopy: { guided: "AI의 말과 직접 본 증거를 구분합니다." },
    metadata: {
      contextHash: "sha256:context",
      evidenceHash: "sha256:evidence",
      supervisorEvaluationId: "eval-1",
    },
    createdAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  };
}

function renderStepDetail(overrides: Partial<ComponentProps<typeof StepDetailSlideIn>> = {}) {
  return render(
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
      planContext={{
        expectedFiles: ["src/App.tsx"],
        verificationCommand: "pnpm test",
        verificationManualCheck: null,
        verificationKind: "command",
        dependencies: [],
        parallelGroup: null,
        purpose: "버튼 문구만 수정한다",
      }}
      onOpenChange={vi.fn()}
      onOpenCode={vi.fn()}
      onOpenPreview={vi.fn()}
      onOpenRecovery={vi.fn()}
      onVerifyFirst={vi.fn()}
      onApprovalDecision={vi.fn()}
      onGoToChat={vi.fn()}
      rollbackAvailable
      provocation={{ enabled: true, mode: "work", projectId: 1, sessionId: 2 }}
      {...overrides}
    />,
  );
}

describe("StepDetailSlideIn supervisor-backed review cards", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    evaluateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("places a backend ai_self_report_only 검토 카드 near final approval and routes actions", async () => {
    const onOpenCode = vi.fn();
    evaluateMock.mockResolvedValue({
      status: "shown",
      evaluationId: "eval-1",
      card: supervisorCard(),
    });

    renderStepDetail({ onOpenCode });

    const card = await screen.findByTestId("provocation-card");
    expect(card.closest('[data-testid="step-detail-panel"]')).toBeTruthy();
    expect(card.dataset.cardType).toBe("ai_self_report_only");
    expect(card.textContent).toContain("확인 필요 카드");
    expect(card.textContent).not.toContain("도발카드");
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain("직접 확인");

    const focusPanel = screen.getByTestId("step-detail-verification-focus");
    const details = screen.getByTestId("step-detail-secondary-details") as HTMLDetailsElement;
    const gate = screen.getByTestId("decision-gate");
    expect(
      Boolean(focusPanel.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(Boolean(card.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    expect(Boolean(details.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    expect(details.open).toBe(false);

    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 2,
        event: "verify_entered",
        sourceUiMode: "work",
        artifactRef: expect.objectContaining({ kind: "step", id: "1" }),
      }),
    );

    fireEvent.click(screen.getByTestId("provocation-primary-action"));
    expect(onOpenCode).toHaveBeenCalledTimes(1);
  });

  it("does not show ai_self_report_only when concrete verification evidence exists", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-2",
      dropReason: "provoke_false",
    });

    renderStepDetail({
      verifyLog: {
        intent_match: true,
        test_result: "pass",
        details: "Tests passed.",
        model: "mock",
        ran_at: 1,
      },
    });

    await waitFor(() => expect(evaluateMock).toHaveBeenCalledTimes(1));
    expect(evaluateMock.mock.calls[0][0].uiState.verification.automatedTestsPassed).toBe(true);
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("does not synthesize a fallback card when supervisor evaluation is unavailable", async () => {
    evaluateMock.mockResolvedValue({
      status: "dropped",
      evaluationId: "eval-3",
      dropReason: "runtime_unavailable",
    });

    renderStepDetail();

    await waitFor(() => expect(evaluateMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("provocation-card")).toBeNull();
    expect(screen.queryByText("확인 필요 카드")).toBeNull();
  });

  it("does not fabricate preview verification evidence from the preview click alone", async () => {
    const onOpenPreview = vi.fn();
    evaluateMock.mockResolvedValue({
      status: "shown",
      evaluationId: "eval-preview",
      card: supervisorCard({
        actions: [{ id: "open_preview", kind: "open_preview", label: "미리보기 열기" }],
        primaryActionId: "open_preview",
      }),
    });

    renderStepDetail({
      onOpenPreview,
      planContext: {
        expectedFiles: ["src/App.tsx"],
        verificationCommand: null,
        verificationManualCheck: "프리뷰에서 저장 버튼이 보인다",
        verificationKind: "preview",
        dependencies: [],
        parallelGroup: null,
        purpose: "버튼 문구만 수정한다",
      },
    });

    await screen.findByTestId("provocation-card");
    fireEvent.click(screen.getByTestId("provocation-primary-action"));

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(evaluateMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(lastSupervisorRequest()?.uiState.verification.previewChecked).toBe(false);
    expect(lastSupervisorRequest()?.uiState.verification.acceptanceCriterionConfirmed).toBe(false);

    fireEvent.click(screen.getByTestId("step-detail-confirm-preview"));

    await waitFor(() =>
      expect(lastSupervisorRequest()?.uiState.verification.previewChecked).toBe(true),
    );
    expect(lastSupervisorRequest()?.uiState.verification.acceptanceCriterionConfirmed).toBe(true);
    expect(screen.getByTestId("step-detail-criterion-evidence-ref").textContent).toContain(
      "프리뷰",
    );
  });

  it("reports infeasible preview/app/test actions in the supervisor request", async () => {
    evaluateMock.mockResolvedValue({
      status: "dropped",
      evaluationId: "eval-infeasible",
      dropReason: "runtime_unavailable",
    });

    renderStepDetail({
      step: reviewStep({ testCommand: null }),
      onOpenPreview: undefined,
      planContext: {
        expectedFiles: ["src/App.tsx"],
        verificationCommand: null,
        verificationManualCheck: null,
        verificationKind: null,
        dependencies: [],
        parallelGroup: null,
        purpose: "버튼 문구만 수정한다",
      },
    });

    await waitFor(() => expect(evaluateMock).toHaveBeenCalledTimes(1));
    expect(evaluateMock.mock.calls[0][0].uiState.feasibility).toEqual({
      runnable: false,
      previewable: false,
      hasTests: false,
      diffAvailable: true,
    });
    expect(screen.getByTestId("step-detail-primary-verification-action").textContent).toContain(
      "변경 코드 보기",
    );
    expect(
      screen
        .getByTestId("step-detail-primary-verification-action")
        .getAttribute("data-action-kind"),
    ).toBe("open_diff");
    expect(screen.queryByText("미리보기 열기")).toBeNull();
  });
});

describe("StepDetailSlideIn criterion-linked rationale challenge", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    evaluateMock.mockReset();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-criteria",
      dropReason: "provoke_false",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders linked criteria and rationale, then logs a non-blocking challenge", async () => {
    const onChallengeStepRationale = vi.fn().mockResolvedValue({
      objectionId: "obj-001",
      suggestionStatus: "none",
    });
    const criterionLinkedStep: ComponentProps<typeof StepDetailSlideIn>["step"] = {
      ...reviewStep(),
      linkedCriteria: [
        {
          criterionId: "AC-001",
          text: "저장 성공 후 toast가 보인다",
        },
      ],
      decompositionRationale: "저장 완료 기준을 검증하려면 버튼 상태를 먼저 분리해야 한다.",
    };

    render(
      <StepDetailSlideIn
        open
        step={criterionLinkedStep}
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
        planContext={{
          expectedFiles: ["src/App.tsx"],
          verificationCommand: "pnpm test",
          verificationManualCheck: null,
          verificationKind: "command",
          dependencies: [],
          parallelGroup: null,
          purpose: "버튼 문구만 수정한다",
        }}
        onOpenChange={vi.fn()}
        onOpenCode={vi.fn()}
        onOpenPreview={vi.fn()}
        onOpenRecovery={vi.fn()}
        onVerifyFirst={vi.fn()}
        onApprovalDecision={vi.fn()}
        onGoToChat={vi.fn()}
        onChallengeStepRationale={onChallengeStepRationale}
        rollbackAvailable
        provocation={{ enabled: true, mode: "work", projectId: 1, sessionId: 2 }}
      />,
    );

    const linkedCriteria = screen.getByTestId("step-detail-linked-criteria");
    expect(linkedCriteria.textContent).toContain("AC-001");
    expect(linkedCriteria.textContent).toContain("저장 성공 후 toast가 보인다");
    expect(screen.getByTestId("step-detail-rationale").textContent).toContain(
      "저장 완료 기준을 검증하려면 버튼 상태를 먼저 분리해야 한다.",
    );

    const primaryAction = screen.getByTestId(
      "step-detail-primary-verification-action",
    ) as HTMLButtonElement;
    expect(primaryAction.disabled).toBe(false);

    fireEvent.click(screen.getByTestId("step-rationale-challenge-toggle"));
    fireEvent.change(screen.getByTestId("step-rationale-objection-input"), {
      target: { value: "이 순서가 AC-001에 꼭 필요한지 다시 보고 싶어요." },
    });
    fireEvent.click(screen.getByTestId("step-rationale-objection-submit"));

    await waitFor(() =>
      expect(onChallengeStepRationale).toHaveBeenCalledWith({
        stepId: 1,
        text: "이 순서가 AC-001에 꼭 필요한지 다시 보고 싶어요.",
        linkedCriterionIds: ["AC-001"],
      }),
    );
    expect(primaryAction.disabled).toBe(false);
  });
});
