// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import {
  PLAN_ADD_STEP_DRAFT_REQUEST_EVENT,
  PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT,
  type ProjectSpec,
} from "../../features/planning";
import {
  evaluateProvocationSupervisor,
  type ProvocationCard,
  type SupervisorEvaluationResponse,
} from "../../features/provocation";
import { useProjectSessionStore } from "../../stores/project-session";
import { ToastProvider } from "../toast/ToastProvider";
import { PlanAddStepPanel } from "./PlanAddStepPanel";

vi.mock("../../features/provocation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../features/provocation")>();
  return {
    ...actual,
    evaluateProvocationSupervisor: vi.fn(),
  };
});

const evaluateMock = vi.mocked(evaluateProvocationSupervisor);

function projectSpec(overrides: Partial<ProjectSpec> = {}): ProjectSpec {
  return {
    projectSpecId: "spec-1",
    projectId: 1,
    currentVersion: 2,
    goal: "설정 화면 저장 흐름 개선",
    intentSummary: "저장 전후 상태를 확인한다.",
    scope: ["설정 화면 저장 버튼"],
    nonGoals: ["인증 흐름 변경 없음"],
    constraints: ["기존 라우팅 유지"],
    acceptanceCriteria: [
      {
        criterionId: "AC-001",
        text: "저장 성공 후 toast가 보인다",
        source: "student_edit",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
    ],
    architecture: null,
    fieldProvenance: {},
    status: "approved",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function supervisorScopeCard(overrides: Partial<ProvocationCard> = {}): ProvocationCard {
  return {
    id: "provocation:add-step:scope_expansion:client:evidence",
    type: "scope_expansion",
    stage: "extend",
    severity: "caution",
    title: "검토 카드",
    prompt: "이 새 단계가 기존 PRD 기준과 연결되는지 먼저 확인할까요?",
    message: "새 범위로 보이는 근거가 있습니다.",
    evidence: [
      {
        refId: "step.linkedCriterionIds",
        source: "plan",
        label: "연결된 PRD 기준",
      },
    ],
    actions: [
      { id: "link_criterion", kind: "link_criterion", label: "기준 연결" },
      { id: "split_scope", kind: "split_scope", label: "범위 나누기" },
      { id: "edit_prd", kind: "edit_prd", label: "PRD 수정" },
    ],
    primaryActionId: "link_criterion",
    metadata: {
      supervisorEvaluationId: "eval-scope",
      contextHash: "client:context",
      evidenceHash: "client:evidence",
    },
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof PlanAddStepPanel>[0]> = {}) {
  const props: Parameters<typeof PlanAddStepPanel>[0] = {
    projectId: 1,
    planId: 11,
    projectName: "DIVE demo",
    projectSpec: projectSpec(),
    busy: false,
    onAppendStep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<PlanAddStepPanel {...props} />);
  return props;
}

function lastSupervisorRequest() {
  return evaluateMock.mock.calls[evaluateMock.mock.calls.length - 1]?.[0];
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("PlanAddStepPanel scope-expansion supervisor cards", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({ currentProjectId: 1, currentSessionId: 99 });
    evaluateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    useProjectSessionStore.setState({ currentProjectId: null, currentSessionId: null });
  });

  it("places a supervisor-backed scope card near add-step without static fallback text", async () => {
    evaluateMock.mockResolvedValue({
      status: "shown",
      evaluationId: "eval-scope",
      card: supervisorScopeCard(),
    });

    renderPanel();

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });

    const wrapper = await screen.findByTestId("plan-add-step-scope-card", {}, { timeout: 2000 });
    const card = within(wrapper).getByTestId("provocation-card");
    expect(card.closest('[data-testid="plan-add-step-panel"]')).toBeTruthy();
    expect(card.dataset.cardType).toBe("scope_expansion");
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain("기존 PRD");
    expect(screen.queryByText("이 추가 단계가 현재 PRD 범위와 기준 안에 들어오나요?")).toBeNull();

    await waitFor(() => expect(evaluateMock).toHaveBeenCalled());
    const request = lastSupervisorRequest();
    expect(request).toMatchObject({
      sessionId: 99,
      event: "scope_expansion",
      projectId: 1,
      planId: 11,
      artifactRef: expect.objectContaining({ kind: "add_step_draft" }),
      allowedActionIds: ["link_criterion", "split_scope", "edit_prd", "dismiss_review"],
      scopeExpansion: expect.objectContaining({
        expanded: true,
        reasonCodes: expect.arrayContaining(["missing_criterion_link", "new_scope_area"]),
      }),
    });
    if (request?.event !== "scope_expansion") {
      throw new Error("expected scope_expansion request");
    }
    expect(request.evidenceRefs.map((ref) => ref.id)).toEqual(
      expect.arrayContaining(["step.linkedCriterionIds", "prdDelta.scopeChanges[0]"]),
    );
  });

  it("waits for a reviewable draft before invoking the scope supervisor", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });

    renderPanel();

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    await wait(700);
    expect(evaluateMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });
    await wait(600);
    expect(evaluateMock).not.toHaveBeenCalled();

    await waitFor(() => expect(evaluateMock).toHaveBeenCalledTimes(1));
  });

  it("keeps save non-blocking while supervisor evaluation is pending or dropped", async () => {
    let resolveEvaluation: (value: SupervisorEvaluationResponse) => void = () => {};
    evaluateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveEvaluation = resolve;
      }),
    );
    const onAppendStep = vi.fn().mockResolvedValue(undefined);

    renderPanel({ onAppendStep });

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });

    await waitFor(() => expect(evaluateMock).toHaveBeenCalled());
    expect(screen.queryByTestId("plan-add-step-scope-card")).toBeNull();

    const save = screen.getByTestId("plan-add-step-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(onAppendStep).toHaveBeenCalledTimes(1));
    resolveEvaluation?.({
      status: "dropped",
      evaluationId: "eval-timeout",
      dropReason: "timeout",
    });
    await waitFor(() => expect(screen.queryByTestId("plan-add-step-scope-card")).toBeNull());
    expect(screen.queryByText("이 추가 단계가 현재 PRD 범위와 기준 안에 들어오나요?")).toBeNull();
  });

  it("surfaces scope-review unavailable when expanded scope has no active session", async () => {
    useProjectSessionStore.setState({ currentProjectId: 1, currentSessionId: null });
    const onAppendStep = vi.fn().mockResolvedValue(undefined);

    renderPanel({ onAppendStep });

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });

    const unavailable = await screen.findByTestId("plan-add-step-scope-review-unavailable");
    expect(unavailable.dataset.reason).toBe("no_active_session");
    expect(unavailable.textContent).toContain("범위 검토 사용 불가");
    expect(unavailable.textContent).toContain("저장은 계속 가능합니다");
    await wait(700);
    expect(evaluateMock).not.toHaveBeenCalled();

    const save = screen.getByTestId("plan-add-step-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(onAppendStep).toHaveBeenCalledTimes(1));
  });

  it("shows the scope-expansion card as a pure provocation without revise buttons or appending a step", async () => {
    const onAppendStep = vi.fn().mockResolvedValue(undefined);
    evaluateMock.mockResolvedValue({
      status: "shown",
      evaluationId: "eval-scope",
      card: supervisorScopeCard(),
    });

    renderPanel({ onAppendStep });

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });

    await screen.findByTestId("provocation-card", {}, { timeout: 2000 });

    // Pure provocation: the "revise the scope/PRD" nudges only seed a prompt or
    // focus a field, so they are not shown as buttons — the card prompts the
    // user to think and they drive the follow-up.
    expect(screen.queryByTestId("provocation-primary-action")).toBeNull();
    expect(screen.queryByText("기준 연결")).toBeNull();
    expect(screen.queryByText("범위 나누기")).toBeNull();
    expect(screen.queryByText("PRD 수정")).toBeNull();
    // Showing the card never silently appends a step.
    expect(onAppendStep).not.toHaveBeenCalled();
  });

  it("shows accepted rationale offers as reviewable plan-area suggestions without saving", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const props = renderPanel();

    window.dispatchEvent(
      new CustomEvent(PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, {
        detail: {
          projectId: 1,
          planId: 11,
          stepDbId: 101,
          objectionId: "obj-step-001",
          offerId: "offer:obj-step-001",
          offerKind: "redecompose_step",
          message: "계획 영역에서 이 단계를 다시 나누는 제안을 검토할 수 있어요.",
          suggestedSeed: "'저장 상태 분리' 단계 재분해 검토",
        },
      }),
    );

    const suggestion = await screen.findByTestId("plan-adjustment-review-suggestion");
    expect(suggestion.textContent).toContain("'저장 상태 분리' 단계 재분해 검토");
    expect((screen.getByTestId("plan-add-step-reason") as HTMLTextAreaElement).value).toBe(
      "'저장 상태 분리' 단계 재분해 검토",
    );
    expect(props.onAppendStep).not.toHaveBeenCalled();
  });

  it("prefills chat-routed add-step drafts without appending until save", async () => {
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
    const onAppendStep = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onAppendStep });

    window.dispatchEvent(
      new CustomEvent(PLAN_ADD_STEP_DRAFT_REQUEST_EVENT, {
        detail: {
          projectId: 1,
          planId: 11,
          source: "chat_route",
          reason: "new implementation request",
          draft: {
            stepId: "step-002",
            title: "Export mutation data",
            summary: "Add export reconstruction for plan mutations.",
            instructionSeed: "Implement export reconstruction for plan mutations.",
            expectedFiles: ["src/workspace_plan/artifacts.rs"],
            acceptanceCriteria: ["Plan mutations appear in export."],
            linkedCriterionIds: ["AC-001"],
            rationale: "Export is required for research reconstruction.",
            verificationCommand: "cargo test export",
            verificationType: "test",
            dependencies: ["step-001"],
            parallelGroup: 2,
            position: 2,
          },
        },
      }),
    );

    await waitFor(() =>
      expect((screen.getByTestId("plan-add-step-title") as HTMLInputElement).value).toBe(
        "Export mutation data",
      ),
    );
    expect(screen.getByTestId("plan-add-step-draft-notice").textContent).toContain(
      "채팅에서 감지한 초안",
    );
    expect(onAppendStep).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("plan-add-step-save"));

    await waitFor(() => expect(onAppendStep).toHaveBeenCalledTimes(1));
    expect(onAppendStep).toHaveBeenCalledWith({
      planId: 11,
      mutationReason: "Add export reconstruction for plan mutations.",
      linkedCriterionIds: ["AC-001"],
      prdDelta: expect.objectContaining({
        scopeChanges: ["Export mutation data"],
      }),
      draft: expect.objectContaining({
        title: "Export mutation data",
        verificationCommand: "cargo test export",
        verificationType: "test",
        dependencies: ["step-001"],
        parallelGroup: 2,
      }),
    });
  });
});

