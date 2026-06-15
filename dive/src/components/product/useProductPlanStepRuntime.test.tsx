// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("keeps auto-run for newly opened executable plan steps", async () => {
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    const item = roadmapStep();
    const opened = mapping(item.step);

    const { result } = renderHook(() =>
      useProductPlanStepRuntime({
        currentSessionId: opened.session_id,
        currentCard: null,
        planRoadmapSteps: [item],
        chat: {
          isStreaming: false,
          isTauri: true,
          sendUserMessage,
        },
      }),
    );

    act(() => result.current.rememberJustOpenedPlanStepMapping(opened));

    await waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(1));
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Step: S-010 - Reviewable step"),
      "build",
      true,
      item.step.id,
    );
  });

  it("does not send an execution prompt when opening an existing review", async () => {
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    const item = roadmapStep();
    const opened = mapping(item.step);

    const { result } = renderHook(() =>
      useProductPlanStepRuntime({
        currentSessionId: opened.session_id,
        currentCard: null,
        planRoadmapSteps: [item],
        chat: {
          isStreaming: false,
          isTauri: true,
          sendUserMessage,
        },
      }),
    );

    act(() => result.current.rememberJustOpenedPlanStepMapping(opened, { autoRun: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
