import { Button } from "../ui/button";
import { Sparkles, ListChecks, PencilLine } from "lucide-react";
import { useT } from "../../i18n";
import type { PlanDraft } from "../../features/planning";

interface PlanDraftFloatingCardProps {
  draft: PlanDraft | null;
  planAccepted: boolean;
  onOpenReview: () => void;
  onAccept: () => void;
  onRequestChanges: () => void;
}

export function PlanDraftFloatingCard({
  draft,
  planAccepted,
  onOpenReview,
  onAccept,
  onRequestChanges,
}: PlanDraftFloatingCardProps) {
  const t = useT();
  if (!draft || planAccepted) return null;

  return (
    <div
      role="region"
      aria-label={t("planning.floating.aria_label")}
      data-testid="plan-draft-floating-card"
      className="pointer-events-auto mx-auto mt-3 w-[min(560px,100%-2rem)] rounded-lg border border-accent/50 bg-bg-panel/95 p-3 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t("planning.floating.title")}
          </div>
          <div className="mt-0.5 truncate text-sm font-bold text-fg">{draft.goal}</div>
          <div className="mt-1 line-clamp-2 text-xs text-fg-muted">{draft.mvp}</div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3 w-3" aria-hidden />
              {t("planning.floating.step_count", { count: draft.steps.length })}
            </span>
            {draft.successCriteria.length > 0 && (
              <span>
                {t("planning.floating.success_count", {
                  count: draft.successCriteria.length,
                })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onAccept}
          data-testid="plan-draft-accept"
        >
          {t("planning.floating.accept")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenReview}
          data-testid="plan-draft-review"
        >
          {t("planning.floating.review")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRequestChanges}
          data-testid="plan-draft-request-changes"
        >
          <PencilLine />
          {t("planning.floating.request_changes")}
        </Button>
      </div>
    </div>
  );
}
