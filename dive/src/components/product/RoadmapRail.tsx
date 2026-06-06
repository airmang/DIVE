import type { StepSessionMappingRow, usePlanRoadmap } from "../../features/roadmap";
import { PlanView } from "../plan";
import { RoadmapPanel } from "./RoadmapPanel";
import type { ProductShellController } from "./useProductShellController";

type PlanRoadmapModel = ReturnType<typeof usePlanRoadmap>;

interface RoadmapRailProps {
  projectName: string | null;
  planRoadmap: PlanRoadmapModel;
  fallbackRoadmap: ProductShellController["roadmap"];
  onOpenPlanStep: (stepId: number, opts?: { focus?: boolean }) => Promise<StepSessionMappingRow>;
  onOpenSession: (sessionId: number) => void;
  onCreatePlan: () => void;
}

export function RoadmapRail({
  projectName,
  planRoadmap,
  fallbackRoadmap,
  onOpenPlanStep,
  onOpenSession,
  onCreatePlan,
}: RoadmapRailProps) {
  if (!planRoadmap.hasPlan && fallbackRoadmap.visible) {
    const {
      visible: _visible,
      showEmpty: _showEmpty,
      onCreatePlan: _onCreatePlan,
      ...panelProps
    } = fallbackRoadmap;
    return <RoadmapPanel className="h-full min-h-0 border-l-0" {...panelProps} />;
  }

  return (
    <PlanView
      roadmap={planRoadmap}
      projectName={projectName}
      actions={{
        onOpenStep: onOpenPlanStep,
        onOpenSession,
        onCreatePlan,
      }}
    />
  );
}
