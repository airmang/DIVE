import { describe, expect, it } from "vitest";
import { deriveAgencyStateView } from "./agencyStatus";
import type { ApprovalProvenance } from "../provocation";

function provenance(overrides: Partial<ApprovalProvenance> = {}): ApprovalProvenance {
  return {
    schemaVersion: 1,
    verificationState: "verified_with_evidence",
    statuses: [],
    statusIds: [],
    evidenceSummary: {
      concreteEvidence: true,
      aiSelfReport: false,
      automatedTestsPassed: true,
      externalTestRun: true,
      testResult: "pass",
      manualEvidenceCount: 0,
      evidenceLabels: ["자동 테스트 통과"],
    },
    riskAccepted: false,
    riskReason: null,
    ...overrides,
  };
}

describe("deriveAgencyStateView", () => {
  it("maps AI-only and skipped verification to self-report and verification-needed states", () => {
    const view = deriveAgencyStateView({
      goalText: "버튼 문구 수정",
      acceptanceCriteria: ["버튼에 저장이 보인다"],
      verifyLog: {
        intent_match: true,
        test_result: "skipped",
        details: "AI said done.",
        model: "mock",
        ran_at: 1,
      },
    });

    expect(view.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["ai_self_report_only", "verification_needed"]),
    );
    expect(view.primary?.id).toBe("ai_self_report_only");
  });

  it("maps failed tests to verification_failed", () => {
    const view = deriveAgencyStateView({
      goalText: "설정 저장",
      acceptanceCriteria: ["저장 후 toast가 보인다"],
      verifyLog: {
        intent_match: true,
        test_result: "fail",
        details: "test failed",
        model: "mock",
        ran_at: 1,
      },
    });

    expect(view.items.map((item) => item.id)).toContain("verification_failed");
    expect(view.primary?.id).toBe("verification_failed");
  });

  it("maps evidence-backed approval to verified_with_evidence", () => {
    const view = deriveAgencyStateView({
      goalText: "검색 필터",
      acceptanceCriteria: ["필터링된 결과가 보인다"],
      approvalProvenance: provenance({
        statusIds: ["automated_tests_passed"],
      }),
    });

    expect(view.items.map((item) => item.id)).toContain("verified_with_evidence");
    expect(view.hasRisk).toBe(false);
  });

  it("does not map preview alone to verified_with_evidence", () => {
    const view = deriveAgencyStateView({
      goalText: "미리보기 확인",
      acceptanceCriteria: ["미리보기에서 변경된 화면이 보인다"],
      status: "review",
      approvalProvenance: provenance({
        verificationState: "unverified_risk_accepted",
        statusIds: ["preview_checked"],
      }),
    });

    expect(view.items.map((item) => item.id)).not.toContain("verified_with_evidence");
  });

  it("maps preview with acceptance criterion confirmation to verified_with_evidence", () => {
    const view = deriveAgencyStateView({
      goalText: "미리보기 확인",
      acceptanceCriteria: ["미리보기에서 변경된 화면이 보인다"],
      status: "review",
      approvalProvenance: provenance({
        verificationState: "unverified_risk_accepted",
        statusIds: ["preview_checked"],
      }),
      acceptanceCriterionConfirmed: true,
    });

    expect(view.items.map((item) => item.id)).toContain("verified_with_evidence");
  });

  it("maps unverified risk approval to approved_with_risk", () => {
    const view = deriveAgencyStateView({
      goalText: "라우팅 수정",
      acceptanceCriteria: ["페이지 이동이 된다"],
      approvalProvenance: provenance({
        verificationState: "unverified_risk_accepted",
        statusIds: ["ai_self_report_only", "approved_with_risk"],
        evidenceSummary: {
          concreteEvidence: false,
          aiSelfReport: true,
          automatedTestsPassed: false,
          externalTestRun: false,
          testResult: "skipped",
          manualEvidenceCount: 0,
          evidenceLabels: [],
        },
        riskAccepted: true,
        riskReason: "변경 범위를 직접 확인함",
      }),
    });

    expect(view.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["approved_with_risk", "ai_self_report_only"]),
    );
    expect(view.hasRisk).toBe(true);
  });

  it("maps rollback availability without making it primary over risk", () => {
    const view = deriveAgencyStateView({
      goalText: "버튼 수정",
      acceptanceCriteria: ["버튼 문구가 저장이다"],
      checkpointAvailable: true,
      approvalProvenance: provenance({
        verificationState: "unverified_risk_accepted",
        statusIds: ["approved_with_risk"],
        riskAccepted: true,
      }),
    });

    expect(view.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["rollback_available", "approved_with_risk"]),
    );
    expect(view.primary?.id).toBe("approved_with_risk");
  });

  it("maps changed files that have not been viewed to diff_review_needed", () => {
    const view = deriveAgencyStateView({
      goalText: "버튼 수정",
      acceptanceCriteria: ["버튼 문구가 저장이다"],
      changedFiles: [{ path: "src/Button.tsx", diff: null }],
      diffViewed: false,
    });

    expect(view.items.map((item) => item.id)).toContain("diff_review_needed");
  });
});
