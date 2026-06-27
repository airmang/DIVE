import { describe, expect, it } from "vitest";
import {
  decodePlanDraftQualityError,
  decodeWorkspacePlanDraftFromLlm,
} from "./usePlanInterviewLLM";

describe("decodeWorkspacePlanDraftFromLlm criterion-linked decomposition", () => {
  it("decodes object-form criteria, linked criterion ids, and step rationale", () => {
    const decoded = decodeWorkspacePlanDraftFromLlm({
      planDraft: {
        intentSummary: "저장 상태를 사용자가 확인할 수 있게 한다.",
        unresolvedQuestions: [],
        planInput: {
          goal: "설정 화면 저장 흐름 개선",
          scope: ["설정 저장 UI"],
          nonGoals: ["인증 변경 없음"],
          constraints: ["기존 라우팅 유지"],
          acceptanceCriteria: [
            {
              criterionId: "AC-001",
              text: "저장 성공 후 toast가 보인다",
              source: "student_edit",
              status: "active",
              createdInVersion: 1,
              retiredInVersion: null,
            },
          ],
          steps: [
            {
              stepId: "step-001",
              title: "저장 버튼 상태 정리",
              summary: "저장 중/완료 상태를 화면에 표시한다.",
              instructionSeed: "설정 화면 저장 버튼 상태를 정리한다.",
              expectedFiles: ["src/settings/SettingsPage.tsx"],
              acceptanceCriteria: [
                {
                  criterionId: "AC-001",
                  text: "저장 성공 후 toast가 보인다",
                  source: "student_edit",
                  status: "active",
                  createdInVersion: 1,
                  retiredInVersion: null,
                },
              ],
              linkedCriterionIds: ["AC-001"],
              rationale: "저장 완료 여부를 확인하는 기준을 먼저 구현해야 AC-001을 검증할 수 있다.",
              verificationCommand: "pnpm test SettingsPage",
              verificationType: "command",
              dependencies: [],
              parallelGroup: null,
            },
          ],
        },
      },
    });

    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error("expected decoded plan draft");
    const criterion = decoded.planInput.acceptanceCriteria[0];
    const step = decoded.planInput.steps[0];
    if (!step) throw new Error("expected decoded plan step");
    expect(criterion).toMatchObject({
      criterionId: "AC-001",
      text: "저장 성공 후 toast가 보인다",
    });
    expect(step.acceptanceCriteria[0]).toMatchObject({
      criterionId: "AC-001",
      text: "저장 성공 후 toast가 보인다",
    });
    expect(step.linkedCriterionIds).toEqual(["AC-001"]);
    expect(step.rationale).toBe(
      "저장 완료 여부를 확인하는 기준을 먼저 구현해야 AC-001을 검증할 수 있다.",
    );
    expect(step.verificationType).toBe("test");
  });

  it("keeps legacy string criteria readable through migration adapters", () => {
    const decoded = decodeWorkspacePlanDraftFromLlm({
      intentSummary: "기존 문자열 기준도 읽을 수 있어야 한다.",
      planInput: {
        goal: "기존 계획 가져오기",
        scope: [],
        nonGoals: [],
        constraints: [],
        acceptanceCriteria: ["저장 성공 후 toast가 보인다"],
        steps: [
          {
            title: "문자열 기준 읽기",
            summary: "legacy criteria array를 화면에 연결한다.",
            instructionSeed: "legacy criteria adapter를 사용한다.",
            expectedFiles: ["src/settings/SettingsPage.tsx"],
            acceptanceCriteria: ["저장 성공 후 toast가 보인다"],
            linkedCriterionIds: ["AC-001"],
            rationale: "마이그레이션된 AC-001 기준을 계속 보여주기 위해 필요하다.",
            dependencies: [],
          },
        ],
      },
    });

    expect(decoded).not.toBeNull();
    if (!decoded) throw new Error("expected decoded plan draft");
    const planCriterion = decoded.planInput.acceptanceCriteria[0];
    const step = decoded.planInput.steps[0];
    if (!step) throw new Error("expected decoded plan step");
    expect(planCriterion).toMatchObject({
      criterionId: "AC-001",
      text: "저장 성공 후 toast가 보인다",
      source: "migration",
    });
    expect(step.acceptanceCriteria[0]).toMatchObject({
      criterionId: "AC-001",
      text: "저장 성공 후 toast가 보인다",
      source: "migration",
    });
    expect(step.linkedCriterionIds).toEqual(["AC-001"]);
    expect(step.rationale).toContain("AC-001");
  });
});

describe("decodePlanDraftQualityError", () => {
  it("maps backend quality errors to recovery reasons and unresolved questions", () => {
    const decoded = decodePlanDraftQualityError(
      new Error(
        'PLAN_DRAFT_QUALITY_ERROR:{"code":"plan_draft_quality","reason":"missing_state_criteria","unresolved_questions":["empty state","error state"]}',
      ),
    );

    expect(decoded).toMatchObject({
      reason: "missing_state_criteria",
      finishReason: null,
      unresolvedQuestions: ["empty state", "error state"],
    });
  });
});
