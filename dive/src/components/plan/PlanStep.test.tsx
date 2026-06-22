// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT } from "../../features/planning";
import type {
  PlanRoadmapStatus,
  PlanRoadmapStep,
  PlanStepRow,
  StepSessionMappingRow,
} from "../../features/roadmap";
import type { PlanActionHandlers } from "./types";
import { PlanStep } from "./PlanStep";

function mappingFor(row: PlanStepRow, status: string): StepSessionMappingRow {
  return {
    id: row.id,
    step_id: row.id,
    session_id: 1000 + row.id,
    card_id: null,
    state_path: null,
    status,
    started_at: 1,
    completed_at: status === "done" || status === "shipped" ? 2 : null,
    checkpoint_ids: null,
    verification_status: null,
    verification_evidence: null,
    user_decision: null,
    created_at: 1,
    updated_at: 1,
  };
}

function makeStep(
  id: number,
  stableId: string,
  status: PlanRoadmapStatus,
  deps: string[] = [],
): PlanRoadmapStep {
  const row: PlanStepRow = {
    id,
    plan_id: 1,
    step_id: stableId,
    title: `${stableId} title`,
    summary: `${stableId} summary`,
    instruction_seed: null,
    expected_files: null,
    acceptance_criteria: null,
    verification_kind: null,
    verification_command: null,
    verification_manual_check: null,
    dependencies: deps,
    parallel_group: null,
    position: id,
    created_at: 1,
    updated_at: 1,
  };
  return {
    step: row,
    mapping: status === "ready" || status === "blocked" ? null : mappingFor(row, status),
    status,
    blockedDependencies: status === "blocked" ? deps : [],
    parallelBucket: null,
  };
}

function renderStep(item: PlanRoadmapStep, actions: PlanActionHandlers) {
  return render(
    <PlanStep
      item={item}
      current={false}
      busy={false}
      lineUp="none"
      lineDown="none"
      actions={actions}
    />,
  );
}

function makeActions(overrides: Partial<PlanActionHandlers> = {}): PlanActionHandlers {
  return {
    onOpenStep: vi.fn().mockResolvedValue(mappingFor({ id: 1 } as PlanStepRow, "in_progress")),
    onOpenSession: vi.fn(),
    ...overrides,
  };
}

describe("PlanStep — Locked reason (U-1)", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));
  afterEach(() => cleanup());

  it("names the blocking steps on the disabled Locked action", () => {
    renderStep(makeStep(7, "S-007", "blocked", ["S-005", "S-006"]), makeActions());
    const locked = screen.getByTestId("plan-step-action") as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(locked.getAttribute("title")).toContain("S-005 · S-006");
    expect(locked.getAttribute("aria-label")).toContain("S-005 · S-006");
  });

  it("falls back to a generic reason when no dependency ids are known", () => {
    const item = makeStep(7, "S-007", "blocked", []);
    renderStep(item, makeActions());
    const locked = screen.getByTestId("plan-step-action");
    expect(locked.getAttribute("title")).toMatch(/previous step/i);
  });
});

describe("PlanStep — row click affordance (U-2)", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));
  afterEach(() => cleanup());

  it("opens a ready step via the row text region", () => {
    const actions = makeActions();
    renderStep(makeStep(3, "S-003", "ready"), actions);
    fireEvent.click(screen.getByTestId("plan-step-open"));
    expect(actions.onOpenStep).toHaveBeenCalledWith(3, expect.objectContaining({ focus: true }));
  });

  it("resumes a done step's session via the row text region", () => {
    const actions = makeActions();
    renderStep(makeStep(2, "S-002", "done"), actions);
    fireEvent.click(screen.getByTestId("plan-step-open"));
    expect(actions.onOpenSession).toHaveBeenCalledWith(1002);
  });

  it("activates the row via keyboard (Enter)", () => {
    const actions = makeActions();
    renderStep(makeStep(3, "S-003", "ready"), actions);
    fireEvent.keyDown(screen.getByTestId("plan-step-open"), { key: "Enter" });
    expect(actions.onOpenStep).toHaveBeenCalledWith(3, expect.objectContaining({ focus: true }));
  });

  it("does not expose a clickable row for a blocked (locked) step", () => {
    renderStep(makeStep(7, "S-007", "blocked", ["S-005"]), makeActions());
    expect(screen.queryByTestId("plan-step-open")).toBeNull();
  });
});

