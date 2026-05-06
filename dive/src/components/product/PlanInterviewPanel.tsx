import { useEffect, useMemo, useState } from "react";
import {
  buildPlanDraft,
  createProjectBrief,
  PLAN_INTERVIEW_QUESTIONS,
  type PlanDraft,
} from "../../features/planning";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useLocale, useT } from "../../i18n";

interface PlanInterviewPanelProps {
  open: boolean;
  initialGoal?: string;
  onOpenChange: (open: boolean) => void;
  onPlanDraft: (draft: PlanDraft) => void;
}

const QUESTIONS = PLAN_INTERVIEW_QUESTIONS.slice(0, 3);

export function PlanInterviewPanel({
  open,
  initialGoal = "",
  onOpenChange,
  onPlanDraft,
}: PlanInterviewPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [goal, setGoal] = useState(initialGoal);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGoal(initialGoal);
    setAnswers(
      Object.fromEntries(QUESTIONS.map((question) => [question.id, "not_sure"])) as Record<
        string,
        string
      >,
    );
    setError(null);
  }, [initialGoal, open]);

  const trimmedGoal = goal.trim();
  const canContinue = trimmedGoal.length > 0;
  const questionCountLabel = useMemo(
    () => t("planning.quick_questions", { count: QUESTIONS.length }),
    [t],
  );

  const handleContinue = () => {
    if (!canContinue) {
      setError(t("planning.goal_required"));
      return;
    }
    const brief = createProjectBrief(trimmedGoal, answers, locale);
    onPlanDraft(buildPlanDraft(brief, locale));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="plan-interview-panel">
        <DialogHeader>
          <DialogTitle>{t("planning.interview_title")}</DialogTitle>
          <DialogDescription>{t("planning.interview_description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold">{t("planning.goal_label")}</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={3}
              className="w-full rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t("planning.goal_placeholder")}
              data-testid="plan-goal-input"
            />
          </label>

          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              {questionCountLabel}
            </div>
            <div className="mt-3 grid gap-3">
              {QUESTIONS.map((question) => (
                <fieldset
                  key={question.id}
                  className="rounded-lg border border-border bg-bg/50 p-3"
                  data-testid="plan-interview-question"
                >
                  <legend className="px-1 text-sm font-semibold text-fg">
                    {t(question.question)}
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {question.choices.map((choice) => {
                      const selected = (answers[question.id] ?? "not_sure") === choice;
                      return (
                        <button
                          key={choice}
                          type="button"
                          onClick={() =>
                            setAnswers((current) => ({ ...current, [question.id]: choice }))
                          }
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-border bg-bg-panel text-fg-muted hover:border-accent/60 hover:text-fg",
                          )}
                          aria-pressed={selected}
                        >
                          {t(`planning.choices.${choice}`)}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleContinue} data-testid="plan-interview-continue">
            {t("planning.draft_plan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
