import { describe, expect, it } from "vitest";
import {
  createScopeExpansionSupervisorRequest,
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
