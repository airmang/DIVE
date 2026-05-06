import type { ProductShellController } from "./useProductShellController";
import { ActionDock } from "./ActionDock";
import { ConversationPanel } from "./ConversationPanel";
import { ProductModalHost } from "./ProductModalHost";
import { ProjectRail } from "./ProjectRail";
import { RoadmapHost } from "./RoadmapHost";
import { TopBar } from "./TopBar";
import { RecoverySlideIn } from "./RecoverySlideIn";

interface ProductShellLayoutProps {
  shell: ProductShellController;
}

export function ProductShellLayout({ shell }: ProductShellLayoutProps) {
  const gridCols = shell.roadmap.visible
    ? "grid-cols-[280px_minmax(0,1fr)_360px]"
    : "grid-cols-[280px_minmax(0,1fr)]";
  return (
    <div
      className={`relative h-screen w-screen grid ${gridCols} grid-rows-[auto_1fr] overflow-hidden bg-bg text-fg transition-[grid-template-columns] duration-200`}
      data-testid="main-shell"
      data-roadmap-visible={shell.roadmap.visible ? "true" : "false"}
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
        <ConversationPanel
          conversation={shell.conversation}
          planDraftFloating={shell.planDraftFloating}
        />
      </div>
      <div className="row-start-2 col-start-3 min-h-0">
        <RoadmapHost roadmap={shell.roadmap} />
      </div>
      <ActionDock />
      <ProductModalHost modals={shell.modals} />
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
