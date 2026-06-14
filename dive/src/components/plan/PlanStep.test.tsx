// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
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