describe("PlanAddStepPanel post-save refresh failures", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({ currentProjectId: 1, currentSessionId: 99 });
    evaluateMock.mockReset();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
  });

  afterEach(() => {
    cleanup();
    useProjectSessionStore.setState({ currentProjectId: null, currentSessionId: null });
  });

  it("does not surface a mutation-failed toast when a post-success refresh rejects", async () => {
    const onAppendStep = vi.fn().mockResolvedValue(undefined);
    const onAppended = vi.fn().mockRejectedValue(new Error("refresh failed"));

    render(
      <ToastProvider>
        <PlanAddStepPanel
          projectId={1}
          planId={11}
          projectName="DIVE demo"
          projectSpec={projectSpec()}
          onAppendStep={onAppendStep}
          onAppended={onAppended}
        />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });

    fireEvent.click(screen.getByTestId("plan-add-step-save"));

    await waitFor(() => expect(onAppendStep).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onAppended).toHaveBeenCalledTimes(1));

    // The step mutation succeeded; the refresh's own rejection must not be
    // relabeled as "could not save step".
    expect(screen.queryByTestId("toast")).toBeNull();
    // The form still resets, confirming the save path completed normally.
    expect((screen.getByTestId("plan-add-step-title") as HTMLInputElement).value).toBe("");
  });
});

