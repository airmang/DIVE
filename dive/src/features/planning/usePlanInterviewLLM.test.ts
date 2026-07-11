import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import {
  buildIssueLines,
  collectRecoveryExamples,
  decodePlanDraftQualityError,
  decodeWorkspacePlanDraftFromLlm,
  type PlanDraftQualityIssue,
} from "./usePlanInterviewLLM";

const en = (key: string, params?: Record<string, string | number>) => translate("en", key, params);
const ko = (key: string, params?: Record<string, string | number>) => translate("ko", key, params);

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
    // S-050 D4 backward compat: an older payload with no `issues` field
    // must not fabricate one.
    expect(decoded?.issues).toBeUndefined();
  });

  // S-050 D4: the `issues` array is additive on the same envelope.
  it("decodes the machine-coded issues array alongside unresolved_questions", () => {
    const decoded = decodePlanDraftQualityError(
      new Error(
        'PLAN_DRAFT_QUALITY_ERROR:{"code":"plan_draft_quality","reason":"missing_state_criteria","unresolved_questions":["responsive behavior"],"issues":[{"code":"missing_state_class","missing_class":"responsive"},{"code":"criterion_too_short","preview":"make it nice"}]}',
      ),
    );

    expect(decoded?.issues).toEqual<PlanDraftQualityIssue[]>([
      { code: "missing_state_class", missingClass: "responsive" },
      { code: "criterion_too_short", preview: "make it nice" },
    ]);
  });

  it("keeps an unrecognized issue code instead of throwing", () => {
    const decoded = decodePlanDraftQualityError(
      new Error(
        'PLAN_DRAFT_QUALITY_ERROR:{"code":"plan_draft_quality","reason":"vague_criteria","unresolved_questions":["x"],"issues":[{"code":"future_issue_code","preview":"whatever"}]}',
      ),
    );

    expect(decoded?.issues).toEqual([{ code: "future_issue_code", preview: "whatever" }]);
  });
});

describe("buildIssueLines", () => {
  it("renders localized lines per issue code with interpolated params", () => {
    const issues: PlanDraftQualityIssue[] = [
      { code: "criteria_empty" },
      { code: "criterion_too_short", preview: "make it nice" },
      { code: "step_unverifiable", stepRef: "Add todo item" },
      { code: "missing_state_class", missingClass: "responsive" },
    ];

    expect(buildIssueLines(issues, en)).toEqual([
      "The acceptance criteria list is empty. Add at least one independently checkable criterion.",
      'Acceptance criterion is too short: "make it nice"',
      'Step "Add todo item" has no checkable acceptance criterion.',
      "Missing acceptance criteria for responsive behavior.",
    ]);
    expect(buildIssueLines(issues, ko)).toEqual([
      "완료 기준이 비어 있습니다. 독립적으로 확인 가능한 완료 기준을 최소 1개 추가하세요.",
      '완료 기준이 너무 짧습니다: "make it nice"',
      '"Add todo item" 단계에 확인 가능한 완료 기준이 없습니다.',
      "반응형 동작 관련 완료 기준이 빠졌습니다.",
    ]);
  });

  it("falls back to the raw preview/code for an unrecognized issue code", () => {
    const issues: PlanDraftQualityIssue[] = [{ code: "future_issue_code", preview: "whatever" }];
    expect(buildIssueLines(issues, en)).toEqual(["whatever"]);

    const noPreview: PlanDraftQualityIssue[] = [{ code: "future_issue_code" }];
    expect(buildIssueLines(noPreview, en)).toEqual(["future_issue_code"]);
  });
});

describe("collectRecoveryExamples", () => {
  it("includes both marker examples for a marker-shaped issue and dedupes across repeats", () => {
    const issues: PlanDraftQualityIssue[] = [
      { code: "plan_no_marker" },
      { code: "step_unverifiable", stepRef: "Add todo item" },
    ];

    expect(collectRecoveryExamples(issues, en)).toEqual([
      "Clicking a completed item shows a strikethrough",
      "Adding 3 tasks shows 3 items in the list",
    ]);
  });

  it("includes the class-specific example for a missing_state_class issue", () => {
    const issues: PlanDraftQualityIssue[] = [
      { code: "missing_state_class", missingClass: "loading" },
      { code: "missing_state_class", missingClass: "empty" },
    ];

    expect(collectRecoveryExamples(issues, en)).toEqual([
      "A loading spinner appears while the data request is pending.",
      "An empty state message appears when the list has no items.",
    ]);
  });

  it("combines marker and class examples without duplicates", () => {
    const issues: PlanDraftQualityIssue[] = [
      { code: "criterion_too_short", preview: "x" },
      { code: "missing_state_class", missingClass: "responsive" },
    ];

    expect(collectRecoveryExamples(issues, ko)).toEqual([
      "완료한 항목을 클릭하면 취소선이 표시된다",
      "할 일 3개를 추가하면 목록에 3개 항목이 보인다",
      "화면 너비가 768px 미만이면 그리드가 3열에서 1열로 바뀐다",
    ]);
  });
});

// S-050 D4 acceptance mapping item: the same buildIssueLines/collectRecoveryExamples
// output that feeds the recovery screen also feeds the retry-prompt's
// {{missing}}/{{examples}} params (useProductShellController's
// handleRetryPlanDraft), so the regeneration prompt carries concrete
// passing targets instead of raw English marker-category prose.
describe("issue helpers feeding the compact retry prompt", () => {
  it("builds a retry prompt containing the localized issue line and a self-passing example", () => {
    const issues: PlanDraftQualityIssue[] = [
      { code: "missing_state_class", missingClass: "responsive" },
    ];
    const missing = buildIssueLines(issues, en).join("; ");
    const recoveryExamples = collectRecoveryExamples(issues, en);
    const examples = en("planning.interview.compact_retry_examples", {
      list: recoveryExamples.join("; "),
    });

    const prompt = en("planning.interview.compact_retry_prompt", {
      goal: "Build a responsive dashboard",
      reason: "missing_state_criteria",
      missing,
      examples,
    });

    expect(prompt).toContain("Missing acceptance criteria for responsive behavior.");
    expect(prompt).toContain(
      "Here are acceptance criteria examples that already pass: The 3-column grid collapses to 1 column at 390px width.",
    );
  });

  it("leaves the prompt unchanged in shape when there are no issues (examples param empty)", () => {
    const prompt = en("planning.interview.compact_retry_prompt", {
      goal: "Build a responsive dashboard",
      reason: "missing_state_criteria",
      missing: "responsive behavior",
      examples: "",
    });

    expect(prompt.endsWith("Do not include prose or Markdown fences.")).toBe(true);
  });
});
