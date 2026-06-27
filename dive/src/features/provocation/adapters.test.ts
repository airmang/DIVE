import { describe, expect, it } from "vitest";
import {
  buildDiffReadyReviewAssessment,
  createDiffReadySupervisorRequest,
  createPlanDraftSupervisorRequest,
  createRetryLoopSupervisorRequest,
  createScopeExpansionSupervisorRequest,
  guessChangedFileCategory,
  normalizeChangedFile,
  normalizeSupervisorEvaluationResponse,
} from "./adapters";

describe("scope-expansion supervisor adapters", () => {
  it("normalizes a scope-expansion evaluation request with review-only actions", () => {
    const request = createScopeExpansionSupervisorRequest({
      sessionId: 7,
      projectId: 42,
      planId: 9,
      artifactRef: {
        kind: "add_step_draft",
        id: "draft-1",
        label: "Add analytics dashboard",
      },
      sourceUiMode: "work",
      contextHash: "local:context",
      evidenceHash: "local:evidence",
      evidenceRefs: [
        {
          id: "step.linkedCriterionIds",
          source: "plan",
          kind: "add_step_draft",
          label: "연결된 PRD 기준",
          valueSummary: { linkedCriterionIds: [] },
          verificationEvidence: false,
        },
      ],
      scopeExpansion: {
        expanded: true,
        reasonCodes: ["missing_criterion_link"],
        evidenceRefs: ["step.linkedCriterionIds"],
      },
    });

    expect(request).toMatchObject({
      event: "scope_expansion",
      mode: "work",
      projectId: 42,
      planId: 9,
      allowedActionIds: ["link_criterion", "split_scope", "edit_prd", "dismiss_review"],
      scopeExpansion: { expanded: true },
    });
  });

  it("keeps only allowed scope actions on shown supervisor responses", () => {
    const request = createScopeExpansionSupervisorRequest({
      sessionId: 7,
      projectId: 42,
      planId: 9,
      artifactRef: {
        kind: "add_step_draft",
        id: "draft-1",
        label: "Add analytics dashboard",
      },
      contextHash: "local:context",
      evidenceHash: "local:evidence",
      evidenceRefs: [],
      scopeExpansion: {
        expanded: true,
        reasonCodes: ["missing_criterion_link"],
        evidenceRefs: ["step.linkedCriterionIds"],
      },
    });

    const response = normalizeSupervisorEvaluationResponse(
      {
        status: "shown",
        evaluation_id: "eval-1",
        card: {
          id: "card-1",
          type: "scope_expansion",
          stage: "extend",
          severity: "caution",
          title: "검토 카드",
          prompt: "이 단계가 PRD 기준과 연결되나요?",
          message: "근거와 함께 확인하세요.",
          evidence: [],
          actions: [
            { id: "link_criterion", kind: "link_criterion", label: "기준 연결" },
            { id: "run_tests", kind: "run_tests", label: "테스트 실행" },
          ],
          primary_action_id: "run_tests",
          metadata: { concern: "scope_expansion" },
          created_at: "2026-06-15T00:00:00.000Z",
        },
      },
      request,
    );

    expect(response.status).toBe("shown");
    if (response.status !== "shown") throw new Error("expected shown response");
    expect(response.card.actions.map((action) => action.kind)).toEqual(["link_criterion"]);
    expect(response.card.primaryActionId).toBe("link_criterion");
    expect(response.card.metadata).toMatchObject({
      supervisorEvaluationId: "eval-1",
      supervisorEvent: "scope_expansion",
      projectId: 42,
      planId: 9,
      contextHash: "local:context",
      evidenceHash: "local:evidence",
    });
  });

  it("normalizes invalid or unavailable outcomes to no-card responses", () => {
    const dropped = normalizeSupervisorEvaluationResponse({
      status: "dropped",
      evaluation_id: "eval-2",
      drop_reason: "runtime_unavailable",
    });
    expect(dropped).toEqual({
      status: "dropped",
      evaluationId: "eval-2",
      dropReason: "runtime_unavailable",
    });

    const invalid = normalizeSupervisorEvaluationResponse({
      status: "shown",
      evaluation_id: "eval-3",
      card: { type: "ai_self_report_only" },
    });
    expect(invalid).toEqual({
      status: "dropped",
      evaluationId: "eval-3",
      dropReason: "parse_error",
    });
  });
});

