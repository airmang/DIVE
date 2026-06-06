import { GitBranch, Play } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { PlanRoadmapStep } from "../../features/roadmap";
import { PlanStep } from "./PlanStep";
import type { PlanActionHandlers } from "./types";

interface PlanParallelGroupProps {
  steps: PlanRoadmapStep[];
  bucket: string;
  currentStepId: number | null;
  busyStepId: number | null;
  actions?: PlanActionHandlers;
  onStartGroup: (steps: PlanRoadmapStep[], bucket: string) => void;
  onActionStart: (stepId: number) => void;
  onActionEnd: () => void;
  onActionError: (item: PlanRoadmapStep, error: unknown) => void;
  setStepRef: (id: number, node: HTMLDivElement | null) => void;
}

function bucketLabel(bucket: string) {
  return bucket.startsWith("explicit:") ? bucket.replace(/^explicit:/, "") : null;
}

export function PlanParallelGroup({
  steps,
  bucket,
  currentStepId,
  busyStepId,
  actions,
  onStartGroup,
  onActionStart,
  onActionEnd,
  onActionError,
  setStepRef,
}: PlanParallelGroupProps) {
  const t = useT();
  const readyCount = steps.filter((item) => item.status === "ready").length;
  const label = bucketLabel(bucket);

  return (
    <div
      className="plan-twin-rails my-1"
      data-testid="plan-parallel-group"
      data-parallel-bucket={bucket}
    >
      <div className="grid grid-cols-[54px_minmax(0,1fr)]">
        <div className="col-start-2 flex min-w-0 items-center justify-between gap-2 py-3 pl-1">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-fg">
            <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {label ? t("plan_view.parallel_named", { name: label }) : t("plan_view.parallel")}
            </span>
          </span>
          {actions ? (
            <button
              type="button"
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border px-2.5",
                "font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-fg",
                "hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-45",
              )}
              disabled={readyCount === 0}
              onClick={() => onStartGroup(steps, bucket)}
              data-testid="plan-roadmap-start-group"
              aria-label={t("plan_view.run_group_aria", { count: readyCount })}
            >
              <Play className="h-3 w-3" aria-hidden />
              {t("plan_view.run_group", { count: readyCount })}
            </button>
          ) : null}
        </div>
      </div>
      {steps.map((item) => (
        <PlanStep
          key={item.step.id}
          ref={(node) => setStepRef(item.step.id, node)}
          item={item}
          current={item.step.id === currentStepId}
          busy={busyStepId === item.step.id}
          parallel
          lineUp="none"
          lineDown="none"
          actions={actions}
          onActionStart={onActionStart}
          onActionEnd={onActionEnd}
          onActionError={onActionError}
        />
      ))}
    </div>
  );
}
