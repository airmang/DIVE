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
import { Button } from "../ui/button";
import { RecoveryPanel, type RecoveryPanelProps } from "./RecoveryPanel";

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
  recovery: RecoveryPanelProps;
}

const STATUS_LABEL: Record<RoadmapStepStatus, string> = {
  planned: "Planned",
  ready: "Ready",
  working: "Working",
  checking: "Checking",
  done: "Done",
  needs_changes: "Needs changes",
  integrated: "Integrated",
};

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

function nextActionFor(step: RoadmapStep | null, hasSteps: boolean): string {
  if (!hasSteps) return "Describe what you want to build in chat to create your roadmap.";
  if (!step) return "Pick a step to see what to do next.";
  switch (step.status) {
    case "planned":
      return "Add enough detail so the agent can work safely.";
    case "ready":
      return "Start this step from chat when you are ready.";
    case "working":
      return "Continue the conversation or review the latest agent output.";
    case "checking":
      return "Run Check and review the evidence before marking it done.";
    case "needs_changes":
      return "Ask for fixes, then check this step again.";
    case "done":
      return "Review changes, then move to the next step or integrate.";
    case "integrated":
      return "Choose another step or describe the next goal.";
  }
}

function remainingLabel(progress: RoadmapProgress) {
  const remaining = Math.max(0, progress.total - progress.completed);
  if (progress.total === 0) return "No steps yet";
  return `${remaining} remaining`;
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
  recovery,
}: RoadmapPanelProps) {
  const [goalDraft, setGoalDraft] = useState("");
  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0] ?? null;
  const hasSteps = steps.length > 0;
  const startPlanning = () => onStartPlanning(goalDraft);

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col border-l bg-bg-panel text-fg", className)}
      aria-label="Roadmap"
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
              <h2 className="text-base font-bold">Roadmap</h2>
            </div>
            <p className="mt-1 text-xs text-fg-muted">{remainingLabel(progress)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onToggleCompact}>
            {compact ? "Show all" : "Compact"}
          </Button>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg-muted">Progress</span>
            <span className="font-semibold">{progress.percent}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-bg-panel2"
            role="progressbar"
            aria-label="Roadmap progress"
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
          Current step
        </div>
        {activeStep ? (
          <div className="mt-3 rounded-lg border border-accent/50 bg-accent/10 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-fg-muted">
                  Step {activeStep.position}
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
                {STATUS_LABEL[activeStep.status]}
              </span>
            </div>
            {activeStep.description ? (
              <p className="mt-2 line-clamp-3 text-xs text-fg-muted">{activeStep.description}</p>
            ) : null}
            <div className="mt-3 rounded-md border border-border/70 bg-bg/70 px-3 py-2 text-xs">
              <div className="font-semibold text-fg">Next action</div>
              <p className="mt-1 text-fg-muted">{nextActionFor(activeStep, hasSteps)}</p>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-bg/60 p-4 text-sm">
            <div className="font-semibold">Describe what you want to build.</div>
            <p className="mt-1 text-xs text-fg-muted">
              Use chat to explain your goal. DIVE can turn it into Roadmap steps you can review.
            </p>
            <p
              className="mt-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg"
              data-testid="planning-no-files-changed"
            >
              No files changed yet — planning mode only reads context until you approve a plan.
            </p>
            <textarea
              value={goalDraft}
              onChange={(event) => setGoalDraft(event.target.value)}
              rows={3}
              className="mt-3 w-full rounded-md border bg-bg-panel2 px-3 py-2 text-xs text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="I want to build..."
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
              Draft plan
            </Button>
          </div>
        )}
      </section>

      <RecoveryPanel {...recovery} />

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
                          Step {step.position}
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
                        {STATUS_LABEL[step.status]}
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
            Plan
          </Button>
          <Button variant="outline" size="sm" onClick={onAddStep} disabled={!canAddStep}>
            <Plus />
            Add Step
          </Button>
        </div>
      </footer>
    </aside>
  );
}
