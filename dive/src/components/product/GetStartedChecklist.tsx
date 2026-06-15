import { Check } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";

export type GetStartedStepKey = "project" | "provider" | "prd" | "plan";
export type GetStartedStepStatus = "done" | "current" | "pending";

export interface GetStartedStep {
  key: GetStartedStepKey;
  status: GetStartedStepStatus;
  title: string;
  description: string;
  doneHint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface GetStartedModel {
  steps: GetStartedStep[];
}

interface GetStartedChecklistProps {
  model: GetStartedModel;
}

/**
 * Single cockpit-center first-run guide: project -> AI -> PRD -> plan, with the
 * current step emphasized. Replaces the scattered onboarding dialog / empty
 * state / gate banners. Presentational only; the controller computes the model.
 */
export function GetStartedChecklist({ model }: GetStartedChecklistProps) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6">
      <section
        className="w-full max-w-md rounded-lg border bg-bg-panel2 p-5"
        aria-label={t("get_started.title")}
        data-testid="get-started-checklist"
      >
        <h2 className="text-base font-semibold text-fg">{t("get_started.title")}</h2>
        <p className="mt-1 text-xs text-fg-muted">{t("get_started.subtitle")}</p>
        <ol className="mt-4 flex flex-col gap-1.5">
          {model.steps.map((step, index) => (
            <li
              key={step.key}
              data-testid={`get-started-step-${step.key}`}
              data-status={step.status}
              aria-current={step.status === "current" ? "step" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3",
                step.status === "current" ? "border-accent bg-accent-subtle" : "border-transparent",
                step.status === "done" && "opacity-70",
                step.status === "pending" && "opacity-50",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  step.status === "done" && "bg-success/15 text-success",
                  step.status === "current" && "border-2 border-accent text-accent",
                  step.status === "pending" && "border-2 border-border text-fg-subtle",
                )}
              >
                {step.status === "done" ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{step.title}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {step.status === "done" && step.doneHint ? step.doneHint : step.description}
                </p>
                {step.status === "current" && step.actionLabel && step.onAction ? (
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-2"
                    onClick={step.onAction}
                    data-testid={`get-started-action-${step.key}`}
                  >
                    {step.actionLabel}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default GetStartedChecklist;
