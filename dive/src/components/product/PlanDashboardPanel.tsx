import {
  AlertTriangle,
  BarChart3,
  Clock3,
  FolderOpen,
  Play,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  PLAN_ROADMAP_REFRESH_EVENT,
  activityEventLabel,
  makeRoadmapActionFailure,
  usePlanDashboard,
  type PlanDashboardProject,
  type RoadmapActionFailure,
  type PlanDashboardStep,
} from "../../features/roadmap";
import {
  requestPlanDraftReview,
  usePlan,
  usePlanRouter,
  type AppendPlanStepInput,
} from "../../features/planning";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import { useProjectSessionStore } from "../../stores/project-session";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useToast } from "../toast/toast-context";
import { PlanAddStepPanel } from "./PlanAddStepPanel";

function completionPercent(project: PlanDashboardProject) {
  if (project.step_count === 0) return 0;
  return Math.round(((project.done_count + project.shipped_count) / project.step_count) * 100);
}

function statusVariant(project: PlanDashboardProject) {
  if (project.plan_id === null) return "outline" as const;
  if (project.plan_status !== "approved") return "warn" as const;
  if (project.step_count > 0 && project.done_count + project.shipped_count === project.step_count) {
    return "success" as const;
  }
  if (project.active_count > 0) return "info" as const;
  if (project.ready_count > 0) return "accent" as const;
  if (project.blocked_count > 0) return "warn" as const;
  return "outline" as const;
}

function dispatchPlanRoadmapRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PLAN_ROADMAP_REFRESH_EVENT));
}

