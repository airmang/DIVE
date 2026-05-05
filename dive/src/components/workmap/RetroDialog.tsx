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

interface RetroDialogProps {
  open: boolean;
  cardTitle: string;
  onOpenChange: (open: boolean) => void;
  onSave: (content: string) => Promise<void> | void;
}

function buildContent(intent: string, help: string, next: string): string {
  return [`의도: ${intent.trim()}`, `AI 도움: ${help.trim()}`, `다음 개선: ${next.trim()}`].join(
    "\n",
  );
}

export function RetroDialog({ open, cardTitle, onOpenChange, onSave }: RetroDialogProps) {
  const t = useT();
  const [intent, setIntent] = useState("");
  const [help, setHelp] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setIntent("");
    setHelp("");
    setNext("");
    setSaving(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(buildContent(intent, help, next));
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-xl" data-testid="retro-dialog">
        <DialogHeader>
          <DialogTitle>{t("retro.title")}</DialogTitle>
          <DialogDescription>
            {t("retro.description", { title: cardTitle })}
            <LearningHint inline className="ml-1">
              {t("retro.learning_hint")}
            </LearningHint>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <RetroField
            id="retro-intent"
            label={t("retro.intent_label")}
            value={intent}
            onChange={setIntent}
          />
          <RetroField
            id="retro-help"
            label={t("retro.help_label")}
            value={help}
            onChange={setHelp}
          />
          <RetroField
            id="retro-next"
            label={t("retro.next_label")}
            value={next}
            onChange={setNext}
          />
          {error ? (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("retro.skip")}
          </Button>
          <Button
            variant="primary"
            data-testid="retro-save"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving || (intent.trim() === "" && help.trim() === "" && next.trim() === "")}
          >
            {saving ? t("retro.saving") : t("retro.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetroField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-fg-muted" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        data-testid={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
      />
    </div>
  );
}

export default RetroDialog;
