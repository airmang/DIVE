import { AlertCircle, CheckCircle2, Circle, Clock3, ListChecks, PauseCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import type { RoadmapProgress, RoadmapStep, RoadmapStepStatus } from "../../features/roadmap";
import { useT } from "../../i18n";

interface RoadmapPanelProps {
  className?: string;
  steps: RoadmapStep[];
  activeStepId: number | null;
  progress: RoadmapProgress;
  goal: string | null;
  onSelectStep: (stepId: number) => void;
}

const STATUS_CLASS: Record<RoadmapStepStatus, string> = {
  planned: "border-border bg-bg-panel2 text-fg-muted",
  in_progress: "border-accent/60 bg-accent/10 text-accent",
  review: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  shipped: "border-success/70 bg-success/15 text-success",
};

function statusIcon(status: RoadmapStepStatus) {
  if (status === "shipped" || status === "done") return <CheckCircle2 aria-hidden />;
  if (status === "review") return <Clock3 aria-hidden />;
  if (status === "in_progress") return <AlertCircle aria-hidden />;
  return <Circle aria-hidden />;
}

type OverallStatus = "in_progress" | "done" | "halted";

function overallStatusFor(steps: RoadmapStep[]): OverallStatus {
  if (steps.length === 0) return "in_progress";
  if (steps.every((s) => s.status === "shipped" || s.status === "done")) return "done";
  const reviewSteps = steps.filter((s) => s.status === "review");
  if (reviewSteps.length > 0 && reviewSteps.every((s) => s.wasRejected)) {
    return "halted";
  }
  return "in_progress";
}

const OVERALL_PILL_CLASS: Record<OverallStatus, string> = {
  in_progress: "border-accent/50 bg-accent/10 text-accent",
  done: "border-success/60 bg-success/15 text-success",
  halted: "border-danger/60 bg-danger/10 text-danger",
};

export function RoadmapPanel({
  className,
  steps,
  activeStepId,
  progress,
  goal,
  onSelectStep,
}: RoadmapPanelProps) {
  const t = useT();
  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0] ?? null;
  const hasSteps = steps.length > 0;
  const overall = overallStatusFor(steps);

  if (!hasSteps) {
    return (
      <aside
        className={cn("flex h-full min-h-0 flex-col border-l bg-bg-panel text-fg", className)}
        aria-label={t("roadmap.title")}
        data-testid="roadmap-panel"
        data-roadmap-step-count="0"
      >
        <header className="shrink-0 border-b px-4 py-4">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent" aria-hidden />
            <h2 className="text-base font-bold">{t("roadmap.title")}</h2>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
          <div>
            <div className="text-sm font-semibold text-fg">{t("roadmap.empty_v2_title")}</div>
            <p className="mt-2 text-xs text-fg-muted">{t("roadmap.empty_v2_description")}</p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col border-l bg-bg-panel text-fg", className)}
      aria-label={t("roadmap.title")}
      data-testid="roadmap-panel"
      data-roadmap-active-step-id={activeStepId ?? ""}
      data-roadmap-progress={progress.percent}
      data-roadmap-step-count={steps.length}
      data-roadmap-overall-status={overall}
    >
      <header className="shrink-0 space-y-3 border-b px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" aria-hidden />
              <h2 className="text-base font-bold">{t("roadmap.title")}</h2>
            </div>
            {goal ? (
              <div className="mt-2" data-testid="roadmap-goal">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
                  {t("roadmap.goal_label")}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs font-medium text-fg">{goal}</p>
              </div>
            ) : null}
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              OVERALL_PILL_CLASS[overall],
            )}
            data-testid="roadmap-overall-pill"
          >
            {overall === "halted" ? (
              <PauseCircle className="h-3 w-3" aria-hidden />
            ) : overall === "done" ? (
              <CheckCircle2 className="h-3 w-3" aria-hidden />
            ) : (
              <Clock3 className="h-3 w-3" aria-hidden />
            )}
            {t(`roadmap.overall_status.${overall}`)}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg-muted" data-testid="roadmap-summary-counts">
              {t("roadmap.summary_counts", {
                completed: progress.completed,
                total: progress.total,
              })}
            </span>
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
          <ActiveStepCard step={activeStep} t={t} />
        ) : (
          <p className="mt-3 text-xs text-fg-muted">{t("roadmap.next_action_v2.pick_step")}</p>
        )}
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ol className="space-y-2" data-testid="roadmap-step-list">
          {steps.map((step) => (
            <li key={step.id}>
              <StepListItem
                step={step}
                isActive={step.id === activeStepId}
                onSelect={() => onSelectStep(step.id)}
                t={t}
              />
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

interface StepListItemProps {
  step: RoadmapStep;
  isActive: boolean;
  onSelect: () => void;
  t: ReturnType<typeof useT>;
}

function StepListItem({ step, isActive, onSelect, t }: StepListItemProps) {
  const { status, wasRejected } = step;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="roadmap-step"
      data-active={isActive ? "true" : "false"}
      data-status={status}
      data-was-rejected={wasRejected ? "true" : "false"}
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
          <div className="mt-0.5 truncate text-sm font-semibold text-fg">{step.title}</div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            STATUS_CLASS[status],
          )}
        >
          <span className="h-3 w-3">{statusIcon(status)}</span>
          {t(`roadmap.status_v2.${status}`)}
        </span>
      </div>
      {status === "review" && wasRejected ? (
        <div
          className="mt-1 inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger"
          data-testid="roadmap-step-review-rejected"
        >
          <AlertCircle className="h-3 w-3" aria-hidden />
          {t("roadmap.step_badge_review_rejected")}
        </div>
      ) : null}
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
  );
}

interface ActiveStepCardProps {
  step: RoadmapStep;
  t: ReturnType<typeof useT>;
}

function ActiveStepCard({ step, t }: ActiveStepCardProps) {
  const { status } = step;
  return (
    <div className="mt-3 rounded-lg border border-accent/50 bg-accent/10 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-fg-muted">
            {t("roadmap.step_number", { position: step.position })}
          </div>
          <h3 className="mt-0.5 truncate text-sm font-bold text-fg">{step.title}</h3>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            STATUS_CLASS[status],
          )}
        >
          <span className="h-3 w-3">{statusIcon(status)}</span>
          {t(`roadmap.status_v2.${status}`)}
        </span>
      </div>
      {step.description ? (
        <p className="mt-2 line-clamp-3 text-xs text-fg-muted">{step.description}</p>
      ) : null}
      <div className="mt-3 rounded-md border border-border/70 bg-bg/70 px-3 py-2 text-xs">
        <div className="font-semibold text-fg">{t("roadmap.next_action_label")}</div>
        <p className="mt-1 text-fg-muted">{t(`roadmap.next_action_v2.${status}`)}</p>
      </div>
    </div>
  );
}
