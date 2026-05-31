import { lazy, Suspense } from "react";
import type { ProductShellController } from "./useProductShellController";
import { ActionDock } from "./ActionDock";
import { ConversationPanel } from "./ConversationPanel";
import { ProductModalHost } from "./ProductModalHost";
import { ProjectRail } from "./ProjectRail";
import { TopBar } from "./TopBar";
import { usePlanActivity } from "../../features/roadmap";
import { useProjectSessionStore } from "../../stores/project-session";

const RoadmapRail = lazy(() => import("./RoadmapRail").then((module) => ({ default: module.RoadmapRail })));
const StepDetailSlideIn = lazy(() =>
  import("./StepDetailSlideIn").then((module) => ({ default: module.StepDetailSlideIn })),
);
const RecoverySlideIn = lazy(() =>
  import("./RecoverySlideIn").then((module) => ({ default: module.RecoverySlideIn })),
);

interface ProductShellLayoutProps {
  shell: ProductShellController;
}

interface OpenPlanStepOptions {
  focus?: boolean;
}

export function ProductShellLayout({ shell }: ProductShellLayoutProps) {
  const selectSession = useProjectSessionStore((s) => s.selectSession);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const planActivity = usePlanActivity(shell.planRoadmap.status?.plan_id ?? null, 5);
  const rightPanelVisible = shell.roadmap.visible || shell.planRoadmap.hasPlan;
  const gridCols = rightPanelVisible
    ? "grid-cols-[280px_minmax(0,1fr)_360px]"
    : "grid-cols-[280px_minmax(0,1fr)]";
  const handleOpenSession = (sessionId: number) => {
    selectSession(sessionId);
    void loadAll();
  };
  const handleOpenPlanStep = async (stepId: number, opts?: OpenPlanStepOptions) => {
    const mapping = await shell.planRoadmap.openStep(stepId);
    await planActivity.refresh();
    if (mapping.session_id !== null) {
      shell.roadmap.onPlanStepOpened(mapping);
      await loadAll();
      if (opts?.focus !== false) {
        selectSession(mapping.session_id);
      }
    }
    return mapping;
  };
  const handleMarkPlanStepDone = async (stepId: number) => {
    const mapping = await shell.planRoadmap.updateStepState({
      stepId,
      status: "done",
      evidence: "Marked complete from the roadmap rail after user verification.",
      verificationStatus: "manual_done",
    });
    await planActivity.refresh();
    await loadAll();
    return mapping;
  };
  return (
    <div
      className={`relative h-screen w-screen grid ${gridCols} grid-rows-[auto_1fr] overflow-hidden bg-bg text-fg transition-[grid-template-columns] duration-200`}
      data-testid="main-shell"
      data-roadmap-visible={rightPanelVisible ? "true" : "false"}
    >
      <TopBar
        projectName={shell.projectName}
        providerBanner={shell.providerBanner}
        recoveryCount={shell.recovery.checkpointCount}
        hasFailedStep={shell.recovery.hasFailedStep}
        onOpenRecovery={() => shell.recovery.onOpenChange(true)}
      />
      <div className="row-start-2 col-start-1 min-h-0">
        <ProjectRail />
      </div>
      <div className="row-start-2 col-start-2 min-h-0">
        <ConversationPanel conversation={shell.conversation} />
      </div>
      {rightPanelVisible ? (
        <div className="row-start-2 col-start-3 min-h-0 flex flex-col overflow-hidden border-l bg-bg">
          <Suspense fallback={null}>
            <RoadmapRail
              planRoadmap={shell.planRoadmap}
              planActivity={planActivity}
              fallbackRoadmap={shell.roadmap}
              onOpenPlanStep={handleOpenPlanStep}
              onMarkPlanStepDone={handleMarkPlanStepDone}
              onOpenSession={handleOpenSession}
            />
          </Suspense>
        </div>
      ) : null}
      <ActionDock />
      <ProductModalHost modals={shell.modals} />
      {shell.stepDetail.open ? (
        <Suspense fallback={null}>
          <StepDetailSlideIn {...shell.stepDetail} />
        </Suspense>
      ) : null}
      {shell.recovery.open ? (
        <Suspense fallback={null}>
          <RecoverySlideIn
            open={shell.recovery.open}
            onOpenChange={shell.recovery.onOpenChange}
            recovery={shell.recovery.panel}
          />
        </Suspense>
      ) : null}
      <input
        type="hidden"
        data-testid="current-card-id"
        value={shell.hiddenState.currentCardId ?? ""}
      />
      <input
        type="hidden"
        data-testid="last-manual-checkpoint"
        value={shell.hiddenState.lastManualCheckpointLabel ?? ""}
      />
    </div>
  );
}
