import type { VerifyLogView } from "../workmap/types";
import type { AgencyStateView } from "../../features/roadmap";
import type {
  ProvocationCard,
  SupervisorFeasibility,
  VerificationStatusItem,
} from "../../features/provocation";
import { hasConcreteVerification } from "../../features/provocation/verificationGrade";

export type DecisionGateRiskReasonId =
  | "unverified"
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
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function highRiskFilesFromCard(card: ProvocationCard): string[] {
  const metadata = card.metadata ?? {};
  const explicit = metadataStringArray(metadata.highRiskFiles);
  if (explicit.length > 0) return explicit;
  if (metadata.highRisk === true) return metadataStringArray(metadata.changedFiles);
  return [];
}

export function deriveDecisionGatePolicy(input: DecisionGatePolicyInput): DecisionGatePolicy {
  const statusIds = new Set((input.verificationStatuses ?? []).map((item) => item.id));
  const agencyIds = new Set((input.agencyState?.items ?? []).map((item) => item.id));
  const observed =
    statusIds.has("app_launched") ||
    statusIds.has("preview_checked") ||
    statusIds.has("manual_observation") ||
    agencyIds.has("verified_with_evidence");
  const hasVerifiedEvidence = hasConcreteVerification({
    statusIds: [...statusIds],
    testResult: input.verifyLog?.test_result ?? null,
    manualOrPreviewObserved: observed,
    acceptanceCriterionConfirmed: input.acceptanceCriterionConfirmed,
    manualObservationCount: statusIds.has("manual_observation") ? 1 : 0,
  });
  const aiSelfReportOnly = Boolean(
    !hasVerifiedEvidence &&
    (statusIds.has("ai_self_report_only") ||
      agencyIds.has("ai_self_report_only") ||
      (input.verifyLog?.intent_match === true && input.verifyLog.test_result === "skipped")),
  );
  const failedTest = Boolean(
    input.verifyLog?.test_result === "fail" ||
    statusIds.has("failed_but_accepted") ||
    agencyIds.has("verification_failed"),
  );
  const highRiskFiles = [
    ...new Set(
      (input.provocationCards ?? [])
        .filter((card) => card.type === "diff_scope_drift" && card.severity === "risk")
        .flatMap(highRiskFilesFromCard),
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
  if (!hasVerifiedEvidence && !aiSelfReportOnly && !failedTest && !canDeferVerification) {
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
