import { useEffect, useMemo, useRef, useState } from "react";
import {
  makeRoadmapActionFailure,
  type PlanRoadmapStep,
  type RoadmapActionFailure,
} from "../../features/roadmap";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { isPlanStepComplete } from "./plan-status-meta";
import { PlanEmpty, PlanError, PlanFailure, PlanLoading } from "./PlanFeedback";
import { PlanHeader } from "./PlanHeader";
import { PlanMiniMap } from "./PlanMiniMap";
import { PlanTimeline } from "./PlanTimeline";
import type { PlanActionHandlers, PlanSummary, PlanViewRoadmapModel } from "./types";

interface PlanViewProps {
  roadmap: PlanViewRoadmapModel;
  projectName: string | null;
  actions: PlanActionHandlers;
  className?: string;
}

function summarizePlan(steps: PlanRoadmapStep[]): PlanSummary {
  const total = steps.length;
  const completed = steps.filter((item) => isPlanStepComplete(item.status)).length;
  const ready = steps.filter((item) => item.status === "ready").length;
  const blocked = steps.filter((item) => item.status === "blocked").length;
  const active = steps.filter((item) => item.status === "in_progress").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const overall =
    total > 0 && completed === total
      ? "done"
      : ready === 0 && active === 0 && blocked > 0
        ? "halted"
        : "in_progress";
  return { total, completed, ready, blocked, active, percent, overall };
}

function currentStepFor(steps: PlanRoadmapStep[]) {
  // No actionable step (e.g. plan fully complete) → no "current" highlight/auto-scroll.
  return (
    steps.find((item) => item.status === "in_progress") ??
    steps.find((item) => item.status === "ready") ??
    steps.find((item) => item.status === "blocked") ??
    null
  );
}

export function PlanView({ roadmap, projectName, actions, className }: PlanViewProps) {
  const t = useT();
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [busyStepId, setBusyStepId] = useState<number | null>(null);
  const [failures, setFailures] = useState<RoadmapActionFailure[]>([]);
  const stepRefs = useRef(new Map<number, HTMLDivElement>());
  const summary = useMemo(() => summarizePlan(roadmap.steps), [roadmap.steps]);
  const currentStep = useMemo(() => currentStepFor(roadmap.steps), [roadmap.steps]);
  const goal = roadmap.status?.plan_summary ?? null;

  useEffect(() => {
    if (!currentStep) return;
    stepRefs.current.get(currentStep.step.id)?.scrollIntoView({ block: "nearest" });
  }, [currentStep]);

  const setStepRef = (id: number, node: HTMLDivElement | null) => {
    if (node) stepRefs.current.set(id, node);
    else stepRefs.current.delete(id);
  };

  const focusStep = (id: number) => {
    const node = stepRefs.current.get(id);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => node?.focus(), 120);
  };

  const handleActionError = (item: PlanRoadmapStep, error: unknown) => {
    setFailures([
      makeRoadmapActionFailure({
        action: "start_step",
        stepLabel: `${item.step.step_id}: ${item.step.title}`,
        error,
      }),
    ]);
  };

  const handleStartGroup = async (steps: PlanRoadmapStep[], bucket: string) => {
    const readySteps = steps.filter((item) => item.status === "ready");
    if (readySteps.length === 0) return;
    setFailures([]);
    const results = await Promise.allSettled(
      readySteps.map((item) => actions.onOpenStep(item.step.id, { focus: false })),
    );
    const failed = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            makeRoadmapActionFailure({
              action: "start_group",
              stepLabel: `${readySteps[index].step.step_id}: ${readySteps[index].step.title}`,
              error: result.reason,
            }),
          ]
        : [],
    );
    setFailures(failed);
    if (failed.length === 0) focusStep(readySteps[0].step.id);
    void bucket;
  };

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col bg-bg-panel text-fg", className)}
      aria-label={t("plan_view.aria")}
      data-testid="plan-view"
      data-roadmap-step-count={summary.total}
      data-roadmap-overall-status={summary.overall}
    >
      <PlanHeader
        projectName={projectName}
        goal={goal}
        steps={roadmap.steps}
        summary={summary}
        minimapOpen={minimapOpen}
        loading={roadmap.loading}
        onToggleMinimap={() => setMinimapOpen((open) => !open)}
        onRefresh={() => void roadmap.refresh()}
      />
      {minimapOpen && roadmap.steps.length > 0 ? (
        <PlanMiniMap
          steps={roadmap.steps}
          currentStepId={currentStep?.step.id ?? null}
          onSelectStep={focusStep}
        />
      ) : null}
      {roadmap.error ? (
        <PlanError message={roadmap.error} onRetry={() => void roadmap.refresh()} />
      ) : null}
      {failures.length > 0 ? (
        <PlanFailure failures={failures} onDismiss={() => setFailures([])} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {roadmap.loading ? <PlanLoading /> : null}
        {!roadmap.loading && roadmap.steps.length === 0 ? (
          <PlanEmpty onCreatePlan={actions.onCreatePlan} />
        ) : null}
        {!roadmap.loading && roadmap.steps.length > 0 ? (
          <PlanTimeline
            steps={roadmap.steps}
            currentStepId={currentStep?.step.id ?? null}
            busyStepId={busyStepId}
            actions={actions}
            onStartGroup={handleStartGroup}
            onActionStart={(id) => {
              setFailures([]);
              setBusyStepId(id);
            }}
            onActionEnd={() => setBusyStepId(null)}
            onActionError={handleActionError}
            setStepRef={setStepRef}
          />
        ) : null}
      </div>
    </aside>
  );
}
