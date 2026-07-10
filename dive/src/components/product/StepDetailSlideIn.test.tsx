// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import enResources from "../../i18n/en.json";
import koResources from "../../i18n/ko.json";
import type { RoadmapStep } from "../../features/roadmap";
import { evaluateProvocationSupervisor, type ProvocationCard } from "../../features/provocation";
import {
  generateVerificationCoachGuide,
  recordVerificationObservation,
} from "../../features/verification-coach/api";
import { StepDetailSlideIn } from "./StepDetailSlideIn";
import { deriveDecisionGatePolicy } from "./decisionGatePolicy";

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

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function openStepperStage(stageId: string) {
  fireEvent.click(screen.getByTestId(`verification-stepper-stage-button-${stageId}`));
}

async function openReviewCardStage() {
  await waitFor(() =>
    expect(screen.getByTestId("verification-stepper-stage-button-review-card")).toBeTruthy(),
  );
  openStepperStage("review-card");
  return screen.findByTestId("provocation-card");
}

function openDecisionStage() {
  openStepperStage("decision");
  return screen.getByTestId("decision-gate");
}

function flattenResourceKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenResourceKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("StepDetailSlideIn supervisor-backed review cards", () => {
  beforeEach(() => {
    setViewportWidth(1024);
    window.localStorage.clear();
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
      fallbackGuidance: [{ criterionId: "step-1-criterion-1", classes: ["responsive"] }],
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

    const card = await openReviewCardStage();
    expect(card.closest('[data-testid="step-detail-panel"]')).toBeTruthy();
    expect(card.dataset.cardType).toBe("ai_self_report_only");
    expect(card.textContent).toContain("확인 필요 카드");
    expect(card.textContent).not.toContain("도발카드");
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain("직접 확인");

    const focusPanel = screen.getByTestId("step-detail-verification-focus");
    const details = screen.getByTestId("step-detail-secondary-details") as HTMLDetailsElement;
    expect(
      Boolean(focusPanel.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(Boolean(card.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByTestId("provocation-primary-action"));
    expect(onOpenCode).toHaveBeenCalledTimes(1);

    openDecisionStage();
    const gate = screen.getByTestId("decision-gate");
    expect(Boolean(gate.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );

    expect(evaluateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 2,
        event: "verify_entered",
        sourceUiMode: "work",
        artifactRef: expect.objectContaining({ kind: "step", id: "1" }),
      }),
    );
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
        test_command: "npm test",
        test_exit_code: 0,
      },
    });

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(findSupervisorRequest("verify_entered")?.uiState.verification.automatedTestsPassed).toBe(
      true,
    );
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("dedupes AI self-report chips when verification and agency sources both emit it", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail();

    const chips = screen.getByTestId("step-detail-evidence-chips");
    expect(within(chips).getAllByText("AI 자가보고만 있음")).toHaveLength(1);
    expect(
      chips.querySelectorAll(
        '[data-status-id="ai_self_report_only"], [data-agency-state="ai_self_report_only"]',
      ),
    ).toHaveLength(1);
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

    openStepperStage("observe");
    const coach = await screen.findByTestId("verification-coach-panel");
    expect(coach.dataset.status).toBe("shown");
    expect(screen.getByTestId("verification-coach-guide").textContent).toContain(
      "버튼에 저장 문구",
    );
    expect(screen.queryByTestId("verification-coach-fallback")).toBeNull();
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

  it("renders a labeled deterministic fallback checklist when guidance is unavailable", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const step = reviewStep({
      linkedCriteria: [
        { criterionId: "c1", text: "모바일 375px에서 레이아웃이 맞게 접힘" },
        { criterionId: "c2", text: "검색 결과가 없을 때 빈 상태 메시지가 보임" },
      ],
    });
    coachMock.mockResolvedValue({
      status: "unavailable",
      eventId: "coach-missing-credentials",
      guideVersion: 1,
      dropReason: "missing_credentials",
      fallbackGuidance: [
        { criterionId: "c1", classes: ["responsive"] },
        { criterionId: "c2", classes: ["empty"] },
      ],
    });

    renderStepDetail({ step });

    openStepperStage("observe");
    expect((await screen.findByTestId("verification-coach-unavailable")).textContent).toContain(
      "AI 연결 정보",
    );
    const fallback = screen.getByTestId("verification-coach-fallback");
    expect(fallback.textContent).toContain("오프라인 대체 안내");
    expect(fallback.textContent).toContain("AI 코치 아님");
    expect(within(fallback).getAllByTestId("verification-coach-fallback-item")).toHaveLength(2);
    expect(fallback.textContent).toContain("모바일 375px");
    expect(fallback.textContent).toContain("글자와 버튼이 겹치지 않는지");
    expect(fallback.textContent).toContain("빈 상태 메시지");
    expect(screen.queryByTestId("verification-coach-guide")).toBeNull();
  });

  it("keeps fallback-only guidance out of the S-029 observation gate", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const step = reviewStep({
      linkedCriteria: [
        { criterionId: "c1", text: "모바일 375px에서 레이아웃이 맞게 접힘" },
        { criterionId: "c2", text: "검색 결과가 없을 때 빈 상태 메시지가 보임" },
      ],
    });
    coachMock.mockResolvedValue({
      status: "unavailable",
      eventId: "coach-runtime-unavailable",
      guideVersion: 1,
      dropReason: "runtime_unavailable",
      fallbackGuidance: [
        { criterionId: "c1", classes: ["responsive"] },
        { criterionId: "c2", classes: ["empty"] },
      ],
    });

    renderStepDetail({ step });

    openStepperStage("observe");
    await screen.findByTestId("verification-coach-fallback");
    expect(screen.queryByTestId("verification-coach-guide")).toBeNull();
    expect(observationMock).not.toHaveBeenCalled();

    const policy = deriveDecisionGatePolicy({
      verifyLog: {
        intent_match: true,
        test_result: "skipped",
        details: "AI reported completion without external verification.",
        model: "mock",
        ran_at: 1,
      },
      rollbackAvailable: true,
      acceptanceCriterionConfirmed: false,
      verificationFeasibility: {
        runnable: true,
        previewable: true,
        hasTests: true,
        diffAvailable: true,
      },
      gatingCriterionIds: ["c1", "c2"],
      observedCriterionIds: [],
    });
    expect(policy.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "criteria_unobserved", evidence: "0/2" }),
      ]),
    );

    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("decision-gate-details"));
    expect(screen.getByTestId("decision-gate-reasons").textContent).toContain("0/2");
    expect(observationMock).not.toHaveBeenCalled();
  });

  it("records criterion-linked observation evidence and enables normal approval", async () => {
    const onApprovalDecision = vi.fn();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail({ onApprovalDecision });

    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");

    // S-029: typing alone is not evidence — the observation only counts once the
    // user actually opens the preview (the action that backs what they observed).
    expect(
      (screen.getByTestId("verification-observation-record") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId("step-detail-primary-verification-action"));

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
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(false);

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

  it("requires every linked criterion to be observed before approval (S-029)", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const step = reviewStep({
      linkedCriteria: [
        { criterionId: "c1", text: "대소문자 무시 검색" },
        { criterionId: "c2", text: "부분 일치 검색" },
      ],
    });

    renderStepDetail({ step });

    // Observing via the preview is the action that backs each observation.
    fireEvent.click(screen.getByTestId("step-detail-primary-verification-action"));
    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");

    // Record an observation for the first criterion only (selector defaults to it).
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "대문자 Pasta로 검색해도 결과가 나오는 것을 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));
    await screen.findByTestId("verification-observation-saved");
    expect(observationMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ criterionIds: ["c1"] }),
    );

    // One of two criteria observed — the gate stays blocked with an N/M reason.
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("decision-gate-reasons").textContent).toContain("1/2");

    // Observe the second criterion: uncheck c1, check c2 (S-056 explicit
    // multi-criterion checklist replaces the old single-select dropdown).
    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");
    fireEvent.click(screen.getByTestId("verification-observation-criterion-c1"));
    fireEvent.click(screen.getByTestId("verification-observation-criterion-c2"));
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Pas로 검색하면 Pasta Bake가 부분 일치로 나오는 것을 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));
    await waitFor(() =>
      expect(observationMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ criterionIds: ["c2"] }),
      ),
    );

    // Both criteria now observed — approval is unblocked.
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears N linked criteria from a single observation explicitly linked to all of them (S-056 D3)", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const step = reviewStep({
      linkedCriteria: [
        { criterionId: "c1", text: "대소문자 무시 검색" },
        { criterionId: "c2", text: "부분 일치 검색" },
      ],
    });

    renderStepDetail({ step });

    fireEvent.click(screen.getByTestId("step-detail-primary-verification-action"));
    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");

    // Blocked before any observation is recorded.
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);

    // Explicitly link ONE observation to BOTH criteria via "apply to all",
    // then record it once.
    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");
    fireEvent.click(screen.getByTestId("verification-observation-select-all"));
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "대문자 Pasta와 Pas 부분 검색 모두 정상 동작하는 것을 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));
    await screen.findByTestId("verification-observation-saved");

    expect(observationMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ criterionIds: ["c1", "c2"] }),
    );

    // A single multi-criterion observation clears both gates at once —
    // approval unblocks without a second recording.
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("splits an enumerated single-string criterion into per-AC gates (S-029)", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const step = reviewStep({
      acceptanceCriteria: "AC-1 대소문자 무시 검색\nAC-2 부분 일치 검색\nAC-3 빈 쿼리는 전체 표시",
      linkedCriteria: undefined,
    });

    renderStepDetail({ step });

    fireEvent.click(screen.getByTestId("step-detail-primary-verification-action"));
    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "대문자 Pasta로 검색해도 결과가 나오는 것을 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));
    await screen.findByTestId("verification-observation-saved");

    // A 3-AC goal stored as one summary string must still gate on all three.
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("decision-gate-reasons").textContent).toContain("1/3");
  });

  it("sends a note when requesting changes from verification review", async () => {
    const onApprovalDecision = vi.fn();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail({ onApprovalDecision });

    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByTestId("decision-gate-request-changes") as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByTestId("decision-gate-request-changes"));

    expect(onApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "revision_requested",
        note: expect.any(String),
      }),
    );
    expect(onApprovalDecision.mock.calls[0]?.[0].note.trim().length).toBeGreaterThan(0);
  });

  it("preserves recorded observation evidence after regenerating guidance", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail();

    openStepperStage("observe");
    await screen.findByTestId("verification-coach-guide");
    // S-029: open the preview first so the observation is action-backed.
    fireEvent.click(screen.getByTestId("step-detail-primary-verification-action"));
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "변경된 버튼 문구를 확인함" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));
    await screen.findByTestId("verification-observation-saved");
    const callsBeforeRegenerate = coachMock.mock.calls.length;
    expect(callsBeforeRegenerate).toBe(1);

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
    openDecisionStage();
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(false);
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

    await openReviewCardStage();
    fireEvent.click(screen.getByTestId("provocation-primary-action"));

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(evaluateMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(lastSupervisorRequest()?.uiState.verification.previewChecked).toBe(false);
    expect(lastSupervisorRequest()?.uiState.verification.acceptanceCriterionConfirmed).toBe(false);

    openStepperStage("observe");
    expect(screen.getByTestId("step-detail-criterion-confirm")).toBeTruthy();
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

    const card = await openReviewCardStage();
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

  it("keeps deterministic high-risk gate evidence when diff_ready parsing drops the card", async () => {
    evaluateMock.mockResolvedValue({
      status: "dropped",
      evaluationId: "eval-parse",
      dropReason: "parse_error",
    });

    renderStepDetail({
      changedFiles: [
        { path: "src/App.tsx", diff: null },
        { path: "package.json", diff: null },
      ],
    });

    await waitFor(() => expect(findSupervisorRequest("diff_ready")).toBeTruthy());
    await waitFor(() => expect(evaluateMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(screen.queryByTestId("verification-stepper-stage-review-card")).toBeNull();
    expect(screen.queryByTestId("provocation-card")).toBeNull();
    expect(screen.getByTestId("step-detail-code-high-risk").textContent).toContain("1");

    openDecisionStage();
    expect(screen.getByTestId("decision-gate").dataset.reasonRequired).toBe("true");
    fireEvent.click(screen.getByTestId("decision-gate-details"));
    expect(screen.getByTestId("decision-gate-reasons").textContent).toContain("package.json");
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

    const card = await openReviewCardStage();
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

  it("uses sequential stepper navigation, revisit, and skips review-card stage without cards", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail();

    await waitFor(() => expect(findSupervisorRequest("verify_entered")).toBeTruthy());
    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "current",
    );
    expect(screen.queryByTestId("verification-stepper-stage-review-card")).toBeNull();
    expect(screen.getByTestId("verification-stepper-stage-decision")).toBeTruthy();

    fireEvent.click(screen.getByTestId("verification-stepper-next"));
    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "visited",
    );
    expect(screen.getByTestId("verification-stepper-stage-observe").dataset.stageState).toBe(
      "current",
    );
    expect(screen.getByTestId("verification-stepper-revisit-code")).toBeTruthy();

    fireEvent.click(screen.getByTestId("verification-stepper-revisit-code"));
    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "current",
    );

    openDecisionStage();
    expect(screen.getByTestId("verification-stepper-stage-decision").dataset.stageState).toBe(
      "current",
    );
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks the code stepper stage completed after diff evidence is viewed", () => {
    const onOpenCode = vi.fn();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderStepDetail({ onOpenCode });

    fireEvent.click(screen.getByTestId("step-detail-open-code"));
    expect(onOpenCode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("verification-stepper-next"));
    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "completed",
    );
    expect(screen.getByTestId("verification-stepper-success-code")).toBeTruthy();
  });

  it("clamps, resets, persists, restores, and supports keyboard resizing", async () => {
    setViewportWidth(1000);
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    window.localStorage.setItem("dive.review-sidebar.width", "720");
    renderStepDetail();

    const panel = screen.getByTestId("step-detail-panel");
    const handle = screen.getByTestId("step-detail-resize-handle");
    await waitFor(() => expect(panel.style.width).toBe("720px"));
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuemin")).toBe("380");
    expect(handle.getAttribute("aria-valuemax")).toBe("800");
    expect(handle.getAttribute("aria-valuenow")).toBe("720");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(panel.style.width).toBe("736px");
    expect(window.localStorage.getItem("dive.review-sidebar.width")).toBe("736");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(panel.style.width).toBe("720px");
    expect(window.localStorage.getItem("dive.review-sidebar.width")).toBe("720");

    fireEvent.mouseDown(handle, { button: 0, clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 100 });
    expect(panel.style.width).toBe("800px");
    expect(window.localStorage.getItem("dive.review-sidebar.width")).toBe("800");

    fireEvent.mouseMove(window, { clientX: 900 });
    expect(panel.style.width).toBe("380px");
    expect(window.localStorage.getItem("dive.review-sidebar.width")).toBe("380");
    fireEvent.mouseUp(window);

    fireEvent.doubleClick(handle);
    expect(panel.style.width).toBe("520px");
    expect(window.localStorage.getItem("dive.review-sidebar.width")).toBe("520");
  });

  it("keeps en/ko i18n key parity and removes old progressive/Sarkar copy", () => {
    const koKeys = flattenResourceKeys(koResources).sort();
    const enKeys = flattenResourceKeys(enResources).sort();

    expect(enKeys).toEqual(koKeys);
    expect(koKeys.some((key) => key.includes("progressive_"))).toBe(false);
    expect(enKeys.some((key) => key.includes("progressive_"))).toBe(false);
    expect(JSON.stringify(koResources)).not.toContain("Sarkar");
    expect(JSON.stringify(enResources)).not.toContain("Sarkar");
  });
});
