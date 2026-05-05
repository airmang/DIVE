import type { ProductShellController } from "./useProductShellController";
import { ActionDock } from "./ActionDock";
import { ConversationPanel } from "./ConversationPanel";
import { ProductModalHost } from "./ProductModalHost";
import { ProjectRail } from "./ProjectRail";
import { ProviderSetupBanner } from "./ProviderSetupBanner";
import { RoadmapHost } from "./RoadmapHost";

interface ProductShellLayoutProps {
  shell: ProductShellController;
}

export function ProductShellLayout({ shell }: ProductShellLayoutProps) {
  return (
    <div
      className="relative h-screen w-screen grid grid-cols-[280px_1fr] grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg"
      data-testid="main-shell"
    >
      <ProviderSetupBanner {...shell.providerBanner} />
      <ProjectRail />
      <ConversationPanel conversation={shell.conversation} />
      <RoadmapHost roadmap={shell.roadmap} />
      <ActionDock />
      <ProductModalHost modals={shell.modals} />
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
