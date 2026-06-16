// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, type ProjectSpec } from "../../features/planning";
import {
  evaluateProvocationSupervisor,
  type ProvocationCard,
  type SupervisorEvaluationResponse,
} from "../../features/provocation";
import { useProjectSessionStore } from "../../stores/project-session";
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
      target: { value: "학생이 사용량을 볼 수 있게 한다." },
    });

    const wrapper = await screen.findByTestId("plan-add-step-scope-card", {}, { timeout: 2000 });
    const card = within(wrapper).getByTestId("provocation-card");
    expect(card.closest('[data-testid="plan-add-step-panel"]')).toBeTruthy();
    expect(card.dataset.cardType).toBe("scope_expansion");
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain("기존 PRD");
    expect(
      screen.queryByText("이 추가 단계가 현재 PRD 범위와 기준 안에 들어오나요?"),
    ).toBeNull();

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
      target: { value: "학생이 사용량을 볼 수 있게 한다." },
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
      target: { value: "학생이 사용량을 볼 수 있게 한다." },
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

  it("routes scope-card actions to local affordances without silently appending a step", async () => {
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
      target: { value: "학생이 사용량을 볼 수 있게 한다." },
    });

    await screen.findByTestId("provocation-card", {}, { timeout: 2000 });
    fireEvent.click(screen.getByTestId("provocation-primary-action"));
    expect(screen.getByTestId("plan-add-step-action-route").dataset.route).toBe("link_criterion");
    expect(document.activeElement).toBe(screen.getByTestId("plan-add-step-criterion-AC-001"));

    const actions = screen.getAllByTestId("provocation-action");
    fireEvent.click(actions.find((button) => button.textContent?.includes("범위"))!);
    expect(screen.getByTestId("plan-add-step-action-route").dataset.route).toBe("split_scope");
    expect(document.activeElement).toBe(screen.getByTestId("plan-add-step-reason"));

    fireEvent.click(actions.find((button) => button.textContent?.includes("PRD"))!);
    expect(screen.getByTestId("plan-add-step-action-route").dataset.route).toBe("edit_prd");
    expect(document.activeElement).toBe(screen.getByTestId("plan-add-step-title"));
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
});
