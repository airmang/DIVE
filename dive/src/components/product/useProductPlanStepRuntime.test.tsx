// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanRoadmapStep, PlanStepRow, StepSessionMappingRow } from "../../features/roadmap";
import { useProductPlanStepRuntime } from "./useProductPlanStepRuntime";

function stepRow(): PlanStepRow {
  return {
    id: 10,
    plan_id: 1,
    step_id: "S-010",
    title: "Reviewable step",
    summary: "Check the result",
    instruction_seed: "Implement the thing",
    expected_files: ["src/App.tsx"],
    acceptance_criteria: ["The result works"],
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

function mapping(row = stepRow()): StepSessionMappingRow {
  return {
    id: 1,
    step_id: row.id,
    session_id: 7,
    card_id: 70,
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

describe("useProductPlanStepRuntime", () => {
  it("exposes a suggested prompt for newly opened executable plan steps without sending", () => {
    const item = roadmapStep();
    const opened = mapping(item.step);

    const { result } = renderHook(() =>
      useProductPlanStepRuntime({
        currentSessionId: opened.session_id,
        currentCard: null,
        planRoadmapSteps: [item],
      }),
    );

    act(() => result.current.rememberJustOpenedPlanStepMapping(opened));

    expect(result.current.pendingPlanStepPrompt?.stepId).toBe(item.step.id);
    expect(result.current.pendingPlanStepPrompt?.prompt).toContain("Step ID: S-010");
    expect(result.current.pendingPlanStepPrompt?.prompt).toContain("Title: Reviewable step");

    act(() => result.current.clearPendingPlanStepPrompt());

    expect(result.current.pendingPlanStepPrompt).toBeNull();
  });

  it("does not suggest an execution prompt when opening an existing review", async () => {
    const item = roadmapStep();
    const opened = mapping(item.step);

    const { result } = renderHook(() =>
      useProductPlanStepRuntime({
        currentSessionId: opened.session_id,
        currentCard: null,
        planRoadmapSteps: [item],
      }),
    );

    act(() => result.current.rememberJustOpenedPlanStepMapping(opened, { suggestPrompt: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pendingPlanStepPrompt).toBeNull();
  });
});
