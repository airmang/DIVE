import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import { useT } from "../../i18n";

export interface NewCardDraft {
  title: string;
  summary: string | null;
  acceptanceCriteria: string | null;
  instructionSeed: string | null;
}

interface NewCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: number;
  onCreate: (draft: NewCardDraft) => Promise<void> | void;
}

function nullableTrim(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function NewCardDialog({ open, onOpenChange, position, onCreate }: NewCardDialogProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [instructionSeed, setInstructionSeed] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setSummary("");
    setAcceptanceCriteria("");
    setInstructionSeed("");
    setSubmitting(false);
    setError(null);
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError(t("workmap.new_card_title_required"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        title: trimmedTitle,
        summary: nullableTrim(summary),
        acceptanceCriteria: nullableTrim(acceptanceCriteria),
        instructionSeed: nullableTrim(instructionSeed),
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl" data-testid="new-card-dialog">
        <DialogHeader>
          <DialogTitle>{t("workmap.new_card_dialog_title")}</DialogTitle>
          <DialogDescription>
            {t("workmap.new_card_dialog_description", { index: position })}
            <LearningHint inline className="ml-1">
              {t("workmap.new_card_learning_hint")}
            </LearningHint>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-fg-muted" htmlFor="new-card-title">
              {t("workmap.new_card_title_label")}
            </label>
            <input
              id="new-card-title"
              data-testid="new-card-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("workmap.new_card_title", { index: position })}
              className="w-full rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-fg-muted" htmlFor="new-card-summary">
              {t("workmap.new_card_summary_label")}
            </label>
            <textarea
              id="new-card-summary"
              data-testid="new-card-summary-input"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-fg-muted" htmlFor="new-card-acceptance">
              {t("workmap.new_card_acceptance_label")}
            </label>
            <textarea
              id="new-card-acceptance"
              data-testid="new-card-acceptance-input"
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-fg-muted" htmlFor="new-card-instruction">
              {t("workmap.new_card_instruction_label")}
            </label>
            <textarea
              id="new-card-instruction"
              data-testid="new-card-instruction-input"
              value={instructionSeed}
              onChange={(e) => setInstructionSeed(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
            />
          </div>

          {error ? (
            <p
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
              data-testid="new-card-error"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            data-testid="new-card-create"
            disabled={submitting}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {submitting ? t("workmap.new_card_creating") : t("workmap.new_card_create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewCardDialog;
