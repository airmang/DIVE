import { AlertCircle, CheckCircle2, Lock, Play } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import type { PlanRoadmapStep, StepSessionMappingRow } from "../../features/roadmap";

interface RoadmapGraphProps {
  goal: string | null;
  steps: PlanRoadmapStep[];
  loading: boolean;
  error: string | null;
  onOpenStep: (stepId: number, opts?: { focus?: boolean }) => Promise<StepSessionMappingRow>;
  onOpenSession: (sessionId: number) => void;
}

const STATUS_CLASS = {
  blocked: "border-border bg-bg-panel text-fg-muted",
  ready: "border-accent/60 bg-accent/10 text-accent",
  in_progress: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  shipped: "border-success/70 bg-success/15 text-success",
};

const STATUS_ICON = {
  blocked: Lock,
  ready: Play,
  in_progress: AlertCircle,
  done: CheckCircle2,
  shipped: CheckCircle2,
};

export function RoadmapGraph({
  goal,
  steps,
  loading,
  error,
  onOpenStep,
  onOpenSession,
}: RoadmapGraphProps) {
  const t = useT();

  if (loading) {
    return <div className="px-4 py-3 text-xs text-fg-muted">{t("common.loading")}</div>;
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-danger">{error}</div>;
  }

  if (steps.length === 0) {
    return null;
  }

  return (
    <section className="border-b bg-bg-panel" data-testid="plan-roadmap-graph">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-fg">{goal ?? t("roadmap.title")}</h2>
          <p className="text-xs text-fg-muted">
            {t("roadmap.plan_graph.summary", {
              total: steps.length,
              ready: steps.filter((item) => item.status === "ready").length,
              blocked: steps.filter((item) => item.status === "blocked").length,
            })}
          </p>
        </div>
      </header>
      <ol className="max-h-72 space-y-2 overflow-y-auto px-3 pb-3">
        {steps.map((item) => {
          const Icon = STATUS_ICON[item.status];
          const canOpen = item.status === "ready";
          const canNavigate =
            item.status === "in_progress" &&
            item.mapping?.session_id !== null &&
            item.mapping?.session_id !== undefined;
          return (
            <li
              key={item.step.id}
              className={cn("rounded-md border p-3", STATUS_CLASS[item.status])}
              data-testid="plan-roadmap-step"
              data-plan-step-status={item.status}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-fg-muted">
                    <span>{item.step.step_id}</span>
                    <span>{t(`roadmap.plan_graph.status.${item.status}`)}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-fg">{item.step.title}</div>
                  {item.blockedDependencies.length > 0 ? (
                    <div className="mt-1 text-xs text-fg-muted">
                      {t("roadmap.plan_graph.waiting_for", {
                        deps: item.blockedDependencies.join(", "),
                      })}
                    </div>
                  ) : null}
                </div>
                {canOpen ? (
                  <Button size="sm" variant="outline" onClick={() => void onOpenStep(item.step.id)}>
                    {t("common.open")}
                  </Button>
                ) : null}
                {canNavigate && item.mapping?.session_id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenSession(item.mapping!.session_id!)}
                  >
                    {t("roadmap.plan_graph.resume")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
