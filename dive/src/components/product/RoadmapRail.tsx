import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  GitBranch,
  ListChecks,
  Lock,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  activityEventLabel,
  makeRoadmapActionFailure,
  type PlanActivityLogRow,
  type PlanRoadmapStep,
  type RoadmapActionFailure,
  type StepSessionMappingRow,
  type usePlanActivity,
  type usePlanRoadmap,
} from "../../features/roadmap";
import { useLocale, useT, type Locale } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { RoadmapDAG } from "../roadmap/RoadmapDAG";
import { RoadmapPanel } from "./RoadmapPanel";
import type { ProductShellController } from "./useProductShellController";

type PlanRoadmapModel = ReturnType<typeof usePlanRoadmap>;
type PlanActivityModel = ReturnType<typeof usePlanActivity>;

interface RoadmapRailProps {
  planRoadmap: PlanRoadmapModel;
  planActivity: PlanActivityModel;
  fallbackRoadmap: ProductShellController["roadmap"];
  onOpenPlanStep: (stepId: number, opts?: { focus?: boolean }) => Promise<StepSessionMappingRow>;
  onMarkPlanStepDone: (stepId: number) => Promise<StepSessionMappingRow>;
  onOpenSession: (sessionId: number) => void;
}

interface PlanSummary {
  total: number;
  completed: number;
  ready: number;
  blocked: number;
  active: number;
  percent: number;
  overall: "in_progress" | "done" | "halted";
}

const STATUS_CLASS: Record<PlanRoadmapStep["status"], string> = {
  blocked: "border-border bg-bg-panel2 text-fg-muted",
  ready: "border-accent/60 bg-accent/10 text-accent",
  in_progress: "border-warn/60 bg-warn/10 text-warn",
  done: "border-success/60 bg-success/10 text-success",
  shipped: "border-success/70 bg-success/15 text-success",
};

