import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RotateCcw,
  ShieldAlert,
  StopCircle,
} from "lucide-react";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
import { VERIFICATION_STATUS_LABEL_KEY } from "../../features/provocation";
import {
  deriveDecisionGatePolicy,
  type DecisionGatePolicyInput,
  type DecisionGateRiskReasonId,
} from "./decisionGatePolicy";

const REASON_LABEL_KEY: Record<DecisionGateRiskReasonId, string> = {
  unverified: "roadmap.step_detail.decision_reason_unverified",
  criteria_unobserved: "roadmap.step_detail.decision_reason_criteria_unobserved",
  ai_self_report_only: "roadmap.step_detail.decision_reason_ai_self_report_only",
  failed_test: "roadmap.step_detail.decision_reason_failed_test",
  high_risk_unexpected_files: "roadmap.step_detail.decision_reason_high_risk_files",
  rollback_unavailable: "roadmap.step_detail.decision_reason_rollback_unavailable",
};

interface DecisionGateProps extends DecisionGatePolicyInput {
  verifyRunning?: boolean;
  onApprove: () => void;
  onAcceptRisk: (reason: string) => void;
  onDeferVerification: () => void;
  onRequestChanges: () => void;
  onVerifyFirst: () => void;
  onRevert: () => void;
  onStop: (note: string) => void;
}

