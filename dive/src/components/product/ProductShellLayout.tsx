import type { ProductShellController } from "./useProductShellController";
import { ActionDock } from "./ActionDock";
import { ConversationPanel } from "./ConversationPanel";
import { ProductModalHost } from "./ProductModalHost";
import { ProjectRail } from "./ProjectRail";
import { RoadmapHost } from "./RoadmapHost";
import { TopBar } from "./TopBar";
import { RecoverySlideIn } from "./RecoverySlideIn";
import { StepDetailSlideIn } from "./StepDetailSlideIn";
import { RoadmapGraph } from "../roadmap/RoadmapGraph";
import { usePlanRoadmap } from "../../features/roadmap";
import { useProjectSessionStore } from "../../stores/project-session";

interface ProductShellLayoutProps {
  shell: ProductShellController;
}

export function ProductShellLayout({ shell }: ProductShellLayoutProps) {
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const selectSession = useProjectSessionStore((s) => s.selectSession);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const planRoadmap = usePlanRoadmap(currentProjectId);
  const rightPanelVisible = shell.roadmap.visible || planRoadmap.hasPlan;
  const gridCols = rightPanelVisible
    ? "grid-cols-[280px_minmax(0,1fr)_360px]"
    : "grid-cols-[280px_minmax(0,1fr)]";
  const handleOpenSession = (sessionId: number) => {
    selectSession(sessionId);
    void loadAll();
  };
  const handleOpenPlanStep = async (stepId: number) => {
    const mapping = await planRoadmap.openStep(stepId);
    if (mapping.session_id !== null) {
      shell.roadmap.onPlanStepOpened(mapping);
      await loadAll();
      selectSession(mapping.session_id);
    }
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
          <RoadmapGraph
            goal={planRoadmap.status?.plan_summary ?? shell.roadmap.goal}
            steps={planRoadmap.steps}
            loading={planRoadmap.loading}
            error={planRoadmap.error}
            onOpenStep={handleOpenPlanStep}
            onOpenSession={handleOpenSession}
          />
          <div className="min-h-0 flex-1">
            <RoadmapHost roadmap={shell.roadmap} />
          </div>
        </div>
      ) : null}
      <ActionDock />
      <ProductModalHost modals={shell.modals} />
      <StepDetailSlideIn {...shell.stepDetail} />
      <RecoverySlideIn
        open={shell.recovery.open}
        onOpenChange={shell.recovery.onOpenChange}
        recovery={shell.recovery.panel}
      />
      <input type="hidden" data-testid="current-stage" value={shell.hiddenState.stage} />
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
