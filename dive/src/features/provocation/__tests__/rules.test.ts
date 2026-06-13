import { describe, expect, it } from "vitest";
import { selectPrimaryProvocationCard } from "../priority";
import {
  assistantReportsFromConversation,
  createProvocationContext,
  detectAssistantSelfReportCompletion,
  retrySignalsFromConversation,
} from "../adapters";
import {
  aiSelfReportOnlyRule,
  diffScopeDriftRule,
  generateProvocationCards,
  missingAcceptanceCriteriaRule,
  missingVerificationStepRule,
  oversizedScopeRule,
  regenerationLoopRule,
} from "../rules";
import { deriveVerificationStatuses } from "../verificationStatus";
import type { ProvocationContext } from "../types";

function ctx(overrides: Partial<ProvocationContext> = {}): ProvocationContext {
  return {
    mode: "standard",
    stage: "decompose",
    ...overrides,
  };
}

describe("provocation rules", () => {
  it("oversized_scope triggers on a multi-feature prompt", () => {
    const card = oversizedScopeRule(
      ctx({
        promptDraft:
          "로그인 만들고 그리고 회원가입도 추가로 붙이고 관리자 대시보드와 결제 설정까지 해줘",
      }),
    );
    expect(card?.type).toBe("oversized_scope");
    expect(card?.evidence.length).toBeGreaterThan(0);
  });

  it("oversized_scope triggers on feature count plus separators and expansion terms", () => {
    const card = oversizedScopeRule(
      ctx({
        promptDraft:
          "전체 앱에 로그인, 회원가입 / 관리자 대시보드\n결제까지 한번에 모두 구현해줘",
      }),
    );
    expect(card?.type).toBe("oversized_scope");
    expect(card?.evidence.map((item) => item.label)).toEqual(
      expect.arrayContaining(["여러 기능 신호", "나열 구분자", "범위 확장 표현"]),
    );
  });

  it("oversized_scope triggers when one plan step names too many expected files", () => {
    const card = oversizedScopeRule(
      ctx({
        goalText: "설정과 대시보드 정리",
        planSteps: [
          {
            id: "1",
            text: "Update settings dashboard",
            expectedFiles: [
              "src/App.tsx",
              "src/routes.tsx",
              "src/settings/Page.tsx",
              "src/settings/Form.tsx",
              "src/dashboard/Page.tsx",
              "src/dashboard/Chart.tsx",
              "src/api/settings.ts",
            ],
          },
        ],
      }),
    );
    expect(card?.type).toBe("oversized_scope");
    expect(card?.evidence).toContainEqual({
      source: "plan",
      label: "예상 파일",
      value: "7개",
    });
  });

  it("oversized_scope does not trigger on a small single-feature prompt", () => {
    expect(oversizedScopeRule(ctx({ promptDraft: "버튼 문구를 저장으로 바꿔줘" }))).toBeNull();
  });

  it("oversized_scope does not trigger on a guarded small copy-only request", () => {
    expect(oversizedScopeRule(ctx({ promptDraft: "전체 버튼 문구만 저장으로 바꿔줘" }))).toBeNull();
  });

  it("missing_acceptance_criteria triggers on vague goal with no criteria", () => {
    const card = missingAcceptanceCriteriaRule(ctx({ goalText: "설정 화면을 예쁘게 개선해줘" }));
    expect(card?.type).toBe("missing_acceptance_criteria");
    expect(card?.evidence.some((item) => item.label === "완료 기준")).toBe(true);
  });

  it("missing_acceptance_criteria does not trigger when observable criteria exist", () => {
    expect(
      missingAcceptanceCriteriaRule(
        ctx({
          goalText: "설정 화면 개선",
          acceptanceCriteria: ["저장 버튼을 누르면 성공 toast가 보인다"],
        }),
      ),
    ).toBeNull();
  });

  it("missing_verification_step triggers when plan has implementation steps only", () => {
    const card = missingVerificationStepRule(
      ctx({
        stage: "instruct",
        planSteps: [
          { id: "1", text: "Create settings form" },
          { id: "2", text: "Wire save handler" },
        ],
      }),
    );
    expect(card?.type).toBe("missing_verification_step");
  });

  it("missing_verification_step does not trigger when plan has run/test/preview/check step", () => {
    expect(
      missingVerificationStepRule(
        ctx({
          stage: "instruct",
          planSteps: [
            { id: "1", text: "Create settings form" },
            { id: "2", text: "Run pnpm test and preview the settings page" },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("diff_scope_drift triggers on high-risk file change unrelated to a narrow goal", () => {
    const card = diffScopeDriftRule(
      ctx({
        stage: "execute",
        goalText: "버튼 문구만 바꿔줘",
        targetFiles: ["src/App.tsx"],
        changedFiles: [
          { path: "src/App.tsx", category: "ui", changeType: "modified" },
          { path: "package.json", category: "dependency", changeType: "modified" },
        ],
      }),
    );
    expect(card?.type).toBe("diff_scope_drift");
    expect(card?.severity).toBe("risk");
    expect(card?.metadata?.highRisk).toBe(true);
  });

  it("diff_scope_drift does not trigger on the expected low-risk UI file", () => {
    expect(
      diffScopeDriftRule(
        ctx({
          stage: "execute",
          goalText: "버튼 문구만 바꿔줘",
          targetFiles: ["src/App.tsx"],
          changedFiles: [{ path: "src/App.tsx", category: "ui", changeType: "modified" }],
        }),
      ),
    ).toBeNull();
  });

  it("ai_self_report_only triggers when AI claimed done but no evidence exists", () => {
    const card = aiSelfReportOnlyRule(
      ctx({
        stage: "finalApproval",
        verification: { aiClaimedDone: true, externalTestRun: false },
      }),
    );
    expect(card?.type).toBe("ai_self_report_only");
  });

  it("ai_self_report_only triggers from assistant completion text without verify log", () => {
    expect(detectAssistantSelfReportCompletion("요청한 수정은 완료했습니다.")).toBe(true);
    expect(detectAssistantSelfReportCompletion("아직 완료하지 않았습니다.")).toBe(false);

    const assistantReports = assistantReportsFromConversation([
      {
        id: "a1",
        kind: "assistant",
        content: "버튼 문구 수정 완료했습니다.",
        streaming: false,
        createdAt: 10,
      },
    ]);
    const card = aiSelfReportOnlyRule(
      createProvocationContext({
        mode: "standard",
        stage: "verify",
        assistantReports,
      }),
    );
    expect(card?.type).toBe("ai_self_report_only");
    expect(card?.evidence).toContainEqual({
      source: "agent",
      label: "AI 완료 보고",
      value: "assistant 메시지 1개",
    });
  });

  it("ai_self_report_only does not trigger when test or preview evidence exists", () => {
    expect(
      aiSelfReportOnlyRule(
        ctx({
          stage: "verify",
          verification: { aiClaimedDone: true, automatedTestsPassed: true },
        }),
      ),
    ).toBeNull();
    expect(
      aiSelfReportOnlyRule(
        ctx({
          stage: "verify",
          verification: { aiClaimedDone: true, previewChecked: true },
        }),
      ),
    ).toBeNull();
  });

  it("ai_self_report_only does not treat assistant text as verified evidence", () => {
    expect(
      deriveVerificationStatuses(
        createProvocationContext({
          mode: "standard",
          stage: "verify",
          assistantReports: [{ source: "assistant_message", messageId: "a1" }],
        }),
      ).map((item) => item.id),
    ).toEqual(["ai_self_report_only"]);

    expect(
      aiSelfReportOnlyRule(
        createProvocationContext({
          mode: "standard",
          stage: "verify",
          assistantReports: [{ source: "assistant_message", messageId: "a1" }],
          verification: { diffReviewed: true },
        }),
      ),
    ).toBeNull();
  });

  it("regeneration_loop triggers on repeated same error", () => {
    const card = regenerationLoopRule(
      ctx({
        stage: "execute",
        recentErrors: [
          { message: "TypeError: x is undefined", occurredAt: "1" },
          { message: "TypeError: x is undefined", occurredAt: "2" },
          { message: "TypeError: x is undefined", occurredAt: "3" },
        ],
      }),
    );
    expect(card?.type).toBe("regeneration_loop");
  });

  it("regeneration_loop triggers on repeated retry requests after the same failure", () => {
    const retrySignals = retrySignalsFromConversation([
      { id: "e1", kind: "error", message: "TypeError: x is undefined", createdAt: 1 },
      { id: "u1", kind: "user", content: "고쳐줘", createdAt: 2 },
      {
        id: "tr-1",
        kind: "tool_result",
        success: false,
        summary: "TypeError: x is undefined",
        createdAt: 3,
      },
      { id: "u2", kind: "user", content: "다시 해줘", createdAt: 4 },
    ]);
    const card = regenerationLoopRule(ctx({ stage: "execute", retrySignals }));
    expect(card?.type).toBe("regeneration_loop");
    expect(card?.evidence).toContainEqual({
      source: "history",
      label: "같은 오류 후 반복 요청",
      value: "2회",
    });
  });

  it("regeneration_loop does not trigger when the retry asks for repro or rollback", () => {
    const retrySignals = retrySignalsFromConversation([
      { id: "e1", kind: "error", message: "TypeError: x is undefined", createdAt: 1 },
      { id: "u1", kind: "user", content: "고쳐줘", createdAt: 2 },
      {
        id: "tr-1",
        kind: "tool_result",
        success: false,
        summary: "TypeError: x is undefined",
        createdAt: 3,
      },
      { id: "u2", kind: "user", content: "다시 해줘. 재현 단계도 정리해줘", createdAt: 4 },
    ]);
    expect(regenerationLoopRule(ctx({ stage: "execute", retrySignals }))).toBeNull();
  });

  it("mode filtering suppresses low-risk cards in expert mode", () => {
    const cards = generateProvocationCards(
      ctx({
        mode: "expert",
        goalText: "설정 화면을 개선해줘",
        planSteps: [{ id: "1", text: "Build settings form" }],
      }),
    );
    expect(cards.map((card) => card.type)).not.toContain("missing_acceptance_criteria");
    expect(cards.map((card) => card.type)).not.toContain("missing_verification_step");
  });

  it("priority ordering returns the most important card first", () => {
    const cards = generateProvocationCards(
      ctx({
        stage: "finalApproval",
        goalText: "버튼 문구만 바꿔줘",
        changedFiles: [
          { path: "src/App.tsx", category: "ui" },
          { path: "pnpm-lock.yaml", category: "dependency" },
        ],
        verification: { aiClaimedDone: true },
        planSteps: [{ id: "1", text: "Change button copy" }],
      }),
    );
    expect(selectPrimaryProvocationCard(cards)?.type).toBe("diff_scope_drift");
  });

  it("verification statuses separate AI self-report from evidence", () => {
    expect(
      deriveVerificationStatuses(
        ctx({
          verification: { aiClaimedDone: true, externalTestRun: false },
        }),
      ).map((item) => item.id),
    ).toEqual(["ai_self_report_only", "external_test_not_run"]);
    expect(
      deriveVerificationStatuses(
        ctx({
          verification: { aiClaimedDone: true, diffReviewed: true, automatedTestsPassed: true },
        }),
      ).map((item) => item.id),
    ).toEqual(["diff_reviewed", "automated_tests_passed"]);
  });
});
