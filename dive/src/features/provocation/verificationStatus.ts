import type {
  ApprovalDecisionOutcome,
  ApprovalProvenance,
  ProvocationContext,
  ProvocationVerification,
  VerificationEvidenceSummary,
  VerificationProvenanceItem,
  VerificationStatusItem,
} from "./types";

function hasManualChecks(verification: ProvocationVerification | undefined): boolean {
  return Boolean(verification?.manualChecks?.some((item) => item.trim().length > 0));
}

export function hasAiSelfReport(context: ProvocationContext): boolean {
  return Boolean(
    context.verification?.aiClaimedDone ||
    context.assistantReports?.some((item) => item.source === "assistant_message"),
  );
}

export function hasObservedVerificationEvidence(context: ProvocationContext): boolean {
  const provenance = context.approvalProvenance ?? context.verification?.approvalProvenance;
  if (provenance) return provenance.evidenceSummary.concreteEvidence;
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

export function hasConcreteVerificationEvidence(context: ProvocationContext): boolean {
  const provenance = context.approvalProvenance ?? context.verification?.approvalProvenance;
  if (provenance) return provenance.evidenceSummary.concreteEvidence;
  const verification = context.verification;
  return Boolean(
    verification?.appLaunched ||
    verification?.previewChecked ||
    verification?.automatedTestsPassed ||
    verification?.externalTestRun ||
    hasManualChecks(verification) ||
    context.userHasViewedPreview ||
    context.userHasViewedTestResult,
  );
}

function statusSource(id: VerificationStatusItem["id"]): VerificationProvenanceItem["source"] {
  switch (id) {
    case "ai_self_report_only":
      return "ai_self_report";
    case "diff_reviewed":
      return "diff_review";
    case "app_launched":
      return "app_launch";
    case "preview_checked":
      return "preview";
    case "automated_tests_passed":
      return "automated_test";
    case "external_test_not_run":
      return "external_test";
    case "failed_but_accepted":
    case "approved_with_risk":
      return "risk_approval";
  }
}

function toProvenanceItem(
  item: VerificationStatusItem,
  recordedAt?: number,
): VerificationProvenanceItem {
  return {
    ...item,
    source: statusSource(item.id),
    recordedAt,
  };
}

function pushUniqueStatus(statuses: VerificationStatusItem[], item: VerificationStatusItem) {
  if (statuses.some((existing) => existing.id === item.id)) return;
  statuses.push(item);
}

function deriveCurrentVerificationStatuses(context: ProvocationContext): VerificationStatusItem[] {
  const verification = context.verification;
  const statuses: VerificationStatusItem[] = [];
  const observedEvidence = hasObservedVerificationEvidence(context);

  if (hasAiSelfReport(context) && !observedEvidence) {
    pushUniqueStatus(statuses, {
      id: "ai_self_report_only",
      label: "AI 자가보고만 있음",
      evidenceBacked: false,
      tone: "warn",
    });
  }

  if (verification?.diffReviewed || context.userHasViewedDiff) {
    pushUniqueStatus(statuses, {
      id: "diff_reviewed",
      label: "Diff 확인됨",
      evidenceBacked: true,
      tone: "info",
    });
  }

  if (verification?.appLaunched) {
    pushUniqueStatus(statuses, {
      id: "app_launched",
      label: "앱 실행 확인됨",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (verification?.previewChecked || context.userHasViewedPreview) {
    pushUniqueStatus(statuses, {
      id: "preview_checked",
      label: "수동 프리뷰 확인됨",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (verification?.automatedTestsPassed || context.userHasViewedTestResult) {
    pushUniqueStatus(statuses, {
      id: "automated_tests_passed",
      label: "자동 테스트 통과",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (verification && verification.externalTestRun === false) {
    pushUniqueStatus(statuses, {
      id: "external_test_not_run",
      label: "외부 테스트 없음",
      evidenceBacked: false,
      tone: "warn",
    });
  }

  if (verification?.failedButAccepted || verification?.testResult === "fail") {
    pushUniqueStatus(statuses, {
      id: "failed_but_accepted",
      label: "실패했지만 승인됨",
      evidenceBacked: false,
      tone: "risk",
    });
  }

  if (verification?.approvedWithRisk) {
    pushUniqueStatus(statuses, {
      id: "approved_with_risk",
      label: "위험을 감수하고 승인됨",
      evidenceBacked: false,
      tone: "risk",
    });
  }

  return statuses;
}

export function deriveVerificationStatuses(context: ProvocationContext): VerificationStatusItem[] {
  const provenance = context.approvalProvenance ?? context.verification?.approvalProvenance;
  const statuses: VerificationStatusItem[] = [];
  for (const item of provenance?.statuses ?? []) {
    pushUniqueStatus(statuses, item);
  }
  for (const item of deriveCurrentVerificationStatuses(context)) {
    pushUniqueStatus(statuses, item);
  }
  return statuses;
}

export function summarizeVerificationEvidence(
  context: ProvocationContext,
): VerificationEvidenceSummary {
  const verification = context.verification;
  const currentStatuses = deriveCurrentVerificationStatuses(context);
  const evidenceLabels = currentStatuses
    .filter((item) => item.evidenceBacked)
    .map((item) => item.label);
  return {
    concreteEvidence: Boolean(
      verification?.appLaunched ||
      verification?.previewChecked ||
      verification?.automatedTestsPassed ||
      verification?.externalTestRun ||
      hasManualChecks(verification) ||
      context.userHasViewedPreview ||
      context.userHasViewedTestResult,
    ),
    aiSelfReport: hasAiSelfReport(context),
    automatedTestsPassed: Boolean(verification?.automatedTestsPassed),
    externalTestRun:
      verification?.externalTestRun === undefined ? null : Boolean(verification.externalTestRun),
    testResult: verification?.testResult ?? null,
    manualEvidenceCount:
      verification?.manualChecks?.filter((item) => item.trim().length > 0).length ?? 0,
    evidenceLabels,
  };
}

export function buildApprovalProvenance(
  context: ProvocationContext,
  approval?: {
    outcome?: ApprovalDecisionOutcome;
    decidedAt?: number;
    riskReason?: string | null;
  },
): ApprovalProvenance {
  const summary = summarizeVerificationEvidence(context);
  const statuses = deriveCurrentVerificationStatuses(context).map((item) =>
    toProvenanceItem(item, approval?.decidedAt),
  );
  const failed = context.verification?.failedButAccepted || summary.testResult === "fail";
  const riskAccepted =
    failed ||
    !summary.concreteEvidence ||
    context.verification?.approvedWithRisk ||
    approval?.outcome === "approved_with_concern";

  if (failed && !statuses.some((item) => item.id === "failed_but_accepted")) {
    statuses.push(
      toProvenanceItem(
        {
          id: "failed_but_accepted",
          label: "실패했지만 승인됨",
          evidenceBacked: false,
          tone: "risk",
        },
        approval?.decidedAt,
      ),
    );
  }

  if (riskAccepted && !statuses.some((item) => item.id === "approved_with_risk")) {
    statuses.push(
      toProvenanceItem(
        {
          id: "approved_with_risk",
          label: "위험을 감수하고 승인됨",
          evidenceBacked: false,
          tone: "risk",
        },
        approval?.decidedAt,
      ),
    );
  }

  return {
    schemaVersion: 1,
    verificationState: failed
      ? "failed_but_accepted"
      : riskAccepted
        ? "unverified_risk_accepted"
        : "verified_with_evidence",
    statuses,
    statusIds: statuses.map((item) => item.id),
    evidenceSummary: {
      ...summary,
      evidenceLabels: statuses.filter((item) => item.evidenceBacked).map((item) => item.label),
    },
    riskAccepted,
    riskReason: approval?.riskReason?.trim() || null,
    approvalOutcome: approval?.outcome,
    decidedAt: approval?.decidedAt,
  };
}