function stepWithRationale(
  id: number,
  stableId: string,
  status: PlanRoadmapStatus,
): PlanRoadmapStep {
  return {
    ...makeStep(id, stableId, status),
    linkedCriteria: [{ criterionId: "AC-001", text: "저장 성공 후 toast가 보인다" }],
    decompositionRationale: "저장 완료 기준을 검증하려면 버튼 상태를 먼저 분리해야 한다.",
  };
}

describe("PlanStep — rationale challenge placement", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "ko" }));
  afterEach(() => cleanup());

  it("offers an interactive rationale challenge on a not-yet-complete step", async () => {
    const onChallenge = vi.fn().mockResolvedValue({
      objectionId: "obj-001",
      suggestionStatus: "offered",
      offerId: "offer-001",
      offerKind: "adjust_plan",
      message: "현재 계획 영역에서 이 단계를 다시 조정해볼 수 있어요.",
      suggestedSeed: "저장 기준을 검증하는 순서로 계획을 조정한다.",
    });
    const onAcceptOffer = vi.fn().mockResolvedValue({
      objectionId: "obj-001",
      offerId: "offer-001",
      suggestionStatus: "accepted",
    });
    const onDismissOffer = vi.fn();
    const events: CustomEvent[] = [];
    const handler = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener(PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, handler);

    renderStep(
      stepWithRationale(20, "S-020", "ready"),
      makeActions({
        rationaleChallenge: { projectId: 1, onChallenge, onAcceptOffer, onDismissOffer },
      }),
    );

    expect(screen.getByTestId("step-detail-rationale").textContent).toContain("저장 완료 기준");

    fireEvent.click(screen.getByTestId("step-rationale-challenge-toggle"));
    fireEvent.change(screen.getByTestId("step-rationale-challenge-input"), {
      target: { value: "이 단계를 먼저 해야 하는 이유가 불분명해요." },
    });
    fireEvent.click(screen.getByTestId("step-rationale-challenge-submit"));

    await waitFor(() =>
      expect(onChallenge).toHaveBeenCalledWith({
        planId: 1,
        stepDbId: 20,
        text: "이 단계를 먼저 해야 하는 이유가 불분명해요.",
        linkedCriterionIds: ["AC-001"],
      }),
    );
    expect((await screen.findByTestId("step-rationale-challenge-offer")).textContent).toContain(
      "현재 계획 영역",
    );

    fireEvent.click(screen.getByTestId("step-rationale-offer-accept"));
    await waitFor(() =>
      expect(onAcceptOffer).toHaveBeenCalledWith({
        planId: 1,
        stepDbId: 20,
        objectionId: "obj-001",
        offerId: "offer-001",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      projectId: 1,
      planId: 1,
      stepDbId: 20,
      offerKind: "adjust_plan",
    });

    window.removeEventListener(PLAN_ADJUSTMENT_REVIEW_REQUEST_EVENT, handler);
  });

  it("hides the rationale challenge on a completed step", () => {
    renderStep(
      stepWithRationale(21, "S-021", "done"),
      makeActions({
        rationaleChallenge: {
          projectId: 1,
          onChallenge: vi.fn(),
          onAcceptOffer: vi.fn(),
          onDismissOffer: vi.fn(),
        },
      }),
    );
    expect(screen.queryByTestId("step-rationale-challenge-toggle")).toBeNull();
    expect(screen.getByTestId("plan-step-criteria").textContent).toContain("저장 완료 기준");
  });

  it("shows static rationale without a challenge when no handlers are provided", () => {
    renderStep(stepWithRationale(22, "S-022", "ready"), makeActions());
    expect(screen.queryByTestId("step-rationale-challenge-toggle")).toBeNull();
    expect(screen.getByTestId("plan-step-criteria").textContent).toContain("저장 완료 기준");
  });
});