const OVERALL_PILL_CLASS: Record<PlanSummary["overall"], string> = {
  in_progress: "border-accent/50 bg-accent/10 text-accent",
  done: "border-success/60 bg-success/15 text-success",
  halted: "border-danger/60 bg-danger/10 text-danger",
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function summarizePlan(steps: PlanRoadmapStep[]): PlanSummary {
  const total = steps.length;
  const completed = steps.filter(
    (item) => item.status === "done" || item.status === "shipped",
  ).length;
  const ready = steps.filter((item) => item.status === "ready").length;
  const blocked = steps.filter((item) => item.status === "blocked").length;
  const active = steps.filter((item) => item.status === "in_progress").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const overall =
    total > 0 && completed === total
      ? "done"
      : ready === 0 && active === 0 && blocked > 0
        ? "halted"
        : "in_progress";
  return { total, completed, ready, blocked, active, percent, overall };
}

function currentStepFor(steps: PlanRoadmapStep[]): PlanRoadmapStep | null {
  return (
    steps.find((item) => item.status === "in_progress") ??
    steps.find((item) => item.status === "ready") ??
    steps.find((item) => item.status === "blocked") ??
    steps[0] ??
    null
  );
}

function statusIcon(status: PlanRoadmapStep["status"]) {
  if (status === "done" || status === "shipped") return <CheckCircle2 aria-hidden />;
  if (status === "ready") return <Play aria-hidden />;
  if (status === "in_progress") return <AlertCircle aria-hidden />;
  if (status === "blocked") return <Lock aria-hidden />;
  return <Circle aria-hidden />;
}

export function RoadmapRail({
  planRoadmap,
  planActivity,
  fallbackRoadmap,
  onOpenPlanStep,
  onMarkPlanStepDone,
  onOpenSession,
}: RoadmapRailProps) {
  if (!planRoadmap.hasPlan && fallbackRoadmap.visible) {
    const { visible: _visible, ...panelProps } = fallbackRoadmap;
    return <RoadmapPanel className="h-full min-h-0 border-l-0" {...panelProps} />;
  }

  return (
    <PlanRoadmapRail
      planRoadmap={planRoadmap}
      planActivity={planActivity}
      onOpenPlanStep={onOpenPlanStep}
      onMarkPlanStepDone={onMarkPlanStepDone}
      onOpenSession={onOpenSession}
    />
  );
}

function PlanRoadmapRail({
  planRoadmap,
  planActivity,
  onOpenPlanStep,
  onMarkPlanStepDone,
  onOpenSession,
}: Omit<RoadmapRailProps, "fallbackRoadmap">) {
  const t = useT();
  const summary = useMemo(() => summarizePlan(planRoadmap.steps), [planRoadmap.steps]);
  const currentStep = useMemo(() => currentStepFor(planRoadmap.steps), [planRoadmap.steps]);
  const [graphOpen, setGraphOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [busyStepId, setBusyStepId] = useState<number | null>(null);
  const [actionFailure, setActionFailure] = useState<RoadmapActionFailure | null>(null);

  const handleOpenStep = async (item: PlanRoadmapStep, opts?: { focus?: boolean }) => {
    setBusyStepId(item.step.id);
    setActionFailure(null);
    try {
      await onOpenPlanStep(item.step.id, opts);
    } catch (error) {
      setActionFailure(
        makeRoadmapActionFailure({
          action: "start_step",
          stepLabel: `${item.step.step_id}: ${item.step.title}`,
          error,
        }),
      );
    } finally {
      setBusyStepId(null);
    }
  };

  const handleMarkStepDone = async (item: PlanRoadmapStep) => {
    setBusyStepId(item.step.id);
    setActionFailure(null);
    try {
      await onMarkPlanStepDone(item.step.id);
    } catch (error) {
      setActionFailure(
        makeRoadmapActionFailure({
          action: "complete_step",
          stepLabel: `${item.step.step_id}: ${item.step.title}`,
          error,
        }),
      );
    } finally {
      setBusyStepId(null);
    }
  };

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-bg-panel text-fg"
      aria-label={t("roadmap.title")}
      data-testid="roadmap-rail"
      data-roadmap-step-count={summary.total}
      data-roadmap-overall-status={summary.overall}
    >
      <header className="shrink-0 space-y-3 border-b px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" aria-hidden />
              <h2 className="text-base font-bold">{t("roadmap.title")}</h2>
            </div>
            {planRoadmap.status?.plan_summary ? (
              <div className="mt-2" data-testid="roadmap-goal">
                <div className="text-[10px] font-semibold uppercase text-fg-muted">
                  {t("roadmap.goal_label")}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs font-medium text-fg">
                  {planRoadmap.status.plan_summary}
                </p>
              </div>
            ) : null}
          </div>
          <OverallStatusPill overall={summary.overall} />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-fg-muted" data-testid="roadmap-summary-counts">
              {t("roadmap.summary_counts", {
                completed: summary.completed,
                total: summary.total,
              })}
            </span>
            <span className="font-semibold">{summary.percent}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-bg-panel2"
            role="progressbar"
            aria-label={t("roadmap.progress_aria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percent}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${summary.percent}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <Metric label={t("roadmap.plan_graph.status.ready")} value={summary.ready} />
            <Metric label={t("roadmap.plan_graph.status.in_progress")} value={summary.active} />
            <Metric label={t("roadmap.plan_graph.status.blocked")} value={summary.blocked} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGraphOpen(true)}
            disabled={planRoadmap.loading || planRoadmap.steps.length === 0}
            className="flex-1 justify-center"
          >
            <GitBranch className="h-4 w-4" aria-hidden />
            {t("roadmap.plan_graph.open_graph")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void planRoadmap.refresh()}
            disabled={planRoadmap.loading}
            aria-label={t("roadmap.refresh")}
          >
            <RefreshCw className={cn(planRoadmap.loading && "animate-spin")} />
          </Button>
        </div>
      </header>

      {planRoadmap.error ? (
        <div className="border-b px-4 py-3 text-xs text-danger">{planRoadmap.error}</div>
      ) : null}

      {actionFailure ? (
        <ActionFailurePanel failure={actionFailure} onDismiss={() => setActionFailure(null)} />
      ) : null}

      {summary.total === 0 && !planRoadmap.loading ? (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
          <div>
            <div className="text-sm font-semibold text-fg">{t("roadmap.empty_v2_title")}</div>
            <p className="mt-2 text-xs text-fg-muted">{t("roadmap.empty_v2_description")}</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {currentStep ? <CurrentPlanStep item={currentStep} /> : null}
          <ol className="mt-3 space-y-2" data-testid="roadmap-step-list">
            {planRoadmap.steps.map((item) => (
              <li key={item.step.id}>
                <PlanStepItem
                  item={item}
                  busy={busyStepId === item.step.id}
                  onOpen={() => void handleOpenStep(item)}
                  onMarkDone={() => void handleMarkStepDone(item)}
                  onResume={(sessionId) => onOpenSession(sessionId)}
                />
              </li>
            ))}
          </ol>
        </div>
      )}

      <ActivitySection model={planActivity} open={activityOpen} onOpenChange={setActivityOpen} />

      <Dialog open={graphOpen} onOpenChange={setGraphOpen}>
        <DialogContent className="max-h-[86vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("roadmap.plan_graph.graph_title")}</DialogTitle>
            <DialogDescription>
              {t("roadmap.plan_graph.summary", {
                total: summary.total,
                ready: summary.ready,
                blocked: summary.blocked,
              })}
            </DialogDescription>
          </DialogHeader>
          <RoadmapDAG
            steps={planRoadmap.steps}
            loading={planRoadmap.loading}
            error={planRoadmap.error}
            onOpenStep={onOpenPlanStep}
            onOpenSession={onOpenSession}
            className="max-h-[68vh] border-0 bg-bg-panel2"
          />
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function OverallStatusPill({ overall }: { overall: PlanSummary["overall"] }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        OVERALL_PILL_CLASS[overall],
      )}
      data-testid="roadmap-overall-pill"
    >
      {overall === "halted" ? (
        <PauseCircle className="h-3 w-3" aria-hidden />
      ) : overall === "done" ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden />
      ) : (
        <Clock3 className="h-3 w-3" aria-hidden />
      )}
      {t(`roadmap.overall_status.${overall}`)}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-bg px-2 py-1.5">
      <div className="truncate text-[10px] font-medium text-fg-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

function CurrentPlanStep({ item }: { item: PlanRoadmapStep }) {
  const t = useT();
  return (
    <section
      className="rounded-md border border-accent/40 bg-accent/10 p-3"
      data-testid="roadmap-current-step"
    >
      <div className="text-xs font-semibold uppercase text-fg-muted">
        {t("roadmap.current_step")}
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-fg-muted">{item.step.step_id}</div>
          <h3 className="mt-0.5 line-clamp-2 text-sm font-bold text-fg">{item.step.title}</h3>
        </div>
        <StatusPill status={item.status} />
      </div>
      {item.step.summary ? (
        <p className="mt-2 line-clamp-3 text-xs text-fg-muted">{item.step.summary}</p>
      ) : null}
      <NextAction item={item} />
    </section>
  );
}

function PlanStepItem({
  item,
  busy,
  onOpen,
  onMarkDone,
  onResume,
}: {
  item: PlanRoadmapStep;
  busy: boolean;
  onOpen: () => void;
  onMarkDone: () => void;
  onResume: (sessionId: number) => void;
}) {
  const t = useT();
  const dependencies = stringArray(item.step.dependencies);
  const sessionId = item.mapping?.session_id ?? null;

  return (
    <div
      className={cn(
        "rounded-md border bg-bg px-3 py-3",
        item.status === "in_progress" && "border-warn/60",
        item.status === "ready" && "border-accent/60",
      )}
      data-testid="roadmap-step"
      data-plan-step-status={item.status}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-fg-muted">{item.step.step_id}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-fg">{item.step.title}</div>
        </div>
        <StatusPill status={item.status} />
      </div>

      {item.step.summary ? (
        <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{item.step.summary}</p>
      ) : null}

      <StepMetadata item={item} dependencies={dependencies} />

      <div className="mt-3 flex items-center gap-2">
        {item.status === "ready" ? (
          <Button size="sm" variant="outline" onClick={onOpen} disabled={busy} className="flex-1">
            <Play className="h-4 w-4" aria-hidden />
            {busy ? t("roadmap.dashboard.working") : t("roadmap.dashboard.start")}
          </Button>
        ) : (item.status === "in_progress" || item.status === "blocked") && sessionId !== null ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onResume(sessionId)}
              disabled={busy}
              className="flex-1"
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              {t("roadmap.plan_graph.resume")}
            </Button>
            <Button size="sm" variant="outline" onClick={onMarkDone} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {busy ? t("roadmap.dashboard.working") : t("roadmap.plan_graph.mark_done")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: PlanRoadmapStep["status"] }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        STATUS_CLASS[status],
      )}
    >
      <span className="h-3 w-3">{statusIcon(status)}</span>
      {t(`roadmap.plan_graph.status.${status}`)}
    </span>
  );
}

