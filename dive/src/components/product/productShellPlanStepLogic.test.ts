import { describe, expect, it } from "vitest";
import type { PlanRoadmapStep } from "../../features/roadmap";
import {
  buildPlanStepExecutionPrompt,
  deriveActivePlanStepIdForChat,
  pruneCaughtUpPlanStepSessionMap,
} from "./productShellPlanStepLogic";

function roadmapStep(overrides: Partial<PlanRoadmapStep> = {}): PlanRoadmapStep {
  return {
    step: {
      id: 10,
      plan_id: 1,
      step_id: "step-001",
      title: "Create the app shell",
      summary: "Use the summary when no seed exists",
      instruction_seed: "  Build the shell with navigation.  ",
      expected_files: ["src/App.tsx", 42, "src/main.tsx"],
      acceptance_criteria: ["renders shell", null, "has navigation"],
      verification_kind: null,
      verification_command: null,
      verification_manual_check: null,
      dependencies: [],
      parallel_group: null,
      position: 1,
      created_at: 1,
      updated_at: 1,
    },
    mapping: null,
    status: "ready",
    blockedDependencies: [],
    parallelBucket: null,
    ...overrides,
  };
}

describe("product shell plan-step logic", () => {
  it("builds the auto-run prompt from instruction seed, expected files, and criteria", () => {
    expect(buildPlanStepExecutionPrompt(roadmapStep())).toBe(
      [
        "이 roadmap step을 바로 실행해 주세요.",
        "Step: step-001 - Create the app shell",
        "",
        "Build the shell with navigation.",
        "",
        "Expected files: src/App.tsx, src/main.tsx",
        "",
        "Acceptance criteria:",
        "- renders shell",
        "- has navigation",
      ].join("\n"),
    );
  });

  it("uses a summary when the instruction seed is blank", () => {
    expect(
      buildPlanStepExecutionPrompt(
        roadmapStep({
          step: {
            ...roadmapStep().step,
            instruction_seed: " ",
            summary: "  Summarized work. ",
            expected_files: null,
            acceptance_criteria: null,
          },
        }),
      ),
    ).toContain("Summarized work.");
  });

  it("prefers just-opened step ids before card mapping lookup", () => {
    expect(
      deriveActivePlanStepIdForChat({
        currentSessionId: 7,
        justOpenedPlanStepBySession: { 7: 99 },
        currentCard: { id: 20 },
        planRoadmapSteps: [roadmapStep({ mapping: { ...mapping(), card_id: 20 } })],
      }),
    ).toBe(99);
  });

  it("falls back to the current card's plan mapping", () => {
    expect(
      deriveActivePlanStepIdForChat({
        currentSessionId: 7,
        justOpenedPlanStepBySession: {},
        currentCard: { id: 20 },
        planRoadmapSteps: [
          roadmapStep({ step: { ...roadmapStep().step, id: 44 }, mapping: mapping() }),
        ],
      }),
    ).toBe(44);
  });

  it("prunes session entries once roadmap mappings catch up", () => {
    const current = { 7: 10, 8: 12 };
    expect(
      pruneCaughtUpPlanStepSessionMap(current, [
        roadmapStep({ mapping: { ...mapping(), session_id: 7, step_id: 10 } }),
      ]),
    ).toEqual({ 8: 12 });
    expect(pruneCaughtUpPlanStepSessionMap(current, [])).toBe(current);
  });
});

function mapping() {
  return {
    id: 1,
    step_id: 10,
    session_id: 7,
    card_id: 20,
    state_path: null,
    status: "in_progress",
    started_at: null,
    completed_at: null,
    checkpoint_ids: null,
    verification_status: null,
    verification_evidence: null,
    user_decision: null,
    created_at: 1,
    updated_at: 1,
  };
}
