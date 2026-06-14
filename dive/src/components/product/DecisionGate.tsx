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
import {
  deriveDecisionGatePolicy,
  type DecisionGatePolicyInput,
  type DecisionGateRiskReasonId,
} from "./decisionGatePolicy";

const REASON_LABEL_KEY: Record<DecisionGateRiskReasonId, string> = {
  unverified: "roadmap.step_detail.decision_reason_unverified",
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
      }),
    [
      acceptanceCriterionConfirmed,
      agencyState,
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
    .map((item) => item.label);
  const summary = policy.hasVerifiedEvidence
    ? t("roadmap.step_detail.decision_summary_verified")
    : policy.canDeferVerification
      ? t("roadmap.step_detail.decision_summary_deferred")
      : policy.requiresReason
        ? t("roadmap.step_detail.decision_summary_risk")
        : t("roadmap.step_detail.decision_summary_missing");

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
      className="rounded-md border border-border bg-bg-panel2 px-3 py-3"
      data-testid="decision-gate"
      data-reason-required={policy.requiresReason ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
            {t("roadmap.step_detail.decision_title")}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{summary}</p>
        </div>
        {policy.requiresReason ? (
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
        <div
          className="mt-2 rounded-sm border border-danger/40 bg-danger/5 px-2 py-2 text-[11px] text-fg"
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
      ) : null}

      {policy.requiresReason ? (
        <label className="mt-3 block text-[11px] font-medium text-fg">
          {t("roadmap.step_detail.decision_reason_label")}
          <textarea
            value={riskReason}
            onChange={(event) => setRiskReason(event.target.value)}
            rows={2}
            className="mt-1 w-full resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t("roadmap.step_detail.decision_reason_placeholder")}
            data-testid="decision-gate-risk-reason"
          />
        </label>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={!policy.canApproveDirectly}
          onClick={onApprove}
          data-testid="decision-gate-approve"
        >
          <CheckCircle2 />
          {t("roadmap.step_detail.decision_approve")}
        </Button>
        {policy.canDeferVerification ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
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
          onClick={onRequestChanges}
          data-testid="decision-gate-request-changes"
        >
          <AlertTriangle />
          {t("roadmap.step_detail.decision_request_changes")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={verifyRunning}
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
          onClick={() => onStop(t("roadmap.step_detail.decision_stop_note"))}
          data-testid="decision-gate-stop"
        >
          <StopCircle />
          {t("roadmap.step_detail.decision_stop")}
        </Button>
      </div>

      {!policy.canApproveDirectly ? (
        <p className="mt-2 text-[10px] text-fg-muted" data-testid="decision-gate-approve-note">
          {t("roadmap.step_detail.decision_plain_approve_blocked")}
        </p>
      ) : null}
    </section>
  );
}

export default DecisionGate;
