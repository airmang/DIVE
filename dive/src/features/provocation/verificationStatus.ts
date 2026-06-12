import type {
  ProvocationContext,
  ProvocationVerification,
  VerificationStatusItem,
} from "./types";

function hasManualChecks(verification: ProvocationVerification | undefined): boolean {
  return Boolean(verification?.manualChecks?.some((item) => item.trim().length > 0));
}

export function hasConcreteVerificationEvidence(context: ProvocationContext): boolean {
  const verification = context.verification;
  return Boolean(
    verification?.diffReviewed ||
      verification?.appLaunched ||
      verification?.previewChecked ||
      verification?.automatedTestsPassed ||
      verification?.externalTestRun ||
      hasManualChecks(verification) ||
      context.userHasViewedDiff ||
      context.userHasViewedPreview ||
      context.userHasViewedTestResult,
  );
}

export function deriveVerificationStatuses(context: ProvocationContext): VerificationStatusItem[] {
  const verification = context.verification;
  const statuses: VerificationStatusItem[] = [];
  const concreteEvidence = hasConcreteVerificationEvidence(context);

  if (verification?.aiClaimedDone && !concreteEvidence) {
    statuses.push({
      id: "ai_self_report_only",
      label: "AI 자가보고만 있음",
      evidenceBacked: false,
      tone: "warn",
    });
  }

  if (verification?.diffReviewed || context.userHasViewedDiff) {
    statuses.push({
      id: "diff_reviewed",
      label: "Diff 확인됨",
      evidenceBacked: true,
      tone: "info",
    });
  }

  if (verification?.appLaunched) {
    statuses.push({
      id: "app_launched",
      label: "앱 실행 확인됨",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (verification?.previewChecked || context.userHasViewedPreview) {
    statuses.push({
      id: "preview_checked",
      label: "수동 프리뷰 확인됨",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (verification?.automatedTestsPassed || context.userHasViewedTestResult) {
    statuses.push({
      id: "automated_tests_passed",
      label: "자동 테스트 통과",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (verification && verification.externalTestRun === false) {
    statuses.push({
      id: "external_test_not_run",
      label: "외부 테스트 없음",
      evidenceBacked: false,
      tone: "warn",
    });
  }

  if (verification?.failedButAccepted) {
    statuses.push({
      id: "failed_but_accepted",
      label: "실패했지만 승인됨",
      evidenceBacked: false,
      tone: "risk",
    });
  }

  if (verification?.approvedWithRisk) {
    statuses.push({
      id: "approved_with_risk",
      label: "위험을 감수하고 승인됨",
      evidenceBacked: false,
      tone: "risk",
    });
  }

  return statuses;
}
