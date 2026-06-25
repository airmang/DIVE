import type {
  ApprovalDecisionOutcome,
  ApprovalProvenance,
  ProvocationContext,
  ProvocationVerification,
  VerificationEvidenceSummary,
  VerificationProvenanceItem,
  VerificationStatusId,
  VerificationStatusItem,
} from "./types";
import {
  automatedTestEvidenceStrength,
  hasConcreteAutomatedPass,
  hasConcreteVerification,
  hasExecutedTestCommand,
} from "./verificationGrade";

/**
 * i18n keys for verification-status badges, resolved with `t()` at the render
 * site (see verification_status.* in src/i18n/{en,ko}.json). The `label` field
 * on VerificationStatusItem is legacy/persisted (kept for ApprovalProvenance
 * back-compat) and is no longer rendered. The `Record<VerificationStatusId, …>`
 * gives compile-time exhaustiveness when a new status id is added.
 */
export const VERIFICATION_STATUS_LABEL_KEY: Record<VerificationStatusId, string> = {
  ai_self_report_only: "verification_status.ai_self_report_only",
  diff_reviewed: "verification_status.diff_reviewed",
  app_launched: "verification_status.app_launched",
  preview_checked: "verification_status.preview_checked",
  manual_observation: "verification_status.manual_observation",
  automated_tests_passed: "verification_status.automated_tests_passed",
  external_test_not_run: "verification_status.external_test_not_run",
  failed_but_accepted: "verification_status.failed_but_accepted",
  approved_with_risk: "verification_status.approved_with_risk",
  verification_deferred: "verification_status.verification_deferred",
};

function hasManualChecks(verification: ProvocationVerification | undefined): boolean {
  return Boolean(verification?.manualChecks?.some((item) => item.trim().length > 0));
}

function manualObservationCount(verification: ProvocationVerification | undefined): number {
  return verification?.observationIds?.filter((item) => item.trim().length > 0).length ?? 0;
}

function hasExecutedVerificationCommand(
  verification: ProvocationVerification | undefined,
): boolean {
  return hasExecutedTestCommand({
    testCommand: verification?.testCommand,
    testExitCode: verification?.testExitCode,
  });
}

export function hasAiSelfReport(context: ProvocationContext): boolean {
  return Boolean(
    context.verification?.aiClaimedDone ||
    context.assistantReports?.some((item) => item.source === "assistant_message"),
  );
}

export function hasObservedVerificationEvidence(context: ProvocationContext): boolean {
  const provenance = context.approvalProvenance ?? context.verification?.approvalProvenance;
  if (provenance) {
    return (
      provenance.evidenceSummary.concreteEvidence || provenance.statusIds.includes("diff_reviewed")
    );
  }
  const verification = context.verification;
  return Boolean(
    verification?.diffReviewed ||
    context.userHasViewedDiff ||
    hasConcreteVerificationEvidence(context),
  );
}

export function hasConcreteVerificationEvidence(context: ProvocationContext): boolean {
  const provenance = context.approvalProvenance ?? context.verification?.approvalProvenance;
  if (provenance) return provenance.evidenceSummary.concreteEvidence;
  const verification = context.verification;
  const statusIds: VerificationStatusItem["id"][] = [];
  if (verification?.appLaunched) statusIds.push("app_launched");
  if (verification?.previewChecked) statusIds.push("preview_checked");
  if (
    hasConcreteAutomatedPass({
      testResult: verification?.testResult ?? null,
      testCommand: verification?.testCommand,
      testExitCode: verification?.testExitCode,
    })
  ) {
    statusIds.push("automated_tests_passed");
  }
  return hasConcreteVerification({
    statusIds,
    testResult: verification?.testResult ?? null,
    testCommand: verification?.testCommand,
    testExitCode: verification?.testExitCode,
    manualOrPreviewObserved: Boolean(
      verification?.appLaunched || verification?.previewChecked || hasManualChecks(verification),
    ),
    acceptanceCriterionConfirmed: Boolean(verification?.acceptanceCriterionConfirmed),
    manualObservationCount: manualObservationCount(verification),
  });
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
    case "manual_observation":
      return "user_observation";
    case "automated_tests_passed":
      return "automated_test";
    case "external_test_not_run":
      return "external_test";
    case "failed_but_accepted":
    case "approved_with_risk":
      return "risk_approval";
    case "verification_deferred":
      return "deferred_verification";
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
  const concreteEvidence = hasConcreteVerificationEvidence(context);

  if (hasAiSelfReport(context) && !concreteEvidence) {
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

  if (verification?.previewChecked) {
    pushUniqueStatus(statuses, {
      id: "preview_checked",
      label: "수동 프리뷰 확인됨",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (manualObservationCount(verification) > 0 && verification?.acceptanceCriterionConfirmed) {
    pushUniqueStatus(statuses, {
      id: "manual_observation",
      label: "직접 관찰 확인",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (
    hasConcreteAutomatedPass({
      testResult: verification?.testResult ?? null,
      testCommand: verification?.testCommand,
      testExitCode: verification?.testExitCode,
    })
  ) {
    pushUniqueStatus(statuses, {
      id: "automated_tests_passed",
      label: "자동 테스트 통과",
      evidenceBacked: true,
      tone: "success",
    });
  }

  if (
    verification &&
    (verification.externalTestRun === false ||
      automatedTestEvidenceStrength({
        testResult: verification.testResult ?? null,
        testCommand: verification.testCommand,
        testExitCode: verification.testExitCode,
      }) === "weak_signal")
  ) {
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

  if (verification?.verificationDeferred) {
    pushUniqueStatus(statuses, {
      id: "verification_deferred",
      label: "검증 유예됨",
      evidenceBacked: false,
      tone: "info",
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
  const observationCount = manualObservationCount(verification);
  const manualCheckCount =
    verification?.manualChecks?.filter((item) => item.trim().length > 0).length ?? 0;
  const evidenceLabels = currentStatuses
    .filter((item) => item.evidenceBacked)
    .map((item) => item.label);
  return {
    concreteEvidence: hasConcreteVerificationEvidence(context),
    aiSelfReport: hasAiSelfReport(context),
    automatedTestsPassed: hasConcreteAutomatedPass({
      testResult: verification?.testResult ?? null,
      testCommand: verification?.testCommand,
      testExitCode: verification?.testExitCode,
    }),
    externalTestRun:
      verification?.externalTestRun === undefined
        ? hasExecutedVerificationCommand(verification)
          ? true
          : null
        : Boolean(verification.externalTestRun),
    testResult: verification?.testResult ?? null,
    manualEvidenceCount: observationCount > 0 ? observationCount : manualCheckCount,
    observationIds: verification?.observationIds?.filter((item) => item.trim().length > 0) ?? [],
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
  const verificationDeferred =
    context.verification?.verificationDeferred || approval?.outcome === "verification_deferred";
  const riskAccepted =
    !verificationDeferred &&
    (failed ||
      !summary.concreteEvidence ||
      context.verification?.approvedWithRisk ||
      approval?.outcome === "approved_with_concern");

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

  if (verificationDeferred && !statuses.some((item) => item.id === "verification_deferred")) {
    statuses.push(
      toProvenanceItem(
        {
          id: "verification_deferred",
          label: "검증 유예됨",
          evidenceBacked: false,
          tone: "info",
        },
        approval?.decidedAt,
      ),
    );
  }

  return {
    schemaVersion: 1,
    verificationState: failed
      ? "failed_but_accepted"
      : summary.concreteEvidence
        ? "verified_with_evidence"
        : verificationDeferred
          ? "verification_deferred"
          : "unverified_risk_accepted",
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
