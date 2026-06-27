import type { VerifyLogView } from "../workmap/types";
import type { AgencyStateView } from "../../features/roadmap";
import type {
  ProvocationCard,
  SupervisorFeasibility,
  VerificationStatusItem,
} from "../../features/provocation";
import { highRiskFilesFromDiffScopeCard } from "../../features/provocation";
import {
  automatedTestEvidenceStrength,
  hasConcreteAutomatedFail,
  hasConcreteVerification,
} from "../../features/provocation/verificationGrade";

export type DecisionGateRiskReasonId =
  | "unverified"
  | "criteria_unobserved"
  | "ai_self_report_only"
  | "failed_test"
  | "high_risk_unexpected_files"
  | "rollback_unavailable";

export interface DecisionGateRiskReason {
  id: DecisionGateRiskReasonId;
  evidence?: string;
}

export interface DecisionGatePolicy {
  canApproveDirectly: boolean;
  canDeferVerification: boolean;
  requiresReason: boolean;
  hasVerifiedEvidence: boolean;
  reasons: DecisionGateRiskReason[];
}

export interface DecisionGatePolicyInput {
  verificationStatuses?: VerificationStatusItem[];
  agencyState?: AgencyStateView | null;
  provocationCards?: ProvocationCard[];
  verifyLog?: VerifyLogView | null;
  rollbackAvailable?: boolean;
  acceptanceCriterionConfirmed?: boolean;
  verificationFeasibility?: SupervisorFeasibility;
  /**
   * Criterion ids that must each carry an action-backed observation before the
   * gate may clear (S-029, 009 theme 2: per-AC binding). Empty/undefined keeps
   * the legacy single-`acceptanceCriterionConfirmed` behavior.
   */
  gatingCriterionIds?: string[];
  /** Criterion ids that currently have an action-backed observation. */
  observedCriterionIds?: string[];
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function deriveDecisionGatePolicy(input: DecisionGatePolicyInput): DecisionGatePolicy {
  const statusIds = new Set((input.verificationStatuses ?? []).map((item) => item.id));
  const agencyIds = new Set((input.agencyState?.items ?? []).map((item) => item.id));
  const gatingCriterionIds = uniqueNonEmpty(input.gatingCriterionIds);
  const observedCriterionIds = new Set(uniqueNonEmpty(input.observedCriterionIds));
  const unobservedCriterionIds = gatingCriterionIds.filter((id) => !observedCriterionIds.has(id));
  const criteriaUnobserved = gatingCriterionIds.length > 0 && unobservedCriterionIds.length > 0;
  // When acceptance criteria are not fully observed, manual/preview/observation
  // evidence must NOT satisfy the gate on its own — coverage wins (S-029
  // self-consistency, independent of how the caller couples its inputs). Only
  // an executed automated test (a separate, criterion-agnostic signal) still
  // counts. This keeps the policy honest even if a future caller sources
  // verificationStatuses and the gating arrays independently.
  const gradeStatusIds = criteriaUnobserved
    ? [...statusIds].filter((id) => id !== "manual_observation")
    : [...statusIds];
  const observed =
    gradeStatusIds.includes("app_launched") ||
    gradeStatusIds.includes("preview_checked") ||
    gradeStatusIds.includes("manual_observation") ||
    agencyIds.has("verified_with_evidence");
  const hasVerifiedEvidence = hasConcreteVerification({
    statusIds: gradeStatusIds,
    testResult: input.verifyLog?.test_result ?? null,
    testCommand: input.verifyLog?.test_command ?? null,
    testExitCode: input.verifyLog?.test_exit_code ?? null,
    manualOrPreviewObserved: observed,
    acceptanceCriterionConfirmed: criteriaUnobserved ? false : input.acceptanceCriterionConfirmed,
    manualObservationCount: gradeStatusIds.includes("manual_observation") ? 1 : 0,
  });
  const testSignalStrength = automatedTestEvidenceStrength({
    testResult: input.verifyLog?.test_result ?? null,
    testCommand: input.verifyLog?.test_command ?? null,
    testExitCode: input.verifyLog?.test_exit_code ?? null,
  });
  const aiSelfReportOnly = Boolean(
    !hasVerifiedEvidence &&
    (statusIds.has("ai_self_report_only") ||
      agencyIds.has("ai_self_report_only") ||
      (input.verifyLog?.intent_match === true &&
        (input.verifyLog.test_result === "skipped" || testSignalStrength === "weak_signal"))),
  );
  const failedTest = Boolean(
    hasConcreteAutomatedFail({
      testResult: input.verifyLog?.test_result ?? null,
      testCommand: input.verifyLog?.test_command ?? null,
      testExitCode: input.verifyLog?.test_exit_code ?? null,
    }) ||
    statusIds.has("failed_but_accepted") ||
    agencyIds.has("verification_failed"),
  );
  // S-037 is decision-time path drift from the supervisor diff_ready assessment.
  // It does not scan file contents; S-034 secret/.env warnings remain approval-
  // time guard.rs warnings that can precede this later written-justification reason.
  const highRiskFiles = [
    ...new Set(
      (input.provocationCards ?? [])
        .filter((card) => card.type === "diff_scope_drift" || card.type === "diff_scope_review")
        .flatMap(highRiskFilesFromDiffScopeCard),
    ),
  ];
  const highRiskUnexpectedFiles = highRiskFiles.length > 0;
  const concreteVerificationFeasible =
    input.verificationFeasibility === undefined ||
    Boolean(
      input.verificationFeasibility.runnable ||
      input.verificationFeasibility.previewable ||
      input.verificationFeasibility.hasTests,
    );
  const unverifiedRisk = !hasVerifiedEvidence || aiSelfReportOnly || failedTest;
  const canDeferVerification = Boolean(
    input.verificationFeasibility !== undefined &&
    !hasVerifiedEvidence &&
    !failedTest &&
    !highRiskUnexpectedFiles &&
    !concreteVerificationFeasible,
  );
  const rollbackUnavailableRisk =
    input.rollbackAvailable === false && unverifiedRisk && !canDeferVerification;
  const reasons: DecisionGateRiskReason[] = [];

  if (aiSelfReportOnly && !canDeferVerification) reasons.push({ id: "ai_self_report_only" });
  if (failedTest) reasons.push({ id: "failed_test" });
  if (highRiskUnexpectedFiles) {
    reasons.push({ id: "high_risk_unexpected_files", evidence: highRiskFiles.join(", ") });
  }
  if (rollbackUnavailableRisk) reasons.push({ id: "rollback_unavailable" });
  // A specific "N of M criteria observed" reason surfaces whenever per-criterion
  // observation is incomplete (it co-exists with ai_self_report_only — the AI's
  // claim and the user's observation coverage are orthogonal). It replaces the
  // generic `unverified`, and is suppressed when a failed/automated test already
  // decides the evidence picture.
  const criteriaBlocking =
    criteriaUnobserved && !hasVerifiedEvidence && !failedTest && !canDeferVerification;
  if (criteriaBlocking) {
    const observedCount = gatingCriterionIds.length - unobservedCriterionIds.length;
    reasons.push({
      id: "criteria_unobserved",
      evidence: `${observedCount}/${gatingCriterionIds.length}`,
    });
  }
  if (
    !hasVerifiedEvidence &&
    !aiSelfReportOnly &&
    !failedTest &&
    !canDeferVerification &&
    !criteriaBlocking
  ) {
    reasons.push({ id: "unverified" });
  }

  return {
    canApproveDirectly: reasons.length === 0 && !canDeferVerification,
    canDeferVerification,
    requiresReason: reasons.length > 0,
    hasVerifiedEvidence,
    reasons,
  };
}