describe("expanded supervisor adapters", () => {
  it("classifies CI, generic dependency, and secret paths as high-risk categories", () => {
    expect(guessChangedFileCategory(".github/workflows/ci.yml")).toBe("ci");
    expect(guessChangedFileCategory("Dockerfile")).toBe("ci");
    expect(guessChangedFileCategory("Cargo.lock")).toBe("dependency");
    expect(guessChangedFileCategory("go.sum")).toBe("dependency");
    expect(guessChangedFileCategory("certs/deploy.pem")).toBe("secret");
    expect(guessChangedFileCategory("keys/id_rsa")).toBe("secret");

    const assessment = buildDiffReadyReviewAssessment({
      changedFiles: [
        normalizeChangedFile({ path: ".github/workflows/ci.yml" }),
        normalizeChangedFile({ path: "Dockerfile" }),
        normalizeChangedFile({ path: "Cargo.lock" }),
        normalizeChangedFile({ path: "go.sum" }),
        normalizeChangedFile({ path: "certs/deploy.pem" }),
        normalizeChangedFile({ path: "keys/id_rsa" }),
      ],
      expectedFiles: ["src/App.tsx"],
    });

    expect(assessment.reasonCodes).toContain("high_risk_area");
    expect(assessment.highRiskFiles).toEqual([
      ".github/workflows/ci.yml",
      "Dockerfile",
      "Cargo.lock",
      "go.sum",
      "certs/deploy.pem",
      "keys/id_rsa",
    ]);
  });

  it("keeps high-risk expected files out of the diff_ready high-risk list", () => {
    const inScope = buildDiffReadyReviewAssessment({
      changedFiles: [
        normalizeChangedFile({ path: "package.json" }),
        normalizeChangedFile({ path: "src/App.tsx" }),
      ],
      expectedFiles: ["package.json", "src/App.tsx"],
    });
    expect(inScope.reasonCodes).not.toContain("high_risk_area");
    expect(inScope.highRiskFiles).toEqual([]);
    expect(inScope.eligible).toBe(false);

    const outOfScope = buildDiffReadyReviewAssessment({
      changedFiles: [
        normalizeChangedFile({ path: "package.json" }),
        normalizeChangedFile({ path: "src/App.tsx" }),
      ],
      expectedFiles: ["src/App.tsx"],
    });
    expect(outOfScope.reasonCodes).toContain("high_risk_area");
    expect(outOfScope.highRiskFiles).toEqual(["package.json"]);
    expect(outOfScope.eligible).toBe(true);
  });

  it("builds plan_drafted request with deterministic assessment and evidence refs", () => {
    const request = createPlanDraftSupervisorRequest({
      sessionId: 12,
      projectId: 3,
      planId: 44,
      sourceUiMode: "expert",
      goalSummary: "Build a todo app",
      acceptanceCriteria: ["User can add a todo"],
      unresolvedQuestions: ["Which browser should be checked?"],
      planSteps: [
        {
          id: "s_001",
          text: "Build the whole UI and API",
          expectedFiles: ["src/App.tsx", "src/api.ts", "package.json", "src/db.ts"],
          linkedCriterionIds: [],
          verificationCommand: null,
          verificationManualCheck: null,
        },
      ],
    });

    expect(request).toMatchObject({
      event: "plan_drafted",
      mode: "work",
      projectId: 3,
      planId: 44,
      artifactRef: { kind: "plan_draft", id: "plan-44:draft" },
      allowedActionIds: [
        "add_verification_step",
        "link_criterion",
        "split_scope",
        "edit_prd",
        "dismiss_review",
      ],
      planDraftAssessment: {
        eligible: true,
        reasonCodes: [
          "missing_verification",
          "unlinked_criteria",
          "broad_step",
          "unresolved_question",
        ],
        unverifiedStepIds: ["s_001"],
        unlinkedStepIds: ["s_001"],
      },
    });
    expect(request.contextHash).toMatch(/^fnv1a:/);
    expect(request.evidenceHash).toMatch(/^fnv1a:/);
    expect(request.evidenceRefs.map((ref) => ref.id)).toEqual(
      expect.arrayContaining([
        "plan.goal",
        "plan.criteria",
        "plan.step_count",
        "plan.step.s_001.verification",
        "plan.step.s_001.criteria",
        "plan.step.s_001.scope",
        "plan.unresolved.0",
      ]),
    );
  });

  it("normalizes expanded supervisor metadata and filters event actions", () => {
    const request = createPlanDraftSupervisorRequest({
      sessionId: 12,
      projectId: 3,
      planId: 44,
      sourceUiMode: "work",
      goalSummary: "Build a todo app",
      acceptanceCriteria: ["User can add a todo"],
      planSteps: [
        {
          id: "s_001",
          text: "Build form",
          linkedCriterionIds: [],
          verificationCommand: null,
          verificationManualCheck: null,
        },
      ],
    });

    const response = normalizeSupervisorEvaluationResponse(
      {
        status: "shown",
        evaluation_id: "eval-plan",
        card: {
          id: "card-plan",
          type: "plan_draft_review",
          stage: "instruct",
          severity: "caution",
          title: "검토 카드",
          prompt: "이 계획은 검증할 수 있나요?",
          message: "계획을 확인하세요.",
          evidence: [],
          actions: [
            { id: "add_verification_step", kind: "add_verification_step", label: "검증 추가" },
            { id: "open_diff", kind: "open_diff", label: "Diff 열기" },
          ],
          primary_action_id: "open_diff",
          metadata: { concern: "plan_draft_weakness" },
          created_at: "2026-06-16T00:00:00.000Z",
        },
      },
      request,
    );

    expect(response.status).toBe("shown");
    if (response.status !== "shown") throw new Error("expected shown response");
    expect(response.card.actions.map((action) => action.kind)).toEqual(["add_verification_step"]);
    expect(response.card.primaryActionId).toBe("add_verification_step");
    expect(response.card.metadata).toMatchObject({
      supervisorEvaluationId: "eval-plan",
      supervisorEvent: "plan_drafted",
      projectId: 3,
      planId: 44,
      artifactRef: { kind: "plan_draft", id: "plan-44:draft" },
    });
  });

  it("builds diff_ready request from changed-work evidence without raw diff bodies", () => {
    const request = createDiffReadySupervisorRequest({
      sessionId: 5,
      projectId: 1,
      stepId: 9,
      stepTitle: "Settings save",
      sourceUiMode: "work",
      goalSummary: "Keep settings changes scoped",
      stepSummary: "Only update the settings screen",
      changedFiles: [
        normalizeChangedFile({ path: "src/settings/SettingsPage.tsx" }),
        normalizeChangedFile({ path: "src/auth/session.ts" }),
      ],
      expectedFiles: ["src/settings/SettingsPage.tsx"],
      diffViewed: false,
      uiState: {
        goalSummary: "Keep settings changes scoped",
        planSummary: { stepCount: 1, activeStep: "Settings save" },
        verification: {
          aiClaimedDone: false,
          diffReviewed: false,
          appLaunched: false,
          previewChecked: false,
          automatedTestsPassed: false,
          testResult: "skipped",
          acceptanceCriterionConfirmed: false,
          manualChecks: [],
        },
        feasibility: {
          runnable: false,
          previewable: false,
          hasTests: true,
          diffAvailable: true,
        },
      },
    });

    expect(request).toMatchObject({
      event: "diff_ready",
      artifactRef: { kind: "diff", id: "step-9:diff" },
      allowedActionIds: expect.arrayContaining(["open_diff", "ask_ai_for_rationale"]),
      diffReadyAssessment: {
        eligible: true,
        reasonCodes: ["outside_expected_files", "high_risk_area"],
        unexpectedFiles: ["src/auth/session.ts"],
        highRiskFiles: ["src/auth/session.ts"],
      },
    });
    expect(JSON.stringify(request.evidenceRefs)).not.toContain("@@");

    const expectedOnly = createDiffReadySupervisorRequest({
      ...request,
      changedFiles: [normalizeChangedFile({ path: "src/settings/SettingsPage.tsx" })],
      expectedFiles: ["src/settings/SettingsPage.tsx"],
      uiState: request.uiState,
      stepId: 9,
      stepTitle: "Settings save",
      goalSummary: "Keep settings changes scoped",
      stepSummary: "Only update the settings screen",
    });
    expect(expectedOnly.diffReadyAssessment.eligible).toBe(false);
  });

  it("builds retry_loop request from repeated failure evidence without raw terminal bodies", () => {
    const request = createRetryLoopSupervisorRequest({
      sessionId: 6,
      projectId: 1,
      stepId: 9,
      stepTitle: "Settings save",
      sourceUiMode: "guided",
      goalSummary: "Fix settings save",
      stepSummary: "Run the failing save test",
      failureSummary:
        "stderr: TypeError: Cannot read properties of undefined at src/settings/save.ts:42\nTOKEN=secret",
      failureCount: 2,
      lastFailureAt: 2000,
      recoveryAvailable: true,
      lastActionSummary: "verification_failed",
      uiState: {
        goalSummary: "Fix settings save",
        planSummary: { stepCount: 1, activeStep: "Settings save" },
        verification: {
          aiClaimedDone: false,
          diffReviewed: false,
          appLaunched: false,
          previewChecked: false,
          automatedTestsPassed: false,
          testResult: "fail",
          acceptanceCriterionConfirmed: false,
          manualChecks: [],
        },
        feasibility: {
          runnable: false,
          previewable: false,
          hasTests: true,
          diffAvailable: true,
        },
      },
    });

    expect(request).toMatchObject({
      event: "retry_loop",
      mode: "guided",
      artifactRef: { kind: "failure" },
      allowedActionIds: expect.arrayContaining([
        "create_repro_steps",
        "rollback_last_change",
        "open_diff",
        "run_tests",
        "split_scope",
      ]),
      retryLoopAssessment: {
        eligible: true,
        reasonCodes: ["same_failure_repeated"],
        failureCount: 2,
        recoveryAvailable: true,
      },
    });
    const evidenceJson = JSON.stringify(request.evidenceRefs);
    expect(evidenceJson).not.toContain("TOKEN=secret");
    expect(evidenceJson).not.toContain("Cannot read properties");

    const oneFailure = createRetryLoopSupervisorRequest({
      ...request,
      failureSummary: "TypeError: Cannot read properties of undefined",
      failureCount: 1,
      lastFailureAt: 3000,
      stepId: 9,
      stepTitle: "Settings save",
      goalSummary: "Fix settings save",
      stepSummary: "Run the failing save test",
      recoveryAvailable: true,
      uiState: request.uiState,
    });
    expect(oneFailure.retryLoopAssessment.eligible).toBe(false);
  });
});