export function DecisionGate({
  verificationStatuses = [],
  agencyState = null,
  provocationCards = [],
  verifyLog = null,
  rollbackAvailable = false,
  acceptanceCriterionConfirmed = false,
  verificationFeasibility,
  gatingCriterionIds = [],
  observedCriterionIds = [],
  verifyRunning = false,
  onApprove,
  onAcceptRisk,
  onDeferVerification,
  onRequestChanges,
  onVerifyFirst,
  onRevert,
  onStop,
}: DecisionGateProps) {
  const t = useT();
  const [riskReason, setRiskReason] = useState("");
  const policy = useMemo(
    () =>
      deriveDecisionGatePolicy({
        verificationStatuses,
        agencyState,
        provocationCards,
        verifyLog,
        rollbackAvailable,
        acceptanceCriterionConfirmed,
        verificationFeasibility,
        gatingCriterionIds,
        observedCriterionIds,
      }),
    [
      acceptanceCriterionConfirmed,
      agencyState,
      gatingCriterionIds,
      observedCriterionIds,
      provocationCards,
      rollbackAvailable,
      verificationFeasibility,
      verificationStatuses,
      verifyLog,
    ],
  );
  const riskReasonOk = riskReason.trim().length > 0;
  const evidenceLabels = verificationStatuses
    .filter((item) => item.evidenceBacked)
    .map((item) => t(VERIFICATION_STATUS_LABEL_KEY[item.id]));
  const summary = policy.hasVerifiedEvidence
    ? t("roadmap.step_detail.decision_summary_verified")
    : policy.canDeferVerification
      ? t("roadmap.step_detail.decision_summary_deferred")
      : policy.requiresReason
        ? t("roadmap.step_detail.decision_summary_risk")
        : t("roadmap.step_detail.decision_summary_missing");
  const blockedApprovalNote = policy.canDeferVerification
    ? t("roadmap.step_detail.decision_defer_note")
    : t("roadmap.step_detail.decision_plain_approve_blocked");

  const submitRiskApproval = () => {
    const trimmed = riskReason.trim();
    if (policy.requiresReason && trimmed.length === 0) return;
    onAcceptRisk(trimmed);
  };
  const submitDeferredVerification = () => {
    onDeferVerification();
  };

  return (
    <section
      className="mt-1 text-xs"
      data-testid="decision-gate"
      data-card-family="decision-gate"
      data-reason-required={policy.requiresReason ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
            {t("roadmap.step_detail.decision_title")}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{summary}</p>
        </div>
        {policy.canDeferVerification ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-info/50 bg-info/10 px-2 py-0.5 text-[10px] font-semibold text-info"
            data-testid="decision-gate-defer-badge"
          >
            <Clock3 className="h-3 w-3" aria-hidden />
            {t("roadmap.step_detail.decision_defer_badge")}
          </span>
        ) : policy.requiresReason ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-danger/60 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger"
            data-testid="decision-gate-risk-badge"
          >
            <ShieldAlert className="h-3 w-3" aria-hidden />
            {t("roadmap.step_detail.decision_risk_badge")}
          </span>
        ) : null}
      </div>

      {evidenceLabels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="decision-gate-evidence">
          {evidenceLabels.map((label) => (
            <span
              key={label}
              className="inline-flex rounded-sm border border-success/50 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {policy.reasons.length > 0 ? (
        <details
          className="mt-3 rounded-md border border-border/80 bg-bg/60 px-2 py-1.5 text-[11px]"
          data-testid="decision-gate-details"
        >
          <summary
            className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            aria-label={t("roadmap.step_detail.decision_details_aria")}
          >
            {t("roadmap.step_detail.decision_details_toggle")}
          </summary>
          <div
            className="mt-2 rounded-sm border border-danger/40 bg-danger/5 px-2 py-2 text-fg"
            data-testid="decision-gate-reasons"
          >
            <div className="font-semibold">{t("roadmap.step_detail.decision_reason_title")}</div>
            <ul className="mt-1 space-y-1">
              {policy.reasons.map((reason) => (
                <li key={reason.id}>
                  {t(REASON_LABEL_KEY[reason.id])}
                  {reason.evidence ? (
                    <span className="ml-1 text-fg-muted">({reason.evidence})</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="decision-gate-primary-actions">
        <Button
          type="button"
          size="sm"
          disabled={!policy.canApproveDirectly}
          aria-label={t("roadmap.step_detail.decision_approve")}
          onClick={onApprove}
          data-testid="decision-gate-approve"
        >
          <CheckCircle2 />
          {t("roadmap.step_detail.decision_approve")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("roadmap.step_detail.decision_request_changes")}
          onClick={onRequestChanges}
          data-testid="decision-gate-request-changes"
        >
          <AlertTriangle />
          {t("roadmap.step_detail.decision_request_changes")}
        </Button>
      </div>

      <details className="mt-2 text-[11px]" data-testid="decision-gate-more">
        <summary className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
          {t("roadmap.step_detail.decision_more")}
        </summary>
        <div className="mt-2 space-y-3">
          {policy.requiresReason ? (
            <label className="block text-[11px] font-medium text-fg">
              {t("roadmap.step_detail.decision_reason_label")}
              <textarea
                value={riskReason}
                onChange={(event) => setRiskReason(event.target.value)}
                rows={2}
                aria-label={t("roadmap.step_detail.decision_reason_textarea_aria")}
                className="mt-1 w-full resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={t("roadmap.step_detail.decision_reason_placeholder")}
                data-testid="decision-gate-risk-reason"
              />
            </label>
          ) : null}

          <div className="flex flex-wrap gap-1.5" data-testid="decision-gate-more-actions">
            {policy.canDeferVerification ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("roadmap.step_detail.decision_defer_verification")}
                onClick={submitDeferredVerification}
                data-testid="decision-gate-defer-verification"
                data-decision-outcome="verification_deferred"
              >
                <Clock3 />
                {t("roadmap.step_detail.decision_defer_verification")}
              </Button>
            ) : null}
            {policy.requiresReason ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={!riskReasonOk}
                aria-label={t("roadmap.step_detail.decision_accept_risk")}
                onClick={submitRiskApproval}
                data-testid="decision-gate-risk-approve"
                data-decision-outcome="continue_with_risk"
              >
                <ShieldAlert />
                {t("roadmap.step_detail.decision_accept_risk")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={verifyRunning}
              aria-label={t("roadmap.step_detail.decision_verify_first")}
              onClick={onVerifyFirst}
              data-testid="decision-gate-verify-first"
            >
              <Clock3 />
              {t("roadmap.step_detail.decision_verify_first")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("roadmap.step_detail.decision_revert")}
              onClick={onRevert}
              data-testid="decision-gate-revert"
            >
              <RotateCcw />
              {t("roadmap.step_detail.decision_revert")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("roadmap.step_detail.decision_stop")}
              onClick={() => onStop(t("roadmap.step_detail.decision_stop_note"))}
              data-testid="decision-gate-stop"
            >
              <StopCircle />
              {t("roadmap.step_detail.decision_stop")}
            </Button>
          </div>
        </div>
      </details>

      {!policy.canApproveDirectly ? (
        <p className="mt-2 text-[10px] text-fg-muted" data-testid="decision-gate-approve-note">
          {blockedApprovalNote}
        </p>
      ) : null}
    </section>
  );
}

export default DecisionGate;