export function PlanDashboardPanel() {
  const t = useT();
  const dashboard = usePlanDashboard();
  const { toast } = useToast();
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const selectProject = useProjectSessionStore((s) => s.selectProject);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const selectSession = useProjectSessionStore((s) => s.selectSession);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<RoadmapActionFailure | null>(null);

  const openProject = async (project: PlanDashboardProject) => {
    await selectProject(project.project_id);
    await loadAll();
    dispatchPlanRoadmapRefresh();
  };

  const handleOpenProject = async (project: PlanDashboardProject) => {
    const key = `open:${project.project_id}`;
    setBusyAction(key);
    setActionFailure(null);
    try {
      await openProject(project);
      if (project.plan_id !== null && project.plan_status !== "approved") {
        requestPlanDraftReview(project.project_id);
      }
    } catch (err) {
      setActionFailure(
        makeRoadmapActionFailure({
          action: "open_project",
          projectName: project.project_name,
          error: err,
        }),
      );
      toast({
        variant: "error",
        title: t("roadmap.dashboard.action_failed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResume = async (project: PlanDashboardProject, step: PlanDashboardStep) => {
    if (step.session_id === null) return;
    const key = `resume:${project.project_id}:${step.step_db_id}`;
    setBusyAction(key);
    setActionFailure(null);
    try {
      await openProject(project);
      selectSession(step.session_id);
      await dashboard.refresh();
    } catch (err) {
      setActionFailure(
        makeRoadmapActionFailure({
          action: "resume_step",
          projectName: project.project_name,
          stepLabel: `${step.stable_step_id}: ${step.title}`,
          error: err,
        }),
      );
      toast({
        variant: "error",
        title: t("roadmap.dashboard.action_failed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleStart = async (project: PlanDashboardProject, step: PlanDashboardStep) => {
    const key = `start:${project.project_id}:${step.step_db_id}`;
    setBusyAction(key);
    setActionFailure(null);
    try {
      await selectProject(project.project_id);
      const mapping = await dashboard.openStep(step.step_db_id);
      await loadAll();
      if (mapping.session_id !== null) selectSession(mapping.session_id);
      dispatchPlanRoadmapRefresh();
      await dashboard.refresh();
    } catch (err) {
      setActionFailure(
        makeRoadmapActionFailure({
          action: "start_step",
          projectName: project.project_name,
          stepLabel: `${step.stable_step_id}: ${step.title}`,
          error: err,
        }),
      );
      toast({
        variant: "error",
        title: t("roadmap.dashboard.action_failed", {
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-bg-panel"
      data-testid="plan-dashboard-panel"
    >
      <header className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <BarChart3 className="h-4 w-4 text-accent" aria-hidden />
              {t("roadmap.dashboard.title")}
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              {t("roadmap.dashboard.summary", {
                projects: dashboard.totals.projects,
                planned: dashboard.totals.plannedProjects,
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void dashboard.refresh()}
            disabled={dashboard.loading}
            aria-label={t("roadmap.dashboard.refresh")}
          >
            <RefreshCw className={cn(dashboard.loading && "animate-spin")} />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label={t("roadmap.dashboard.metric_ready")} value={dashboard.totals.ready} />
          <Metric label={t("roadmap.dashboard.metric_active")} value={dashboard.totals.active} />
          <Metric label={t("roadmap.dashboard.metric_blocked")} value={dashboard.totals.blocked} />
        </div>
      </header>

      {actionFailure ? (
        <DashboardActionFailurePanel
          failure={actionFailure}
          onDismiss={() => setActionFailure(null)}
        />
      ) : null}

      {dashboard.error ? (
        <div className="px-4 py-3 text-xs text-danger">{dashboard.error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {dashboard.projects.length === 0 && !dashboard.loading ? (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-fg-muted">
            {t("roadmap.dashboard.empty")}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {dashboard.projects.map((project) => (
              <DashboardProjectItem
                key={project.project_id}
                project={project}
                active={currentProjectId === project.project_id}
                busyAction={busyAction}
                onOpenProject={handleOpenProject}
                onResume={handleResume}
                onStart={handleStart}
                onPlanMutated={async () => {
                  dispatchPlanRoadmapRefresh();
                  await dashboard.refresh();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DashboardActionFailurePanel({
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
      data-testid="dashboard-action-failure"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fg">{t("roadmap.action_failure.single_title")}</div>
          <div className="mt-1 text-fg-muted">
            {failure.projectName ? <span>{failure.projectName}</span> : null}
            {failure.stepLabel ? (
              <>
                <span> · </span>
                <span>{failure.stepLabel}</span>
              </>
            ) : null}
          </div>
          <div className="mt-1 text-danger">{failure.message}</div>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-bg px-2 py-1.5">
      <div className="text-[10px] font-medium text-fg-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

interface DashboardProjectItemProps {
  project: PlanDashboardProject;
  active: boolean;
  busyAction: string | null;
  onOpenProject: (project: PlanDashboardProject) => Promise<void>;
  onResume: (project: PlanDashboardProject, step: PlanDashboardStep) => Promise<void>;
  onStart: (project: PlanDashboardProject, step: PlanDashboardStep) => Promise<void>;
  onPlanMutated: () => Promise<void>;
}

function DashboardProjectItem({
  project,
  active,
  busyAction,
  onOpenProject,
  onResume,
  onStart,
  onPlanMutated,
}: DashboardProjectItemProps) {
  const t = useT();
  const plan = usePlan(project.project_id);
  const planRouter = usePlanRouter(project.project_id);
  const activeStep = project.active_steps[0] ?? null;
  const readyStep = project.next_ready_steps[0] ?? null;
  const needsPlanReview = project.plan_id !== null && project.plan_status !== "approved";
  const canResume = activeStep?.session_id !== null && activeStep?.session_id !== undefined;
  const canStart = project.plan_status === "approved" && readyStep !== null;
  const percent = completionPercent(project);
  const statusText = projectStatusText(t, project);
  const detail = projectDetailText(t, project, activeStep, readyStep);
  const openKey = `open:${project.project_id}`;
  const resumeKey = activeStep ? `resume:${project.project_id}:${activeStep.step_db_id}` : "";
  const startKey = readyStep ? `start:${project.project_id}:${readyStep.step_db_id}` : "";
  const canAppendStep = project.plan_id !== null && project.plan_status === "approved";

  const handleAppendStep = async (input: AppendPlanStepInput) => {
    await plan.appendStep(input);
    await onPlanMutated();
  };

  const handleDraftRequest = async (request: string) => {
    const decision = await planRouter.route(request);
    if (decision.action === "add_step") {
      return {
        status: "draft" as const,
        draft: decision.draft,
        reason: decision.reason,
      };
    }
    // Non-add_step outcomes (chat / skip / clarify / remove_step /
    // supersede_step / duplicate) carry a reason but no draft here; P8 will
    // surface duplicate/remove/supersede proposals in this dashboard path too.
    return {
      status: "none" as const,
      reason: decision.reason,
    };
  };

  return (
    <li
      className={cn(
        "rounded-md border bg-bg px-3 py-3",
        active ? "border-accent/60" : "border-border",
      )}
      data-testid="plan-dashboard-project"
      data-project-id={project.project_id}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{project.project_name}</div>
          <div className="truncate text-xs text-fg-muted">{project.project_path}</div>
        </div>
        <Badge variant={statusVariant(project)} className="shrink-0">
          {statusText}
        </Badge>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-bg-panel2">
        <div className="h-full bg-success" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-muted">
        <span>
          {t("roadmap.dashboard.progress", {
            done: project.done_count + project.shipped_count,
            total: project.step_count,
          })}
        </span>
        <span>
          {t("roadmap.dashboard.counts", {
            ready: project.ready_count,
            active: project.active_count,
            blocked: project.blocked_count,
          })}
        </span>
      </div>

      <div className="mt-2 truncate text-xs text-fg-muted">{detail}</div>

      {project.last_activity ? (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
          <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {t("roadmap.dashboard.last_activity")}:{" "}
            {dashboardActivityText(t, project.last_activity)}
          </span>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {needsPlanReview ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onOpenProject(project)}
            disabled={busyAction !== null}
            className="flex-1"
          >
            <FolderOpen />
            {busyAction === openKey
              ? t("roadmap.dashboard.working")
              : t("roadmap.dashboard.review_plan")}
          </Button>
        ) : canResume && activeStep ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onResume(project, activeStep)}
            disabled={busyAction !== null}
            className="flex-1"
          >
            <RotateCw />
            {busyAction === resumeKey
              ? t("roadmap.dashboard.working")
              : t("roadmap.dashboard.resume")}
          </Button>
        ) : canStart && readyStep ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onStart(project, readyStep)}
            disabled={busyAction !== null}
            className="flex-1"
          >
            <Play />
            {busyAction === startKey
              ? t("roadmap.dashboard.working")
              : t("roadmap.dashboard.start")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onOpenProject(project)}
            disabled={busyAction !== null}
            className="flex-1"
          >
            <FolderOpen />
            {busyAction === openKey
              ? t("roadmap.dashboard.working")
              : t("roadmap.dashboard.open_project")}
          </Button>
        )}
      </div>

      {canAppendStep && project.plan_id !== null ? (
        <PlanAddStepPanel
          projectId={project.project_id}
          planId={project.plan_id}
          projectName={project.project_name}
          projectSpec={project.project_spec ?? null}
          busy={busyAction !== null || planRouter.busy}
          onAppendStep={handleAppendStep}
          onDraftRequest={handleDraftRequest}
        />
      ) : null}
    </li>
  );
}

function projectStatusText(t: ReturnType<typeof useT>, project: PlanDashboardProject) {
  if (project.plan_id === null) return t("roadmap.dashboard.status.no_plan");
  if (project.plan_status !== "approved") return t("roadmap.dashboard.status.draft");
  if (project.step_count > 0 && project.done_count + project.shipped_count === project.step_count) {
    return t("roadmap.dashboard.status.complete");
  }
  if (project.active_count > 0) {
    return t("roadmap.dashboard.status.active", { count: project.active_count });
  }
  if (project.ready_count > 0) {
    return t("roadmap.dashboard.status.ready", { count: project.ready_count });
  }
  if (project.blocked_count > 0) return t("roadmap.dashboard.status.blocked");
  return t("roadmap.dashboard.status.idle");
}

function projectDetailText(
  t: ReturnType<typeof useT>,
  project: PlanDashboardProject,
  activeStep: PlanDashboardStep | null,
  readyStep: PlanDashboardStep | null,
) {
  if (activeStep) {
    return t("roadmap.dashboard.detail_active", {
      step: activeStep.stable_step_id,
      title: activeStep.title,
    });
  }
  if (readyStep && project.plan_status === "approved") {
    return t("roadmap.dashboard.detail_ready", {
      step: readyStep.stable_step_id,
      title: readyStep.title,
    });
  }
  if (project.plan_id === null) return t("roadmap.dashboard.detail_no_plan");
  if (project.plan_status !== "approved") return t("roadmap.dashboard.detail_draft");
  return t("roadmap.dashboard.detail_idle");
}

function dashboardActivityText(
  t: ReturnType<typeof useT>,
  activity: NonNullable<PlanDashboardProject["last_activity"]>,
) {
  const label = activityEventLabel(t, activity);
  return activity.stable_step_id ? `${label} · ${activity.stable_step_id}` : label;
}
