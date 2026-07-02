import { AlertTriangle, FilePlus2, X } from "lucide-react";
import type { RoadmapActionFailure } from "../../features/roadmap";
import { useT } from "../../i18n";

export function PlanLoading() {
  return (
    <div className="space-y-3 px-5 py-4" data-testid="plan-loading">
      {[0, 1, 2].map((item) => (
        <div key={item} className="grid animate-pulse grid-cols-[54px_minmax(0,1fr)]">
          <div className="mx-auto h-6 w-6 rounded-full bg-bg-panel2" />
          <div className="space-y-2 py-1">
            <div className="h-3 w-28 bg-bg-panel2" />
            <div className="h-4 w-4/5 bg-bg-panel2" />
            <div className="h-3 w-2/3 bg-bg-panel2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlanEmpty({ onCreatePlan }: { onCreatePlan?: () => void }) {
  const t = useT();
  return (
    <div
      className="flex h-full items-center justify-center px-6 py-8 text-center"
      data-testid="plan-empty"
    >
      <div>
        <FilePlus2 className="mx-auto h-7 w-7 text-accent" aria-hidden />
        <h3 className="mt-3 text-sm font-semibold text-fg">{t("plan_view.empty_title")}</h3>
        <p className="mt-2 text-xs text-fg">{t("plan_view.empty_description")}</p>
        {onCreatePlan ? (
          <button
            type="button"
            className="mt-4 rounded-md border border-accent-hover bg-accent-hover px-3 py-2 text-xs font-semibold text-accent-fg dark:border-accent dark:bg-accent"
            onClick={onCreatePlan}
            data-testid="plan-empty-cta"
          >
            {t("plan_view.empty_cta")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PlanError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div
      className="border-b border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger"
      data-testid="plan-error"
    >
      <span className="font-semibold text-fg">{t("plan_view.error_title")}</span>
      <span className="text-fg-muted"> - </span>
      {message}
      <button type="button" className="ml-2 font-semibold text-fg underline" onClick={onRetry}>
        {t("plan_view.retry")}
      </button>
    </div>
  );
}

export function PlanFailure({
  failures,
  onDismiss,
}: {
  failures: RoadmapActionFailure[];
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div
      className="border-b border-danger/30 bg-danger/10 px-4 py-3 text-xs"
      data-testid="roadmap-action-failure"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1 text-danger">
          <div className="font-semibold text-fg">
            {t("roadmap.action_failure.title", { count: failures.length })}
          </div>
          {failures.map((failure) => (
            <div
              key={`${failure.occurredAt}:${failure.stepLabel}:${failure.message}`}
              className="mt-1"
            >
              <span className="font-medium text-fg">{failure.stepLabel}</span>
              <span className="text-fg-muted"> - </span>
              {failure.message}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="rounded-sm p-1 text-fg-muted hover:text-fg"
          onClick={onDismiss}
          aria-label={t("roadmap.action_failure.dismiss")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
