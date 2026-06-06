import { cn } from "../../lib/utils";
import { planStatusMeta } from "./plan-status-meta";
import type { PlanRoadmapStatus } from "../../features/roadmap";

interface PlanStepNodeProps {
  status: PlanRoadmapStatus;
  current?: boolean;
  mini?: boolean;
}

export function PlanStepNode({ status, current = false, mini = false }: PlanStepNodeProps) {
  const meta = planStatusMeta(status);
  const Icon = meta.icon;
  const ready = status === "ready";

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-2 bg-bg-panel",
        mini ? "h-[22px] w-[22px]" : "h-[26px] w-[26px]",
        meta.nodeClass,
        current && status !== "in_progress" && "shadow-[0_0_0_4px_rgb(var(--color-accent)/0.16)]",
      )}
    >
      {ready ? (
        <span className={cn("rounded-full bg-accent", mini ? "h-1.5 w-1.5" : "h-2 w-2")} />
      ) : null}
      {!ready ? <Icon className={mini ? "h-3 w-3" : "h-3.5 w-3.5"} /> : null}
    </span>
  );
}
