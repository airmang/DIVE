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
      verification_kind: "command",
      verification_command: "pnpm test",
      verification_manual_check: "Open the app shell and inspect navigation.",
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
  it("builds the suggested step prompt from instruction seed, expected files, and criteria", () => {
    expect(buildPlanStepExecutionPrompt(roadmapStep())).toBe(
      [
        "다음 계획 Step만 실행해 주세요.",
        "",
        "이 내용은 DIVE의 승인된 계획에서 가져온 실행 컨텍스트입니다. 범위를 넓히지 말고 이 Step의 완료 기준만 충족하세요.",
        "",
        "Step ID: step-001",
        "Title: Create the app shell",
        "",
        "Instruction:",
        "Build the shell with navigation.",
        "",
        "Expected files:",
        "- src/App.tsx",
        "- src/main.tsx",
        "",
        "Acceptance criteria:",
        "- renders shell",
        "- has navigation",
        "",
        "Verification:",
        "- Kind: command",
        "- Command: pnpm test",
        "- Manual check: Open the app shell and inspect navigation.",
        "",
        "Execution constraints:",
        "- 필요한 파일이나 디렉터리가 아직 없으면 직접 생성하세요.",
        "- 기존 동작을 불필요하게 바꾸지 말고 위 Step 범위 안에서만 수정하세요.",
        "- 완료 후 변경한 파일, 실행한 검증, 남은 위험을 짧게 보고하세요.",
        "- 완료 기준을 충족할 수 없으면 추측하지 말고 막힌 이유와 필요한 결정을 설명하세요.",
      ].join("\n"),
    );
  });

  it("tells the agent to scaffold missing structure instead of stalling on an empty workspace", () => {
    const prompt = buildPlanStepExecutionPrompt(roadmapStep());
    expect(prompt).toContain("필요한 파일이나 디렉터리가 아직 없으면 직접 생성");
    expect(prompt).toContain("범위를 넓히지 말고");
  });

  it("preserves object-shaped criteria metadata in the execution prompt", () => {
    const prompt = buildPlanStepExecutionPrompt(
      roadmapStep({
        step: {
          ...roadmapStep().step,
          acceptance_criteria: {
            criteria: [
              { criterionId: "AC-001", text: "저장 성공 후 toast가 보인다" },
              { criterionId: "AC-002", text: "저장 중 버튼이 비활성화된다" },
            ],
            linkedCriterionIds: ["AC-001", "AC-002"],
            rationale: "저장 흐름을 먼저 구현해야 두 PRD 기준을 검증할 수 있다.",
          },
        },
      }),
    );

    expect(prompt).toContain("- 저장 성공 후 toast가 보인다");
    expect(prompt).toContain("- 저장 중 버튼이 비활성화된다");
    expect(prompt).toContain("Linked PRD criteria:\n- AC-001\n- AC-002");
    expect(prompt).toContain("Rationale:\n저장 흐름을 먼저 구현해야 두 PRD 기준을 검증할 수 있다.");
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
