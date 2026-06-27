import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
import type { PlanDraftLlmErrorReason } from "../../features/planning/usePlanInterviewLLM";

interface Props {
  reason: PlanDraftLlmErrorReason;
  unresolvedQuestions?: string[];
  busy?: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}

export function PlanDraftRecoveryScreen({
  reason,
  unresolvedQuestions = [],
  busy,
  onRetry,
  onDismiss,
}: Props) {
  const t = useT();
  const missingItems = unresolvedQuestions.map((item) => item.trim()).filter(Boolean);
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center bg-bg px-6 py-8"
      data-testid="plan-draft-recovery"
      data-reason={reason}
      role="status"
    >
      <div className="w-full max-w-2xl rounded-lg border border-warn/40 bg-warn/10 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-fg">
              {t(`planning.interview.recovery.${reason}.title`)}
            </p>
            <p className="mt-1 text-sm leading-6 text-fg-muted">
              {t(`planning.interview.recovery.${reason}.description`)}
            </p>
            {missingItems.length > 0 ? (
              <div className="mt-3" data-testid="plan-draft-recovery-missing-items">
                <p className="text-xs font-semibold text-fg">
                  {t("planning.interview.recovery.missing_items_title")}
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-fg-muted">
                  {missingItems.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-fg-muted">
              {t("planning.interview.recovery.hints")
                .split("|")
                .map((hint) => hint.trim())
                .filter(Boolean)
                .map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
            </ul>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            disabled={busy}
            data-testid="plan-draft-recovery-dismiss"
          >
            <X className="h-3.5 w-3.5" />
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onRetry}
            disabled={busy}
            data-testid="plan-draft-recovery-retry"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("planning.interview.recovery.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PlanDraftRecoveryScreen;
