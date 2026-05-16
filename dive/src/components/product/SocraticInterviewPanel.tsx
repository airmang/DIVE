import { Check, Send } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { Button } from "../ui/button";

interface SocraticInterviewPanelProps {
  started: boolean;
  loading?: boolean;
  disabled?: boolean;
  onSubmitGoal: (goal: string) => void;
  onSubmitAnswer: (answer: string) => void;
  onComplete: () => void;
}

function isVagueAnswer(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return false;
  const vague = [
    "그냥 적당히",
    "적당히",
    "알아서",
    "대충",
    "아무거나",
    "whatever",
    "anything",
    "up to you",
  ];
  return vague.some(
    (phrase) => normalized === phrase || (normalized.length <= 16 && normalized.includes(phrase)),
  );
}

export function SocraticInterviewPanel({
  started,
  loading = false,
  disabled = false,
  onSubmitGoal,
  onSubmitAnswer,
  onComplete,
}: SocraticInterviewPanelProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const trimmed = text.trim();

  const submit = () => {
    if (!trimmed || disabled || loading) return;
    if (started && isVagueAnswer(trimmed)) {
      setValidationError(t("planning.interview.vague_answer_error"));
      return;
    }
    if (started) onSubmitAnswer(trimmed);
    else onSubmitGoal(trimmed);
    setValidationError(null);
    setText("");
  };

  return (
    <div
      className="rounded-md border border-accent/40 bg-bg-panel2 p-3"
      data-testid="socratic-interview-panel"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">{t("planning.interview.title")}</p>
          <p className="text-xs text-fg-muted">
            {started ? t("planning.interview.answer_hint") : t("planning.interview.goal_hint")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onComplete}
          disabled={!started || disabled || loading}
          data-testid="interview-complete"
        >
          <Check />
          {t("planning.interview.complete")}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          className="min-h-16 flex-1 resize-none rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (validationError) setValidationError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={
            started
              ? t("planning.interview.answer_placeholder")
              : t("planning.interview.goal_placeholder")
          }
          disabled={disabled || loading}
          data-testid="interview-input"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={!trimmed || disabled || loading}
          data-testid="interview-send"
        >
          <Send />
          {started ? t("planning.interview.send_answer") : t("planning.interview.start")}
        </Button>
      </div>
      {validationError ? (
        <p className="mt-2 text-xs text-warn" role="alert">
          {validationError}
        </p>
      ) : null}
    </div>
  );
}
