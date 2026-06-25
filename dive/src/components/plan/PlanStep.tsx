import { GitBranch } from "lucide-react";
import { forwardRef, type KeyboardEvent } from "react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { agencyToneClass, type PlanRoadmapStep } from "../../features/roadmap";
import { planStatusMeta } from "./plan-status-meta";
import { PlanStepActions } from "./PlanStepActions";
import { PlanStepNode } from "./PlanStepNode";
import type { PlanActionHandlers, PlanLineToken } from "./types";

interface PlanStepProps {
  item: PlanRoadmapStep;
  current: boolean;
  busy: boolean;
  parallel?: boolean;
  lineUp: PlanLineToken;
  lineDown: PlanLineToken;
  actions?: PlanActionHandlers;
  onActionStart?: (stepId: number) => void;
  onActionEnd?: () => void;
  onActionError?: (item: PlanRoadmapStep, error: unknown) => void;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function lineClass(token: PlanLineToken, side: "up" | "down") {
  if (token === "none") return "hidden";
  if (token === "done") return "bg-success";
  if (token === "active")
    return side === "up"
      ? "bg-gradient-to-b from-success to-accent"
      : "bg-gradient-to-b from-accent to-border";
  return "plan-spine-future";
}

export const PlanStep = forwardRef<HTMLDivElement, PlanStepProps>(function PlanStep(
  {
    item,
    current,
    busy,
    parallel = false,
    lineUp,
    lineDown,
    actions,
    onActionStart,
    onActionEnd,
    onActionError,
  },
  ref,
) {
  const t = useT();
  const meta = planStatusMeta(item.status);
  const dependencies = stringArray(item.step.dependencies);
  const summary = item.step.summary?.trim() ?? "";

  const run = async (focus = true, openDetail = false) => {
    if (!actions) return;
    onActionStart?.(item.step.id);
    try {
      await actions.onOpenStep(item.step.id, { focus, openDetail });
    } catch (error) {
      onActionError?.(item, error);
    } finally {
      onActionEnd?.();
    }
  };

  const openSession = () => {
    const sessionId = item.mapping?.session_id ?? null;
    if (sessionId !== null) actions?.onOpenSession(sessionId);
    else void run(false);
  };
  const openDetail = () => {
    if (item.mapping?.card_id !== null && item.mapping?.card_id !== undefined) {
      void run(true, true);
      return;
    }
    openSession();
  };

  // Row text mirrors the row's primary action so the whole row reads as
  // clickable — not just the small right-side button. Blocked steps stay
  // non-interactive (no safe open path that wouldn't bypass the lock).
  const rowActionable = Boolean(actions) && item.status !== "blocked";
  const activate = () => {
    if (!rowActionable || busy) return;
    if (item.status === "ready") void run();
    else if (item.mapping?.card_id !== null && item.mapping?.card_id !== undefined) openDetail();
    else openSession();
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={cn(
        "grid grid-cols-[54px_minmax(0,1fr)] outline-none",
        item.status === "blocked" && "opacity-65",
      )}
      data-testid="plan-step"
      data-plan-step-id={item.step.step_id}
      data-plan-step-status={item.status}
    >
      <div className="relative" aria-hidden>
        {!parallel ? (
          <>
            <span
              className={cn(
                "absolute left-1/2 top-0 w-0.5 -translate-x-1/2",
                "h-[calc(50%-13px)]",
                lineClass(lineUp, "up"),
              )}
            />
            <span
              className={cn(
                "absolute bottom-0 left-1/2 top-[calc(50%+13px)] w-0.5 -translate-x-1/2",
                lineClass(lineDown, "down"),
              )}
            />
          </>
        ) : null}
        <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <PlanStepNode status={item.status} current={current} />
        </span>
      </div>
      <div
        className={cn(
          "min-w-0 py-3.5 pl-1 pr-0",
          current && "bg-gradient-to-r from-accent/10 to-transparent pl-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] font-bold tracking-[0.02em] text-fg">
            {item.step.step_id}
          </span>
          <span
            className={cn(
              "shrink-0 whitespace-nowrap border px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em]",
              meta.tagClass,
            )}
          >
            {t(meta.labelKey)}
          </span>
          {parallel ? (
            <span className="shrink-0 whitespace-nowrap border border-accent/45 bg-accent-subtle px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-fg">
              {t("plan_view.parallel_tag")}
            </span>
          ) : null}
          {item.agency?.primary ? (
            <span
              className={cn(
                "shrink-0 whitespace-nowrap border px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]",
                agencyToneClass(item.agency.primary.tone),
              )}
              data-testid="plan-step-agency-state"
              data-agency-state={item.agency.primary.id}
            >
              {t(item.agency.primary.labelKey)}
            </span>
          ) : null}
          <span className="flex-1" />
          {actions ? (
            <PlanStepActions
              item={item}
              busy={busy}
              onStart={() => void run()}
              onResume={actions.onOpenSession}
              onOpen={openDetail}
              onReview={openDetail}
            />
          ) : null}
        </div>
        {rowActionable ? (
          <div
            role="button"
            tabIndex={busy ? -1 : 0}
            onClick={activate}
            onKeyDown={onRowKeyDown}
            aria-disabled={busy || undefined}
            aria-label={t("plan_view.open_step_aria", {
              step: item.step.step_id,
              title: item.step.title,
            })}
            data-testid="plan-step-open"
            className={cn(
              "group/open mt-2 block w-full rounded-sm text-left outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring",
              busy ? "cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <h3 className="text-base font-semibold leading-snug text-fg transition group-hover/open:text-accent">
              {item.step.title}
            </h3>
            {summary ? <p className="mt-1 line-clamp-2 text-xs text-fg">{summary}</p> : null}
          </div>
        ) : (
          <>
            <h3 className="mt-2 text-base font-semibold leading-snug text-fg">{item.step.title}</h3>
            {summary ? <p className="mt-1 line-clamp-2 text-xs text-fg">{summary}</p> : null}
          </>
        )}
        {item.linkedCriteria?.length ? (
          <div
            className="mt-2 rounded-sm border border-border/70 bg-bg/60 px-2 py-1.5 text-[11px]"
            data-testid="plan-step-criteria"
          >
            <div className="flex flex-wrap gap-1">
              {item.linkedCriteria.map((criterion) => (
                <span
                  key={criterion.criterionId}
                  className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-bg-panel px-1.5 py-0.5 text-fg"
                >
                  <span className="shrink-0 font-semibold text-accent">
                    {criterion.criterionId}
                  </span>
                  <span className="truncate">{criterion.text}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {item.blockedDependencies.length > 0 || dependencies.length > 0 ? (
          <div
            className={cn(
              "mt-2 flex flex-wrap items-center gap-2 font-mono text-[10.5px]",
              item.blockedDependencies.length > 0 ? "text-danger" : "text-fg-muted",
            )}
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            <span className="font-semibold">
              {item.blockedDependencies.length > 0
                ? t("plan_view.blocked_by")
                : t("plan_view.dependencies")}
            </span>
            <span>
              {(item.blockedDependencies.length > 0 ? item.blockedDependencies : dependencies).join(
                " · ",
              )}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
});
