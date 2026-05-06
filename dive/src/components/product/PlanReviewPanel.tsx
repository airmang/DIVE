import { useState } from "react";
import type { PlanDraft } from "../../features/planning";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

interface PlanReviewPanelProps {
  open: boolean;
  draft: PlanDraft | null;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onAccept: (draft: PlanDraft) => Promise<void> | void;
}

export function PlanReviewPanel({
  open,
  draft,
  onOpenChange,
  onBack,
  onAccept,
}: PlanReviewPanelProps) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (!draft) return;
    setAccepting(true);
    setError(null);
    try {
      await onAccept(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[88vh] max-w-3xl overflow-y-auto"
        data-testid="plan-review-panel"
      >
        <DialogHeader>
          <DialogTitle>Review the plan</DialogTitle>
          <DialogDescription>
            Approving this plan creates Roadmap steps. Cancel or go back to change it without
            creating files or steps.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="space-y-5">
            <section className="rounded-lg border bg-bg/50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
                Goal
              </div>
              <p className="mt-2 text-sm font-medium text-fg">{draft.goal}</p>
            </section>

            <section className="rounded-lg border bg-bg/50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
                MVP
              </div>
              <p className="mt-2 text-sm text-fg-muted">{draft.mvp}</p>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-bg/50 p-4">
                <h3 className="text-sm font-semibold">Non-goals</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-fg-muted">
                  {draft.nonGoals.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border bg-bg/50 p-4">
                <h3 className="text-sm font-semibold">Success criteria</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-fg-muted">
                  {draft.successCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-lg border bg-bg/50 p-4">
              <h3 className="text-sm font-semibold">Roadmap steps</h3>
              <ol className="mt-3 space-y-3" data-testid="plan-review-steps">
                {draft.steps.map((step, index) => (
                  <li key={`${step.title}-${index}`} className="rounded-md border bg-bg-panel p-3">
                    <div className="text-[11px] font-semibold text-fg-muted">Step {index + 1}</div>
                    <div className="mt-1 text-sm font-semibold text-fg">{step.title}</div>
                    <p className="mt-1 text-xs text-fg-muted">{step.summary}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-fg-muted">
                      {step.acceptanceCriteria.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>

            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">No plan draft is ready yet.</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={accepting}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onBack} disabled={accepting}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleAccept}
            disabled={!draft || accepting}
            data-testid="plan-review-accept"
          >
            {accepting ? "Creating steps..." : "Approve and create Roadmap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
