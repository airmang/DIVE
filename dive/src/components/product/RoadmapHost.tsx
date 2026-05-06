import { RoadmapPanel } from "./RoadmapPanel";
import type { ProductShellController } from "./useProductShellController";

interface RoadmapHostProps {
  roadmap: ProductShellController["roadmap"];
}

export function RoadmapHost({ roadmap }: RoadmapHostProps) {
  return <RoadmapPanel className="row-start-1 col-start-3 min-h-0" {...roadmap} />;
}
