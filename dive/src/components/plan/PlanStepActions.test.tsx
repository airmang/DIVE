// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { PlanRoadmapStep, PlanStepRow, StepSessionMappingRow } from "../../features/roadmap";
import { PlanStepActions } from "./PlanStepActions";

function stepRow(overrides: Partial<PlanStepRow> = {}): PlanStepRow {
  return {
    id: 7,
    plan_id: 1,
    step_id: "S-007",
    title: "Blocked step",
    summary: "summary",
    instruction_seed: null,
    expected_files: null,
    acceptance_criteria: null,
    verification_kind: null,
    verification_command: null,
    verification_manual_check: null,
    dependencies: [],
    parallel_group: null,
    position: 7,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function mapping(overrides: Partial<StepSessionMappingRow> = {}): StepSessionMappingRow {
  return {
    id: 70,
    step_id: 7,
    session_id: 170,
    card_id: null,
    state_path: null,
    status: "blocked",
    started_at: 1,
    completed_at: null,
    checkpoint_ids: null,
    verification_status: null,
    verification_evidence: null,
    user_decision: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function renderActions(item: PlanRoadmapStep) {
  const onStart = vi.fn();
  const onResume = vi.fn();
  const onOpen = vi.fn();
  const onReview = vi.fn();
  render(
    <PlanStepActions
      item={item}
      busy={false}
      onStart={onStart}
      onResume={onResume}
      onOpen={onOpen}
      onReview={onReview}
    />,
  );
  return { onStart, onResume, onOpen, onReview };
}

describe("PlanStepActions — blocked branch (S-054/D2)", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));
  afterEach(() => cleanup());

  it("renders a resume action and fires onResume with the session id when rate-limit-blocked (mapping has a session)", () => {
    const item: PlanRoadmapStep = {
      step: stepRow(),
      mapping: mapping(),
      status: "blocked",
      blockedDependencies: [],
      parallelBucket: null,
    };
    const { onResume } = renderActions(item);
    const button = screen.getByTestId("plan-step-action") as HTMLButtonElement;
    expect(button.getAttribute("data-action")).toBe("resume-blocked");
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onResume).toHaveBeenCalledWith(170);
  });

  it("renders the disabled locked button when dependency-locked (no mapping)", () => {
    const item: PlanRoadmapStep = {
      step: stepRow(),
      mapping: null,
      status: "blocked",
      blockedDependencies: ["S-006"],
      parallelBucket: null,
    };
    const { onResume } = renderActions(item);
    const button = screen.getByTestId("plan-step-action") as HTMLButtonElement;
    expect(button.getAttribute("data-action")).toBe("locked");
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("PlanStepActions — regression for ready/in_progress/done", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));
  afterEach(() => cleanup());

  it("renders start for a ready step", () => {
    const item: PlanRoadmapStep = {
      step: stepRow({ id: 1, step_id: "S-001" }),
      mapping: null,
      status: "ready",
      blockedDependencies: [],
      parallelBucket: null,
    };
    renderActions(item);
    expect(screen.getByTestId("plan-step-action").getAttribute("data-action")).toBe("start");
  });

  it("renders resume for an in_progress step without a card", () => {
    const item: PlanRoadmapStep = {
      step: stepRow({ id: 2, step_id: "S-002" }),
      mapping: mapping({
        id: 20,
        step_id: 2,
        session_id: 220,
        card_id: null,
        status: "in_progress",
      }),
      status: "in_progress",
      blockedDependencies: [],
      parallelBucket: null,
    };
    const { onResume } = renderActions(item);
    const button = screen.getByTestId("plan-step-action") as HTMLButtonElement;
    expect(button.getAttribute("data-action")).toBe("resume");
    fireEvent.click(button);
    expect(onResume).toHaveBeenCalledWith(220);
  });

  it("renders open for a done step", () => {
    const item: PlanRoadmapStep = {
      step: stepRow({ id: 3, step_id: "S-003" }),
      mapping: mapping({ id: 30, step_id: 3, session_id: 330, card_id: null, status: "done" }),
      status: "done",
      blockedDependencies: [],
      parallelBucket: null,
    };
    renderActions(item);
    expect(screen.getByTestId("plan-step-action").getAttribute("data-action")).toBe("open");
  });
});
