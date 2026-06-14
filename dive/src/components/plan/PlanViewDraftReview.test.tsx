// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { PlanRoadmapStep, PlanStepRow } from "../../features/roadmap";
import { PlanView } from "./PlanView";
import type { PlanViewRoadmapModel } from "./types";

function draftStep(): PlanRoadmapStep {
  const step: PlanStepRow = {
    id: 10,
    plan_id: 1,
    step_id: "S-010",
    title: "Draft-only step",
    summary: "Needs approval before execution",
    instruction_seed: null,
    expected_files: null,
    acceptance_criteria: null,
    verification_kind: null,
    verification_command: null,
    verification_manual_check: null,
    dependencies: null,
    parallel_group: null,
    position: 10,
    created_at: 1,
    updated_at: 1,
  };
  return {
    step,
    mapping: null,
    status: "ready",
    blockedDependencies: [],
    parallelBucket: null,
  };
}

describe("PlanView draft review affordance", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => cleanup());

  it("shows the plan review entrypoint and suppresses step start actions before approval", () => {
    const roadmap: PlanViewRoadmapModel = {
      status: {
        status: "draft",
        has_plan: true,
        has_approved_plan: false,
        plan_summary: "Review this plan first",
        plan_id: 1,
        step_count: 1,
        ready_count: 1,
        blocked_count: 0,
        active_count: 0,
        done_count: 0,
      },
      steps: [draftStep()],
      loading: false,
      error: null,
      hasPlan: true,
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <PlanView
        roadmap={roadmap}
        projectName="Draft project"
        actions={{
          onOpenStep: vi.fn(),
          onOpenSession: vi.fn(),
          onCreatePlan: vi.fn(),
          onReviewPlan: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId("plan-review-open")).toBeTruthy();
    expect(screen.queryByTestId("plan-step-action")).toBeNull();
  });
});
