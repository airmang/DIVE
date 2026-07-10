import { CheckCircle2, ClipboardCheck, Play, RotateCw } from "lucide-react";
import type { MouseEvent } from "react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { PlanRoadmapStep } from "../../features/roadmap";

interface PlanStepActionsProps {
  item: PlanRoadmapStep;
  busy: boolean;
  onStart: () => void;
  onResume: (sessionId: number) => void;
  onOpen: () => void;
  onReview: () => void;
}

function actionClass(primary: boolean) {
  return cn(
    "inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 py-1.5",
    "font-mono text-[11px] font-bold uppercase tracking-[0.06em] transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    primary
      ? // S-044: light accent deepened, so use accent-fg (white) on the green fill
        "border-accent-hover bg-accent-hover text-accent-fg hover:bg-accent dark:border-accent dark:bg-accent dark:hover:bg-accent-hover"
      : "border-border bg-transparent text-fg hover:border-accent/60 hover:text-accent",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border disabled:hover:text-fg",
  );
}

export function PlanStepActions({
  item,
  busy,
  onStart,
  onResume,
  onOpen,
  onReview,
}: PlanStepActionsProps) {
  const t = useT();
  const sessionId = item.mapping?.session_id ?? null;
  const cardId = item.mapping?.card_id ?? null;
  const label = busy ? t("plan_view.actions.working") : null;
  const runAction = (event: MouseEvent<HTMLButtonElement>, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  if (item.status === "ready") {
    return (
      <button
        type="button"
        className={actionClass(true)}
        onClick={(event) => runAction(event, onStart)}
        disabled={busy}
        data-testid="plan-step-action"
        data-action="start"
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
        {label ?? t("plan_view.actions.start")}
      </button>
    );
  }

  if (item.status === "in_progress") {
    if (cardId !== null) {
      return (
        <button
          type="button"
          className={actionClass(true)}
          onClick={(event) => runAction(event, onReview)}
          disabled={busy}
          data-testid="plan-step-action"
          data-action="review"
        >
          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
          {label ?? t("plan_view.actions.open_review")}
        </button>
      );
    }

    // Resume into the live session when present; otherwise re-open the step so an
    // in-progress step is never stranded behind a disabled "Locked" action.
    return (
      <button
        type="button"
        className={actionClass(true)}
        onClick={(event) =>
          runAction(event, () => (sessionId !== null ? onResume(sessionId) : onOpen()))
        }
        disabled={busy}
        data-testid="plan-step-action"
        data-action="resume"
      >
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        {label ?? t("plan_view.actions.resume")}
      </button>
    );
  }

  // S-054/D2: "blocked" is overloaded — a mapped step with a session hit a
  // recoverable provider error (rate limit) and can resume; a step with no
  // mapping is dependency-locked and falls through to the disabled button
  // below.
  if (item.status === "blocked" && sessionId !== null) {
    return (
      <button
        type="button"
        className={actionClass(true)}
        onClick={(event) => runAction(event, () => onResume(sessionId))}
        disabled={busy}
        title={t("plan_view.actions.resume_blocked_hint")}
        data-testid="plan-step-action"
        data-action="resume-blocked"
      >
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        {label ?? t("plan_view.actions.resume_blocked")}
      </button>
    );
  }

  if (item.status === "done" || item.status === "shipped") {
    return (
      <button
        type="button"
        className={actionClass(false)}
        onClick={(event) => runAction(event, onOpen)}
        disabled={busy}
        data-testid="plan-step-action"
        data-action="open"
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        {label ?? t("plan_view.actions.open")}
      </button>
    );
  }

  const lockedReason =
    item.blockedDependencies.length > 0
      ? t("plan_view.actions.locked_reason", { deps: item.blockedDependencies.join(" · ") })
      : t("plan_view.actions.locked_reason_generic");

  return (
    <button
      type="button"
      className={actionClass(false)}
      disabled
      title={lockedReason}
      aria-label={`${t("plan_view.actions.locked")} — ${lockedReason}`}
      data-testid="plan-step-action"
      data-action="locked"
    >
      {t("plan_view.actions.locked")}
    </button>
  );
}
