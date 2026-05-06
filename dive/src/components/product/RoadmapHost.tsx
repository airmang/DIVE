import { RoadmapPanel } from "./RoadmapPanel";
import type { ProductShellController } from "./useProductShellController";

interface RoadmapHostProps {
  roadmap: ProductShellController["roadmap"];
}

export function RoadmapHost({ roadmap }: RoadmapHostProps) {
  if (!roadmap.visible) {
    return <div data-testid="roadmap-host-hidden" aria-hidden hidden />;
  }
  const { visible: _visible, ...panelProps } = roadmap;
  return <RoadmapPanel className="h-full min-h-0" {...panelProps} />;
}
