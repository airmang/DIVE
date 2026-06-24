import { AlertTriangle, CheckCircle2, Eye, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { useT } from "../../i18n";
import { normalizeSupervisorRenderMode } from "./adapters";
import type {
  ProvocationAction,
  ProvocationCard as ProvocationCardData,
  SupervisorSourceUiMode,
} from "./types";

interface ProvocationCardProps {
  card: ProvocationCardData;
  mode: SupervisorSourceUiMode;
  onAction?: (action: ProvocationAction, reason?: string) => void;
  onDismiss?: () => void;
  onMarkIrrelevant?: () => void;
}

const EVIDENCE_LIMIT = 3;
const ACTION_LIMIT = 3;
const REVIEW_CARD_TONE = "border-warn/50 bg-warn/10";
const REVIEW_ICON_TONE = "text-warn";
// The review card is a provocation: it surfaces a criterion-linked question so
// the user pauses and decides what to do. We only render actions that actually
// open the artifact to look at (diff/preview/run) or a recovery path. The
// "revise the request/plan" and "ask the AI to do X" nudges are intentionally
// NOT shown as buttons — they only seed a prompt or focus a field, which reads
// as a broken affordance, and the user can drive that follow-up themselves (the
// dedicated screens still expose request-changes / edit-PRD controls).
const HIDDEN_ACTION_KINDS: ReadonlySet<ProvocationAction["kind"]> = new Set([
  "continue_with_risk",
  "dismiss",
  "mark_irrelevant",
  "add_acceptance_criteria",
  "link_criterion",
  "split_scope",
  "edit_prd",
  "add_verification_step",
  "ask_ai_for_rationale",
  "create_repro_steps",
  "retry_with_ai",
]);

export function ProvocationCard({
  card,
  mode,
  onAction,
  onDismiss,
  onMarkIrrelevant,
}: ProvocationCardProps) {
  const t = useT();
  const [pendingReasonAction, setPendingReasonAction] = useState<ProvocationAction | null>(null);
  const [reason, setReason] = useState("");
  const canonicalMode = normalizeSupervisorRenderMode(mode);
  const focalQuestion = card.prompt?.trim() || card.message.trim() || card.title.trim();
  const title = card.title.trim();
  const message = card.message.trim();
  const guidedExplanation =
    canonicalMode === "guided"
      ? card.modeCopy?.guided?.trim() || card.modeCopy?.work?.trim() || message
      : "";
  const showGuidedExplanation =
    canonicalMode === "guided" &&
    guidedExplanation.length > 0 &&
    guidedExplanation !== focalQuestion;
  const secondaryMessage =
    message.length > 0 && message !== focalQuestion && message !== guidedExplanation ? message : "";
  const visibleEvidence = card.evidence.slice(0, EVIDENCE_LIMIT);
  const visibleActionCandidates = card.actions.filter(
    (action) => !HIDDEN_ACTION_KINDS.has(action.kind),
  );
  const requestedPrimaryAction = card.primaryActionId
    ? visibleActionCandidates.find((action) => action.id === card.primaryActionId)
    : undefined;
  const primaryAction = requestedPrimaryAction ?? visibleActionCandidates[0];
  const visibleActions = primaryAction
    ? [
        primaryAction,
        ...visibleActionCandidates.filter((action) => action.id !== primaryAction.id),
      ].slice(0, ACTION_LIMIT)
    : [];
  const secondaryActions = visibleActions.slice(1);
  const hiddenEvidenceCount = Math.max(0, card.evidence.length - visibleEvidence.length);
  const hiddenActionCount = Math.max(0, visibleActionCandidates.length - visibleActions.length);
  const showDetails =
    (title.length > 0 && title !== focalQuestion) ||
    secondaryMessage.length > 0 ||
    hiddenEvidenceCount > 0 ||
    hiddenActionCount > 0;

  const chooseAction = (action: ProvocationAction) => {
    if (action.disabledReason) return;
    if (action.requiresReason) {
      setPendingReasonAction(action);
      return;
    }
    onAction?.(action);
  };

  const submitReason = () => {
    const action = pendingReasonAction;
    const trimmed = reason.trim();
    if (!action || !trimmed) return;
    onAction?.(action, trimmed);
    setPendingReasonAction(null);
    setReason("");
  };

  const renderAction = (action: ProvocationAction, emphasized = false) => {
    const disabled = Boolean(action.disabledReason);
    return (
      <Button
        key={action.id}
        type="button"
        variant={emphasized ? "primary" : "outline"}
        size="sm"
        disabled={disabled}
        title={action.disabledReason}
        aria-label={action.label}
        onClick={() => chooseAction(action)}
        data-testid={emphasized ? "provocation-primary-action" : "provocation-action"}
        data-provocation-action="visible"
        data-action-kind={action.kind}
        data-disabled-reason={action.disabledReason}
      >
        <span>{action.label}</span>
        {action.disabledReason ? (
          <span className="ml-1 text-[10px] text-fg-subtle">{action.disabledReason}</span>
        ) : null}
      </Button>
    );
  };

  return (
    <aside
      className={cn("rounded-md border border-l-4 px-3 py-3 text-sm shadow-sm", REVIEW_CARD_TONE)}
      data-testid="provocation-card"
      data-card-family="review-card"
      data-card-type={card.type}
      data-severity={card.severity}
      data-mode={canonicalMode}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", REVIEW_ICON_TONE)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-warn">
                <span>{t("roadmap.step_detail.review_card_label")}</span>
                {title.length > 0 && title !== focalQuestion ? (
                  <span className="truncate normal-case tracking-normal text-fg-muted">
                    {title}
                  </span>
                ) : null}
              </div>
              <p
                className="mt-2 text-base font-semibold leading-snug text-fg"
                data-testid="provocation-focal-question"
                data-focal="true"
              >
                {focalQuestion}
              </p>
              {showGuidedExplanation ? (
                <p
                  className="mt-1 truncate text-xs leading-snug text-fg-muted"
                  title={guidedExplanation}
                  data-testid="provocation-guided-explanation"
                >
                  {guidedExplanation}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              {onMarkIrrelevant ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("roadmap.step_detail.review_card_mark_irrelevant_aria")}
                  onClick={onMarkIrrelevant}
                  data-testid="provocation-mark-irrelevant"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              {onDismiss ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("roadmap.step_detail.review_card_dismiss_aria")}
                  onClick={onDismiss}
                  data-testid="provocation-dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          {visibleEvidence.length > 0 ? (
            <div
              className="mt-3 flex flex-wrap gap-1.5"
              aria-label={t("roadmap.step_detail.review_card_evidence_aria")}
              data-testid="provocation-evidence"
              data-evidence-count={visibleEvidence.length}
            >
              {visibleEvidence.map((item) => (
                <span
                  key={`${item.source}:${item.label}:${item.value ?? ""}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border/80 bg-bg/70 px-2 py-0.5 text-[11px] text-fg"
                  data-testid="provocation-evidence-chip"
                >
                  <Eye className="h-3 w-3 shrink-0 text-fg-muted" aria-hidden />
                  <span className="font-semibold">{item.label}</span>
                  {item.value ? <span className="truncate text-fg-muted">{item.value}</span> : null}
                </span>
              ))}
            </div>
          ) : null}

          {showDetails ? (
            <details
              className="mt-3 rounded-md border border-warn/20 bg-bg/60 px-2 py-1.5 text-[11px]"
              data-testid="provocation-secondary-details"
            >
              <summary
                className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                aria-label={t("roadmap.step_detail.review_card_details_aria")}
              >
                {t("roadmap.step_detail.review_card_details_toggle")}
              </summary>
              <div className="mt-2 space-y-1.5 text-fg-muted">
                {secondaryMessage ? (
                  <p data-testid="provocation-secondary-message">{secondaryMessage}</p>
                ) : null}
                {hiddenEvidenceCount > 0 ? (
                  <p>
                    {t("roadmap.step_detail.review_card_hidden_evidence_count", {
                      count: hiddenEvidenceCount,
                    })}
                  </p>
                ) : null}
                {hiddenActionCount > 0 ? (
                  <p>
                    {t("roadmap.step_detail.review_card_hidden_action_count", {
                      count: hiddenActionCount,
                    })}
                  </p>
                ) : null}
              </div>
            </details>
          ) : null}

          {pendingReasonAction ? (
            <div className="mt-3 rounded-md border bg-bg/70 p-2">
              <label
                className="text-[11px] font-medium text-fg"
                data-testid="provocation-risk-reason-label"
              >
                {pendingReasonAction?.reasonPrompt ??
                  t("roadmap.step_detail.review_card_reason_fallback")}
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                aria-label={t("roadmap.step_detail.review_card_reason_aria")}
                className="mt-1 w-full resize-none rounded-md border bg-bg-panel2 px-2 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="provocation-risk-reason"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("common.cancel")}
                  onClick={() => {
                    setPendingReasonAction(null);
                    setReason("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={reason.trim().length === 0}
                  aria-label={t("roadmap.step_detail.review_card_reason_submit")}
                  onClick={submitReason}
                  data-testid="provocation-risk-submit"
                >
                  {t("roadmap.step_detail.review_card_reason_submit")}
                </Button>
              </div>
            </div>
          ) : null}

          {!pendingReasonAction && visibleActions.length > 0 ? (
            <div
              className="mt-3 flex flex-wrap gap-1.5"
              data-testid="provocation-actions"
              data-action-count={visibleActions.length}
            >
              {primaryAction ? renderAction(primaryAction, true) : null}
              {secondaryActions.map((action) => renderAction(action))}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export default ProvocationCard;
