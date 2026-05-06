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
  const [goal, setGoal] = useState(initialGoal);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGoal(initialGoal);
    setAnswers(
      Object.fromEntries(QUESTIONS.map((question) => [question.id, "Not sure"])) as Record<
        string,
        string
      >,
    );
    setError(null);
  }, [initialGoal, open]);

  const trimmedGoal = goal.trim();
  const canContinue = trimmedGoal.length > 0;
  const questionCountLabel = useMemo(() => `${QUESTIONS.length} quick questions`, []);

  const handleContinue = () => {
    if (!canContinue) {
      setError("Describe what you want to build first.");
      return;
    }
    const brief = createProjectBrief(trimmedGoal, answers);
    onPlanDraft(buildPlanDraft(brief));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="plan-interview-panel">
        <DialogHeader>
          <DialogTitle>Plan your project</DialogTitle>
          <DialogDescription>
            Start with a natural-language goal. DIVE asks at most 3 questions, then drafts a plan
            for your approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold">What do you want to build?</span>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={3}
              className="w-full rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="I want to build a small habit tracker..."
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
                    {question.question}
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {question.choices.map((choice) => {
                      const selected = (answers[question.id] ?? "Not sure") === choice;
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
                          {choice}
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
            Cancel
          </Button>
          <Button variant="primary" onClick={handleContinue} data-testid="plan-interview-continue">
            Draft plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
