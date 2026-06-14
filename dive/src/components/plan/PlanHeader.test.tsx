// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { PlanRoadmapStep, PlanStepRow } from "../../features/roadmap";
import { PlanHeader } from "./PlanHeader";
import type { PlanSummary } from "./types";

function stepRow(): PlanStepRow {
  return {
    id: 1,
    plan_id: 1,
    step_id: "S-001",
    title: "Draft review step",
    summary: "summary",
    instruction_seed: null,
    expected_files: null,
    acceptance_criteria: null,
    verification_kind: null,
    verification_command: null,
    verification_manual_check: null,
    dependencies: null,
    parallel_group: null,
    position: 1,
    created_at: 1,
    updated_at: 1,
  };
}

const summary: PlanSummary = {
  total: 1,
  completed: 0,
  ready: 1,
  blocked: 0,
  active: 0,
  percent: 0,
  overall: "in_progress",
};

function steps(): PlanRoadmapStep[] {
  return [
    {
      step: stepRow(),
      mapping: null,
      status: "ready",
      blockedDependencies: [],
      parallelBucket: null,
    },
  ];
}

describe("PlanHeader plan review action", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));
  afterEach(() => cleanup());

  it("opens the pending draft review from the plan header", () => {
    const onReviewPlan = vi.fn();
    render(
      <PlanHeader
        projectName="Draft project"
        goal="Build carefully"
        steps={steps()}
        summary={summary}
        minimapOpen={false}
        loading={false}
        planReviewPending
        onToggleMinimap={vi.fn()}
        onRefresh={vi.fn()}
        onReviewPlan={onReviewPlan}
      />,
    );

    fireEvent.click(screen.getByTestId("plan-review-open"));
    expect(onReviewPlan).toHaveBeenCalledTimes(1);
  });
});