function StepMetadata({ item, dependencies }: { item: PlanRoadmapStep; dependencies: string[] }) {
  const t = useT();
  const parallelLabel =
    item.parallelBucket === "auto"
      ? t("roadmap.plan_graph.parallel_auto")
      : item.parallelBucket?.startsWith("explicit:")
        ? t("roadmap.plan_graph.parallel_explicit", {
            name: item.parallelBucket.replace(/^explicit:/, ""),
          })
        : null;

  if (item.blockedDependencies.length === 0 && dependencies.length === 0 && !parallelLabel) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1 text-[11px] text-fg-muted">
      {item.blockedDependencies.length > 0 ? (
        <div className="flex items-start gap-1.5 text-warn">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {t("roadmap.plan_graph.waiting_for", {
              deps: item.blockedDependencies.join(", "),
            })}
          </span>
        </div>
      ) : dependencies.length > 0 ? (
        <div className="flex items-start gap-1.5">
          <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{dependencies.join(", ")}</span>
        </div>
      ) : null}
      {parallelLabel ? (
        <div className="flex items-start gap-1.5">
          <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{parallelLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function NextAction({ item }: { item: PlanRoadmapStep }) {
  const t = useT();
  const key =
    item.status === "ready"
      ? "planned"
      : item.status === "in_progress"
        ? "in_progress"
        : item.status;
  return (
    <div className="mt-3 rounded-md border border-border/70 bg-bg/70 px-3 py-2 text-xs">
      <div className="font-semibold text-fg">{t("roadmap.next_action_label")}</div>
      <p className="mt-1 text-fg-muted">{t(`roadmap.next_action_v2.${key}`)}</p>
    </div>
  );
}

function ActionFailurePanel({
  failure,
  onDismiss,
}: {
  failure: RoadmapActionFailure;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div
      className="border-b border-danger/30 bg-danger/10 px-4 py-3 text-xs"
      data-testid="roadmap-action-failure"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fg">{t("roadmap.action_failure.single_title")}</div>
          <div className="mt-1 text-danger">
            <span className="font-medium text-fg">{failure.stepLabel}</span>
            <span className="text-fg-muted"> - </span>
            {failure.message}
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-fg-muted hover:bg-bg-panel2 hover:text-fg"
          onClick={onDismiss}
          aria-label={t("roadmap.action_failure.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ActivitySection({
  model,
  open,
  onOpenChange,
}: {
  model: PlanActivityModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <section className="shrink-0 border-t bg-bg-panel2" data-testid="plan-activity-feed">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-sm text-left text-sm font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-fg-muted" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
          )}
          <Activity className="h-4 w-4 text-accent" aria-hidden />
          <span className="truncate">{t("roadmap.activity.title")}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void model.refresh()}
          disabled={model.loading}
          aria-label={t("roadmap.activity.refresh")}
        >
          <RefreshCw className={cn(model.loading && "animate-spin")} />
        </Button>
      </div>
      {open ? <ActivityList model={model} /> : null}
    </section>
  );
}

function ActivityList({ model }: { model: PlanActivityModel }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="max-h-48 overflow-y-auto px-4 pb-3">
      {model.error ? (
        <div className="text-xs text-danger">
          {t("roadmap.activity.error", { message: model.error })}
        </div>
      ) : null}
      {!model.error && model.activities.length === 0 && !model.loading ? (
        <div className="text-xs text-fg-muted">{t("roadmap.activity.empty")}</div>
      ) : null}
      {model.activities.length > 0 ? (
        <ol className="space-y-2">
          {model.activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} locale={locale} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ActivityItem({ activity, locale }: { activity: PlanActivityLogRow; locale: Locale }) {
  const t = useT();
  return (
    <li className="flex gap-2 text-xs">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-fg">{activityEventLabel(t, activity)}</span>
          <time className="shrink-0 text-[10px] text-fg-muted">
            {formatActivityTime(activity.created_at, locale)}
          </time>
        </div>
        {activity.stable_step_id || activity.step_title ? (
          <div className="mt-0.5 truncate text-[11px] text-fg-muted">
            {[activity.stable_step_id, activity.step_title].filter(Boolean).join(" · ")}
          </div>
        ) : null}
        {activity.reason ? (
          <div className="mt-1 line-clamp-2 text-[11px] text-danger">{activity.reason}</div>
        ) : null}
      </div>
    </li>
  );
}

function formatActivityTime(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
