import type { PlanRoadmapStep, StepSessionMappingRow } from "../../features/roadmap";
import type { WorkspacePlanStatus } from "../../features/planning";

export type PlanLineToken = "none" | "done" | "active" | "future";

export interface PlanSummary {
  total: number;
  completed: number;
  ready: number;
  blocked: number;
  active: number;
  percent: number;
  overall: "in_progress" | "done" | "halted";
}

export interface PlanViewRoadmapModel {
  status: WorkspacePlanStatus | null;
  steps: PlanRoadmapStep[];
  loading: boolean;
  error: string | null;
  hasPlan: boolean;
  refresh: () => Promise<void>;
}

export interface PlanActionHandlers {
  onOpenStep: (
    stepId: number,
    opts?: { focus?: boolean; openDetail?: boolean },
  ) => Promise<StepSessionMappingRow>;
  onOpenSession: (sessionId: number) => void;
  onCreatePlan?: () => void;
  onReviewPlan?: () => void;
}

export interface PlanStepRenderState {
  currentStepId: number | null;
  busyStepId: number | null;
  lineUp: PlanLineToken;
  lineDown: PlanLineToken;
}

export interface PlanTimelineEntry {
  key: string;
  type: "step" | "parallel";
  steps: PlanRoadmapStep[];
  bucket?: string;
}
