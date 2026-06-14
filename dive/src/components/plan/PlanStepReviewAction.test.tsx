// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { PlanRoadmapStep, PlanStepRow, StepSessionMappingRow } from "../../features/roadmap";
import { PlanStep } from "./PlanStep";
import { PlanStepActions } from "./PlanStepActions";

function stepRow(): PlanStepRow {
  return {
    id: 4,
    plan_id: 1,
    step_id: "S-004",
    title: "Reviewable step",
    summary: "summary",
    instruction_seed: null,
    expected_files: null,
    acceptance_criteria: null,
    verification_kind: null,
    verification_command: null,
    verification_manual_check: null,
    dependencies: null,
    parallel_group: null,
    position: 4,
    created_at: 1,
    updated_at: 1,
  };
}

function mapping(row: PlanStepRow): StepSessionMappingRow {
  return {
    id: 40,
    step_id: row.id,
    session_id: 140,
    card_id: 440,
    state_path: row.step_id,
    status: "in_progress",
    started_at: 1,
    completed_at: null,
    checkpoint_ids: null,
    verification_status: null,
    verification_evidence: null,
    user_decision: null,
    created_at: 1,
    updated_at: 1,
  };
}

function roadmapStep(): PlanRoadmapStep {
  const row = stepRow();
  return {
    step: row,
    mapping: mapping(row),
    status: "in_progress",
    blockedDependencies: [],
    parallelBucket: null,
  };
}

describe("PlanStepActions review affordance", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));
  afterEach(() => cleanup());

  it("uses the right-side action button to reopen mapped step review/details", () => {
    const onReview = vi.fn();
    render(
      <PlanStepActions
        item={roadmapStep()}
        busy={false}
        onStart={vi.fn()}
        onResume={vi.fn()}
        onOpen={vi.fn()}
        onReview={onReview}
      />,
    );

    const button = screen.getByTestId("plan-step-action");
    expect(button.getAttribute("data-action")).toBe("review");
    fireEvent.click(button);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("opens mapped step details from the step title instead of resuming chat", () => {
    const onOpenStep = vi.fn().mockResolvedValue(mapping(stepRow()));
    const onOpenSession = vi.fn();
    render(
      <PlanStep
        item={roadmapStep()}
        current={false}
        busy={false}
        lineUp="none"
        lineDown="none"
        actions={{
          onOpenStep,
          onOpenSession,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("plan-step-open"));

    expect(onOpenSession).not.toHaveBeenCalled();
    expect(onOpenStep).toHaveBeenCalledWith(4, { focus: true, openDetail: true });
  });
});
