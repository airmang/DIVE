import { WorkmapStrip } from "../shell/WorkmapStrip";
import type { ProductShellController } from "./useProductShellController";

interface RoadmapHostProps {
  roadmap: ProductShellController["roadmap"];
}

export function RoadmapHost({ roadmap }: RoadmapHostProps) {
  return <WorkmapStrip className="row-start-2 col-span-2" {...roadmap} />;
}
