import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export interface VerificationReviewStage {
  id: string;
  marker: string;
  title: string;
  summary: string;
  content: ReactNode;
  evidenced?: boolean;
}

interface VerificationReviewStepperProps {
  ariaLabel: string;
  progressLabel: (current: number, total: number) => string;
  previousLabel: string;
  nextLabel: string;
  revisitLabel: string;
  openStageLabel: string;
  stages: VerificationReviewStage[];
}

export function VerificationReviewStepper({
  ariaLabel,
  progressLabel,
  previousLabel,
  nextLabel,
  revisitLabel,
  openStageLabel,
  stages,
}: VerificationReviewStepperProps) {
  const [activeStageId, setActiveStageId] = useState(() => stages[0]?.id ?? "");
  const [visitedStageIds, setVisitedStageIds] = useState<Set<string>>(() => new Set());
  const stageIds = useMemo(() => new Set(stages.map((stage) => stage.id)), [stages]);

  useEffect(() => {
    if (stages.length === 0) {
      setActiveStageId("");
      setVisitedStageIds(new Set());
      return;
    }

    setActiveStageId((current) => (stageIds.has(current) ? current : stages[0].id));
    setVisitedStageIds((current) => {
      const next = new Set([...current].filter((id) => stageIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [stageIds, stages]);

  const activeIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === activeStageId),
  );
  const activeStage = stages[activeIndex] ?? stages[0];

  const visitStage = (stageId: string) => {
    if (stageId === activeStageId) return;
    setVisitedStageIds((current) => {
      if (!activeStageId) return current;
      const next = new Set(current);
      next.add(activeStageId);
      return next;
    });
    setActiveStageId(stageId);
  };

  const goPrevious = () => {
    if (activeIndex <= 0) return;
    visitStage(stages[activeIndex - 1].id);
  };

  const goNext = () => {
    if (activeIndex >= stages.length - 1) return;
    visitStage(stages[activeIndex + 1].id);
  };

  if (!activeStage) return null;

  return (
    <section className="mt-4" aria-label={ariaLabel} data-testid="verification-review-stepper">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted"
        data-testid="verification-stepper-progress"
      >
        {progressLabel(activeIndex + 1, stages.length)}
      </div>
      <ol className="mt-3 space-y-4">
        {stages.map((stage, index) => {
          const isActive = stage.id === activeStage.id;
          const hasVisited = visitedStageIds.has(stage.id);
          const isCompleted = (stage.evidenced ?? hasVisited) && !isActive;
          const isVisited = hasVisited && !isCompleted && !isActive;
          const stageState = isActive
            ? "current"
            : isCompleted
              ? "completed"
              : isVisited
                ? "visited"
                : "future";
          const canRevisit = isCompleted || isVisited;
          return (
            <li
              key={stage.id}
              className={cn("min-w-0", stageState === "future" ? "opacity-60" : "")}
              data-testid={`verification-stepper-stage-${stage.id}`}
              data-stage-id={stage.id}
              data-stage-state={stageState}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <div className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  {isCompleted ? (
                    <CheckCircle2
                      className="h-[18px] w-[18px] text-success"
                      aria-hidden
                      data-testid={`verification-stepper-success-${stage.id}`}
                    />
                  ) : (
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold leading-none",
                        isActive
                          ? "bg-accent text-accent-fg"
                          : isVisited
                            ? "border border-border bg-bg-panel2 text-fg-muted"
                            : "border border-border bg-transparent text-transparent",
                      )}
                      aria-hidden
                    >
                      {isActive || isVisited ? stage.marker : ""}
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className={cn(
                        "text-left text-sm font-semibold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                        isActive ? "text-fg" : "text-fg-muted hover:text-fg",
                      )}
                      onClick={() => visitStage(stage.id)}
                      aria-current={isActive ? "step" : undefined}
                      aria-label={`${openStageLabel}: ${stage.title}`}
                      data-testid={`verification-stepper-stage-button-${stage.id}`}
                    >
                      {stage.title}
                    </button>
                    <p
                      className="mt-0.5 text-[11px] leading-snug text-fg-muted"
                      data-testid={`verification-stepper-stage-summary-${stage.id}`}
                    >
                      {stage.summary}
                    </p>
                  </div>
                  {canRevisit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => visitStage(stage.id)}
                      data-testid={`verification-stepper-revisit-${stage.id}`}
                    >
                      {revisitLabel}
                    </Button>
                  ) : null}
                </div>
              </div>

              {isActive ? (
                <div className="ml-7 mt-3" data-testid={`verification-stepper-content-${stage.id}`}>
                  {stage.content}
                  <div className="mt-4 flex flex-wrap justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === 0}
                      onClick={goPrevious}
                      data-testid="verification-stepper-previous"
                    >
                      {previousLabel}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === stages.length - 1}
                      onClick={goNext}
                      data-testid="verification-stepper-next"
                    >
                      {nextLabel}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default VerificationReviewStepper;
