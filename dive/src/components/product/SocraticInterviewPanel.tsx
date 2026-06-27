import { Check, Send } from "lucide-react";
import { useState } from "react";
import { useLocale, useT, type Locale } from "../../i18n";
import { Button } from "../ui/button";
import type { ScaffoldMode } from "../../features/provocation";
import type { InterviewAnswer } from "../../features/planning";
import { remainingInterviewDimensions } from "../../features/planning/remainingInterviewDimensions";
import { detectAmbiguity, type AmbiguityKind } from "../../lib/ambiguity";

interface SocraticInterviewPanelProps {
  started: boolean;
  answers?: readonly InterviewAnswer[];
  unresolvedQuestionCount?: number;
  loading?: boolean;
  disabled?: boolean;
  provocation?: {
    enabled: boolean;
    mode: ScaffoldMode;
    projectId?: number | null;
    sessionId?: number | null;
  };
  onSubmitGoal: (goal: string) => void;
  onSubmitAnswer: (answer: string) => void;
  onComplete: () => void;
}

const VAGUE_HINT_KINDS = new Set<AmbiguityKind>([
  "vague_subject",
  "vague_quantity",
  "missing_target",
]);

function remainingQuestionsLabel(
  count: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (count <= 0) return t("planning.interview.remaining_questions.done");
  if (count === 1) return t("planning.interview.remaining_questions.one");
  return t("planning.interview.remaining_questions.many", { count });
}

function shouldShowVagueInterviewHint(input: {
  answer: string;
  locale: Locale;
  unresolvedQuestionCount: number;
}): boolean {
  const trimmed = input.answer.trim();
  if (!trimmed) return false;
  if (input.unresolvedQuestionCount > 0) return true;
  return detectAmbiguity(trimmed, input.locale).some((hit) => VAGUE_HINT_KINDS.has(hit.kind));
}

export function SocraticInterviewPanel({
  started,
  answers = [],
  unresolvedQuestionCount = 0,
  loading = false,
  disabled = false,
  onSubmitGoal,
  onSubmitAnswer,
  onComplete,
}: SocraticInterviewPanelProps) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const remainingQuestions = remainingInterviewDimensions(answers);
  const vagueHintVisible =
    started &&
    shouldShowVagueInterviewHint({
      answer: text,
      locale,
      unresolvedQuestionCount,
    });

  const submit = () => {
    if (!trimmed || disabled || loading) return;
    if (started) onSubmitAnswer(trimmed);
    else onSubmitGoal(trimmed);
    setText("");
  };

  return (
    <div className="space-y-2">
      <div
        className="rounded-md border border-accent/40 bg-bg-panel2 p-3"
        data-testid="socratic-interview-panel"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{t("planning.interview.title")}</p>
            <p className="text-xs text-fg-muted">
              {started ? t("planning.interview.answer_hint") : t("planning.interview.goal_hint")}
            </p>
          </div>
          {started ? (
            <span
              className="shrink-0 rounded-full border border-accent/35 bg-accent/10 px-2.5 py-1 text-xs font-medium text-fg"
              data-testid="interview-remaining-questions"
              data-count={remainingQuestions}
            >
              {remainingQuestionsLabel(remainingQuestions, t)}
            </span>
          ) : null}
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
        {vagueHintVisible ? (
          <p className="mt-2 text-xs text-warn" role="note" data-testid="interview-vague-hint">
            {t("planning.interview.vague_answer_error")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
