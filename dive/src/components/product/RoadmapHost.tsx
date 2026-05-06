import { WorkmapStrip } from "../shell/WorkmapStrip";
import type { ProductShellController } from "./useProductShellController";

interface RoadmapHostProps {
  roadmap: ProductShellController["roadmap"];
}

export function RoadmapHost({ roadmap }: RoadmapHostProps) {
  return (
    <div
      className="contents"
      data-roadmap-active-step-id={roadmap.activeStepId ?? ""}
      data-roadmap-progress={roadmap.progress.percent}
      data-roadmap-step-count={roadmap.steps.length}
    >
      <WorkmapStrip
        className="row-start-2 col-span-2"
        collapsed={roadmap.collapsed}
        onToggle={roadmap.onToggle}
        cards={roadmap.legacyCards}
        canAddCard={roadmap.canAddStep}
        onAddCard={roadmap.onAddStep}
        onCardClick={(card) => roadmap.selectStep(card.id)}
        onRequestAiAssist={roadmap.onRequestAiAssist}
      />
    </div>
  );
}
