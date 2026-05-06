import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  ListChecks,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { RoadmapProgress, RoadmapStep, RoadmapStepStatus } from "../../features/roadmap";
import { useT } from "../../i18n";
import { Button } from "../ui/button";

interface RoadmapPanelProps {
  className?: string;
  steps: RoadmapStep[];
  activeStepId: number | null;
  progress: RoadmapProgress;
  canAddStep: boolean;
  compact: boolean;
  onToggleCompact: () => void;
  onSelectStep: (stepId: number) => void;
  onAddStep: () => void;
  onStartPlanning: (goal?: string) => void;
}

const STATUS_CLASS: Record<RoadmapStepStatus, string> = {
  planned: "border-border bg-bg-panel2 text-fg-muted",
  ready: "border-info/50 bg-info/10 text-info",
  working: "border-accent/60 bg-accent/10 text-accent",
  checking: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  needs_changes: "border-danger/60 bg-danger/10 text-danger",
  integrated: "border-success/70 bg-success/15 text-success",
};

function statusIcon(status: RoadmapStepStatus) {
  if (status === "done" || status === "integrated") return <CheckCircle2 aria-hidden />;
  if (status === "checking") return <Clock3 aria-hidden />;
  if (status === "needs_changes") return <AlertCircle aria-hidden />;
  return <Circle aria-hidden />;
}

function nextActionKey(step: RoadmapStep | null, hasSteps: boolean): string {
  if (!hasSteps) return "roadmap.next_action.no_steps";
  if (!step) return "roadmap.next_action.pick_step";
  return `roadmap.next_action.${step.status}`;
}

function remainingLabel(progress: RoadmapProgress, t: ReturnType<typeof useT>) {
  const remaining = Math.max(0, progress.total - progress.completed);
  if (progress.total === 0) return t("roadmap.no_steps");
  return t("roadmap.remaining", { count: remaining });
}

export function RoadmapPanel({
  className,
  steps,
  activeStepId,
  progress,
  canAddStep,
  compact,
  onToggleCompact,
  onSelectStep,
  onAddStep,
  onStartPlanning,
}: RoadmapPanelProps) {
  const t = useT();
  const [goalDraft, setGoalDraft] = useState("");
  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0] ?? null;
  const hasSteps = steps.length > 0;
  const startPlanning = () => onStartPlanning(goalDraft);

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col border-l bg-bg-panel text-fg", className)}
      aria-label={t("roadmap.title")}
      data-testid="roadmap-panel"
      data-roadmap-active-step-id={activeStepId ?? ""}
      data-roadmap-progress={progress.percent}
      data-roadmap-step-count={steps.length}
    >
      <header className="shrink-0 border-b px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" aria-hidden />
              <h2 className="text-base font-bold">{t("roadmap.title")}</h2>
            </div>
            <p className="mt-1 text-xs text-fg-muted">{remainingLabel(progress, t)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onToggleCompact}>
            {compact ? t("roadmap.show_all") : t("roadmap.compact")}
          </Button>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg-muted">{t("roadmap.progress")}</span>
            <span className="font-semibold">{progress.percent}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-bg-panel2"
            role="progressbar"
            aria-label={t("roadmap.progress_aria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      </header>

      <section className="shrink-0 border-b px-4 py-4" data-testid="roadmap-current-step">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
          {t("roadmap.current_step")}
        </div>
        {activeStep ? (
          <div className="mt-3 rounded-lg border border-accent/50 bg-accent/10 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-fg-muted">
                  {t("roadmap.step_number", { position: activeStep.position })}
                </div>
                <h3 className="mt-0.5 truncate text-sm font-bold text-fg">{activeStep.title}</h3>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  STATUS_CLASS[activeStep.status],
                )}
              >
                <span className="h-3 w-3">{statusIcon(activeStep.status)}</span>
                {t(`roadmap.status.${activeStep.status}`)}
              </span>
            </div>
            {activeStep.description ? (
              <p className="mt-2 line-clamp-3 text-xs text-fg-muted">{activeStep.description}</p>
            ) : null}
            <div className="mt-3 rounded-md border border-border/70 bg-bg/70 px-3 py-2 text-xs">
              <div className="font-semibold text-fg">{t("roadmap.next_action_label")}</div>
              <p className="mt-1 text-fg-muted">{t(nextActionKey(activeStep, hasSteps))}</p>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-bg/60 p-4 text-sm">
            <div className="font-semibold">{t("roadmap.empty_title")}</div>
            <p className="mt-1 text-xs text-fg-muted">{t("roadmap.empty_description")}</p>
            <p
              className="mt-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg"
              data-testid="planning-no-files-changed"
            >
              {t("roadmap.planning_no_files_changed")}
            </p>
            <textarea
              value={goalDraft}
              onChange={(event) => setGoalDraft(event.target.value)}
              rows={3}
              className="mt-3 w-full rounded-md border bg-bg-panel2 px-3 py-2 text-xs text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t("roadmap.goal_placeholder")}
              data-testid="roadmap-goal-draft"
            />
            <Button
              className="mt-3"
              size="sm"
              variant="primary"
              onClick={startPlanning}
              data-testid="roadmap-empty-start-planning"
            >
              <Sparkles />
              {t("roadmap.draft_plan")}
            </Button>
          </div>
        )}
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {hasSteps ? (
          <ol className="space-y-2" data-testid="roadmap-step-list">
            {(compact ? steps.filter((step) => step.id === activeStep?.id) : steps).map((step) => {
              const isActive = step.id === activeStepId;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStep(step.id)}
                    data-testid="roadmap-step"
                    data-active={isActive ? "true" : "false"}
                    data-status={step.status}
                    className={cn(
                      "w-full rounded-lg border bg-bg px-3 py-3 text-left transition hover:border-accent/60 hover:bg-bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "border-accent bg-accent/10 shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-fg-muted">
                          {t("roadmap.step_number", { position: step.position })}
                        </div>
                        <div className="mt-0.5 truncate text-sm font-semibold text-fg">
                          {step.title}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          STATUS_CLASS[step.status],
                        )}
                      >
                        <span className="h-3 w-3">{statusIcon(step.status)}</span>
                        {t(`roadmap.status.${step.status}`)}
                      </span>
                    </div>
                    {step.description ? (
                      <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{step.description}</p>
                    ) : null}
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-panel2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.round(step.progress.ratio * 100)}%` }}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      <footer className="shrink-0 border-t p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onStartPlanning()}
            data-testid="roadmap-start-planning"
          >
            <Sparkles />
            {t("roadmap.plan")}
          </Button>
          <Button variant="outline" size="sm" onClick={onAddStep} disabled={!canAddStep}>
            <Plus />
            {t("roadmap.add_step")}
          </Button>
        </div>
      </footer>
    </aside>
  );
}
