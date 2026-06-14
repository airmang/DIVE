import { ChevronRight, ClipboardCheck, RefreshCw } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { PlanRoadmapStep } from "../../features/roadmap";
import type { PlanSummary } from "./types";
import { isPlanStepComplete } from "./plan-status-meta";

interface PlanHeaderProps {
  projectName: string | null;
  goal: string | null;
  steps: PlanRoadmapStep[];
  summary: PlanSummary;
  minimapOpen: boolean;
  loading: boolean;
  planReviewPending?: boolean;
  onToggleMinimap: () => void;
  onRefresh: () => void;
  onReviewPlan?: () => void;
}

export function PlanHeader({
  projectName,
  goal,
  steps,
  summary,
  minimapOpen,
  loading,
  planReviewPending = false,
  onToggleMinimap,
  onRefresh,
  onReviewPlan,
}: PlanHeaderProps) {
  const t = useT();

  return (
    <header className="shrink-0 border-b px-5 py-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-fg">
        {t("plan_view.eyebrow")}
      </div>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold leading-tight text-fg">
            {projectName ?? t("plan_view.default_title")}
          </h2>
          {goal ? <p className="mt-1 line-clamp-2 text-xs text-fg">{goal}</p> : null}
        </div>
        <div className="shrink-0 text-right font-mono">
          <div className="text-2xl font-extrabold leading-none">
            <span className="text-fg">{String(summary.completed).padStart(2, "0")}</span>
            <span className="text-fg">/{String(summary.total).padStart(2, "0")}</span>
          </div>
          <div className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.18em] text-fg">
            {t("plan_view.done")}
          </div>
        </div>
      </div>
      {steps.length > 0 ? (
        <div
          className="mt-4 flex gap-1"
          role="progressbar"
          aria-label={t("roadmap.progress_aria")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.percent}
        >
          {steps.map((item) => (
            <span
              key={item.step.id}
              className={cn(
                "h-1 min-w-0 flex-1 bg-bg-panel2",
                isPlanStepComplete(item.status) && "bg-success",
                item.status === "in_progress" &&
                  "bg-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.45)]",
              )}
            />
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-sm font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg hover:text-accent"
          onClick={onToggleMinimap}
          aria-expanded={minimapOpen}
          aria-controls="plan-minimap"
          data-testid="plan-minimap-toggle"
        >
          <ChevronRight
            className={cn("h-3 w-3 transition-transform", minimapOpen && "rotate-90")}
          />
          {minimapOpen ? t("plan_view.hide_minimap") : t("plan_view.show_minimap")}
        </button>
        <span className="flex-1" />
        {planReviewPending && onReviewPlan ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm border border-warn/45 bg-warn/10 px-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg hover:border-warn hover:text-warn"
            onClick={onReviewPlan}
            data-testid="plan-review-open"
          >
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
            {t("plan_view.actions.review_plan")}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-sm p-1 text-fg-muted hover:text-fg"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t("roadmap.refresh")}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
        </button>
      </div>
    </header>
  );
}