describe("PlanAddStepPanel scope-expansion supervisor locale", () => {
  beforeEach(() => {
    useProjectSessionStore.setState({ currentProjectId: 1, currentSessionId: 99 });
    evaluateMock.mockReset();
    evaluateMock.mockResolvedValue({
      status: "none",
      evaluationId: "eval-none",
      dropReason: "provoke_false",
    });
  });

  afterEach(() => {
    cleanup();
    useProjectSessionStore.setState({ currentProjectId: null, currentSessionId: null });
    useLocaleStore.setState({ locale: "ko" });
  });

  it("threads the active en-locale into the scope-expansion supervisor request instead of hardcoding ko-KR", async () => {
    useLocaleStore.setState({ locale: "en" });

    renderPanel();

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "Let users see their usage." },
    });

    await waitFor(() => expect(evaluateMock).toHaveBeenCalled());
    const request = lastSupervisorRequest();
    expect(request?.locale).toBe("en");
    if (request?.event !== "scope_expansion") {
      throw new Error("expected scope_expansion request");
    }
    // Evidence-ref labels must localize with the active locale, not stay
    // hardcoded in Korean.
    const titleRef = request.evidenceRefs.find((ref) => ref.id === "step.title");
    expect(titleRef?.label).toBe("Add-step title");
    expect(titleRef?.label).not.toBe("추가 단계 제목");
  });

  it("threads the active ko-locale into the scope-expansion supervisor request", async () => {
    useLocaleStore.setState({ locale: "ko" });

    renderPanel();

    fireEvent.change(screen.getByTestId("plan-add-step-title"), {
      target: { value: "Analytics dashboard" },
    });
    fireEvent.change(screen.getByTestId("plan-add-step-reason"), {
      target: { value: "사용자가 사용량을 볼 수 있게 한다." },
    });

    await waitFor(() => expect(evaluateMock).toHaveBeenCalled());
    const request = lastSupervisorRequest();
    expect(request?.locale).toBe("ko");
    expect(request?.locale).not.toBe("ko-KR");
  });
});
