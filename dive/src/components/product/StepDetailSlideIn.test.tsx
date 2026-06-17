// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { RoadmapStep } from "../../features/roadmap";
import { evaluateProvocationSupervisor, type ProvocationCard } from "../../features/provocation";
import {
  generateVerificationCoachGuide,
  recordVerificationObservation,
} from "../../features/verification-coach/api";
import { StepDetailSlideIn } from "./StepDetailSlideIn";

vi.mock("../../features/provocation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/provocation")>();
  return {
    ...actual,
    evaluateProvocationSupervisor: vi.fn(),
  };
});

vi.mock("../../features/verification-coach/api", () => ({
  generateVerificationCoachGuide: vi.fn(),
  recordVerificationObservation: vi.fn(),
}));

const evaluateMock = vi.mocked(evaluateProvocationSupervisor);
const coachMock = vi.mocked(generateVerificationCoachGuide);
const observationMock = vi.mocked(recordVerificationObservation);

function lastSupervisorRequest() {
  return evaluateMock.mock.calls[evaluateMock.mock.calls.length - 1]?.[0];
}

function findSupervisorRequest(event: string) {
  return evaluateMock.mock.calls.find(([request]) => request.event === event)?.[0];
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

function stepDetailElement(overrides: Partial<ComponentProps<typeof StepDetailSlideIn>> = {}) {
  return (
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
    />
  );
}

function renderStepDetail(overrides: Partial<ComponentProps<typeof StepDetailSlideIn>> = {}) {
  return render(stepDetailElement(overrides));
}

describe("StepDetailSlideIn supervisor-backed review cards", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    evaluateMock.mockReset();
    coachMock.mockReset();
    observationMock.mockReset();
    coachMock.mockResolvedValue({
      status: "shown",
      eventId: "coach-1",
      guideVersion: 1,
      guide: {
        criterionSummary: "버튼에 저장 문구가 보인다",
        recommendedChecks: [
          {
            kind: "diff",
            label: "변경 파일 확인",
            instruction: "src/App.tsx diff에서 버튼 문구 변경을 확인하세요.",
            expectedObservation: "버튼 label이 저장으로 바뀌어야 합니다.",
          },
        ],
        evidencePrompts: ["무엇을 확인했나요?"],
      },
      validation: {
        outcome: "valid",
        reasonCode: "ok",
        evidenceRefs: ["criterion:step-1-criterion-1"],
      },
      model: "mock",
      latencyMs: 1,
    });
    observationMock.mockImplementation(async (observation) => ({
      ...observation,
      observationId: "obs-1",
      recordedAt: 123,
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("places a backend ai_self_report_only 검토 카드 near final approval and routes actions", async () => {
    const onOpenCode = vi.fn();
    evaluateMock.mockImplementation((request) => {
      if (request.event === "diff_ready") {
        return Promise.resolve({
          status: "none",
          evaluationId: "eval-diff",
          dropReason: "provoke_false",
        });
      }
      return Promise.resolve({
        status: "shown",
        evaluationId: "eval-1",
        card: supervisorCard(),
      });
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

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(findSupervisorRequest("verify_entered")?.uiState.verification.automatedTestsPassed).toBe(
      true,
    );
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("does not synthesize a fallback card when supervisor evaluation is unavailable", async () => {
    evaluateMock.mockResolvedValue({
      status: "dropped",
      evaluationId: "eval-3",
      dropReason: "runtime_unavailable",
    });

    renderStepDetail();

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(screen.queryByTestId("provocation-card")).toBeNull();
    expect(screen.queryByText("확인 필요 카드")).toBeNull();
  });

  it("shows verification coach guidance near review without creating a review card", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail({
      step: reviewStep({ testCommand: null }),
      planContext: {
        expectedFiles: ["src/App.tsx"],
        verificationCommand: null,
        verificationManualCheck: "파일 출력과 diff를 직접 확인한다",
        verificationKind: "manual",
        dependencies: [],
        parallelGroup: null,
        purpose: "저장 문구만 수정한다",
      },
    });

    const coach = await screen.findByTestId("verification-coach-panel");
    expect(coach.dataset.status).toBe("shown");
    expect(screen.getByTestId("verification-coach-guide").textContent).toContain(
      "버튼에 저장 문구",
    );
    expect(coachMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 2,
        cardId: 1,
        sourceUiMode: "work",
        evidence: expect.objectContaining({
          verificationKind: "manual",
          previewAvailable: true,
          diffAvailable: true,
        }),
      }),
    );
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("records criterion-linked observation evidence and enables normal approval", async () => {
    const onApprovalDecision = vi.fn();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail({ onApprovalDecision });

    await screen.findByTestId("verification-coach-guide");
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "pnpm test를 실행했고 버튼 문구가 저장으로 표시되는 것을 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));

    await screen.findByTestId("verification-observation-saved");
    expect(observationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 2,
        cardId: 1,
        criterionIds: ["step-1-criterion-1"],
        observationText: "pnpm test를 실행했고 버튼 문구가 저장으로 표시되는 것을 확인함",
      }),
    );
    expect(
      screen
        .getAllByTestId("verification-status-chip")
        .some((chip) => chip.textContent?.includes("직접 관찰")),
    ).toBe(true);
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByTestId("decision-gate-approve"));
    expect(onApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "approved",
        observationEvidence: expect.objectContaining({
          observationIds: ["obs-1"],
          criterionIds: ["step-1-criterion-1"],
        }),
      }),
    );
  });

  it("preserves recorded observation evidence after regenerating guidance", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail();

    await screen.findByTestId("verification-coach-guide");
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "변경된 버튼 문구를 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));
    await screen.findByTestId("verification-observation-saved");
    const callsBeforeRegenerate = coachMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("verification-coach-regenerate"));

    await waitFor(() => expect(coachMock.mock.calls.length).toBe(callsBeforeRegenerate + 1));
    expect(coachMock.mock.calls[coachMock.mock.calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({
        guideVersion: expect.any(Number),
        evidence: expect.objectContaining({
          priorObservations: [
            expect.objectContaining({
              observationId: "obs-1",
              observationText: "변경된 버튼 문구를 확인함",
            }),
          ],
        }),
      }),
    );
    expect(screen.getByTestId("verification-observation-saved")).toBeTruthy();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("does not fabricate preview verification evidence from the preview click alone", async () => {
    const onOpenPreview = vi.fn();
    evaluateMock.mockImplementation((request) => {
      if (request.event === "diff_ready") {
        return Promise.resolve({
          status: "none",
          evaluationId: "eval-diff",
          dropReason: "provoke_false",
        });
      }
      return Promise.resolve({
        status: "shown",
        evaluationId: "eval-preview",
        card: supervisorCard({
          actions: [{ id: "open_preview", kind: "open_preview", label: "미리보기 열기" }],
          primaryActionId: "open_preview",
        }),
      });
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

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(findSupervisorRequest("verify_entered")?.uiState.feasibility).toEqual({
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
  it("keeps PRD decomposition rationale out of the step review panel", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-criteria",
      dropReason: "provoke_false",
    });

    renderStepDetail({
      step: reviewStep({
        linkedCriteria: [
          {
            criterionId: "AC-001",
            text: "저장 성공 후 toast가 보인다",
          },
        ],
        decompositionRationale: "저장 완료 기준을 검증하려면 버튼 상태를 먼저 분리해야 한다.",
      }),
    });

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(screen.queryByTestId("step-detail-linked-criteria")).toBeNull();
    expect(screen.queryByTestId("step-detail-rationale")).toBeNull();
    expect(screen.queryByTestId("step-rationale-challenge-toggle")).toBeNull();
    expect(screen.getByTestId("step-detail-verification-focus")).toBeTruthy();
  });

  it("places a diff_ready card near changed-work review and opens the diff", async () => {
    const onOpenCode = vi.fn();
    evaluateMock.mockImplementation((request) => {
      if (request.event === "diff_ready") {
        return Promise.resolve({
          status: "shown",
          evaluationId: "eval-diff",
          card: supervisorCard({
            id: "provocation:step-1:diff_scope_drift:sha256:test",
            type: "diff_scope_review",
            stage: "verify",
            title: "확인 필요 카드",
            prompt: "이 변경 파일이 현재 목표 범위 안에 있나요?",
            message: "변경된 파일이 현재 목표와 계획 범위 안에 있는지 확인하세요.",
            evidence: [
              {
                refId: "diff.changed_files",
                label: "Changed files",
                source: "diff",
                kind: "changed_file",
              },
            ],
            actions: [{ id: "open_diff", kind: "open_diff", label: "변경 보기" }],
            primaryActionId: "open_diff",
            metadata: {
              supervisorEvaluationId: "eval-diff",
              supervisorEvent: "diff_ready",
              highRiskFiles: ["src/auth/session.ts"],
            },
          }),
        });
      }
      return Promise.resolve({
        status: "shown",
        evaluationId: "eval-verify",
        card: supervisorCard(),
      });
    });

    renderStepDetail({
      onOpenCode,
      changedFiles: [
        { path: "src/App.tsx", diff: null },
        { path: "src/auth/session.ts", diff: null },
      ],
    });

    const card = await screen.findByTestId("provocation-card");
    expect(card.dataset.cardType).toBe("diff_scope_review");
    expect(findSupervisorRequest("diff_ready")).toMatchObject({
      event: "diff_ready",
      diffReadyAssessment: {
        eligible: true,
        unexpectedFiles: ["src/auth/session.ts"],
        highRiskFiles: ["src/auth/session.ts"],
      },
    });
    expect(findSupervisorRequest("verify_entered")).toBeUndefined();

    fireEvent.click(screen.getByTestId("provocation-primary-action"));
    expect(onOpenCode).toHaveBeenCalledTimes(1);
  });

  it("places a retry_loop card after the same step failure repeats and opens recovery", async () => {
    const onOpenRecovery = vi.fn();
    evaluateMock.mockImplementation((request) => {
      if (request.event === "retry_loop") {
        return Promise.resolve({
          status: "shown",
          evaluationId: "eval-retry",
          card: supervisorCard({
            id: "provocation:step-1:retry_loop:sha256:test",
            type: "retry_loop_review",
            stage: "verify",
            title: "확인 필요 카드",
            prompt: "같은 실패가 반복되니 먼저 복구 지점을 확인할까요?",
            message: "같은 실패가 반복되고 있습니다. 재현과 복구 지점을 먼저 확인하세요.",
            evidence: [
              {
                refId: "failure.fingerprint",
                label: "Repeated failure",
                source: "terminal",
                kind: "failure_summary",
              },
            ],
            actions: [
              { id: "rollback_last_change", kind: "rollback_last_change", label: "복구 열기" },
            ],
            primaryActionId: "rollback_last_change",
            metadata: {
              supervisorEvaluationId: "eval-retry",
              supervisorEvent: "retry_loop",
            },
          }),
        });
      }
      return Promise.resolve({
        status: "none",
        evaluationId: "eval-none",
        dropReason: "provoke_false",
      });
    });

    const firstFailureLog = {
      intent_match: false,
      test_result: "fail" as const,
      details: "TypeError: Cannot read properties of undefined at src/settings/save.ts:42",
      model: "mock",
      ran_at: 1,
    };
    const secondFailureLog = {
      ...firstFailureLog,
      details: "TypeError: Cannot read properties of undefined at src/settings/save.ts:99",
      ran_at: 2,
    };
    const view = renderStepDetail({
      onOpenRecovery,
      verifyState: "error",
      verifyError: firstFailureLog.details,
      verifyLog: firstFailureLog,
    });

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(findSupervisorRequest("diff_ready")).toBeUndefined();
    expect(findSupervisorRequest("retry_loop")).toBeUndefined();
    evaluateMock.mockClear();

    view.rerender(
      stepDetailElement({
        onOpenRecovery,
        verifyState: "error",
        verifyError: secondFailureLog.details,
        verifyLog: secondFailureLog,
      }),
    );

    const card = await screen.findByTestId("provocation-card");
    expect(card.dataset.cardType).toBe("retry_loop_review");
    expect(findSupervisorRequest("retry_loop")).toMatchObject({
      event: "retry_loop",
      retryLoopAssessment: {
        eligible: true,
        failureCount: 2,
        recoveryAvailable: true,
      },
    });
    expect(findSupervisorRequest("diff_ready")).toBeUndefined();

    fireEvent.click(screen.getByTestId("provocation-primary-action"));
    expect(onOpenRecovery).toHaveBeenCalledTimes(1);
  });
});
