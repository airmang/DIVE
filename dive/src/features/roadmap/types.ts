import type { CardTileData } from "../../components/workmap/types";
import type { CardTransitionKind, VerifyLogView } from "../../components/workmap/CardDetailPanel";
import type { ChangedFile } from "../../components/slide-in/types";
import type { NewCardDraft } from "../../components/workmap/NewCardDialog";

export type RoadmapStepStatus =
  | "planned"
  | "ready"
  | "working"
  | "checking"
  | "done"
  | "needs_changes"
  | "integrated";

export type RoadmapStepAction =
  | "prepare"
  | "request_check"
  | "approve"
  | "request_changes"
  | "reopen"
  | "integrate";

export interface RoadmapStepProgress {
  ratio: number;
  completedUnits: number;
  totalUnits: number;
}

export interface RoadmapStep {
  id: number;
  position: number;
  title: string;
  description: string | null;
  assistSummary: string | null;
  acceptanceCriteria: string | null;
  retrospective: string | null;
  changeSummary: string | null;
  testCommand: string | null;
  status: RoadmapStepStatus;
  progress: RoadmapStepProgress;
  isActive: boolean;
  isComplete: boolean;
  hasChanges: boolean;
}

export interface RoadmapProgress {
  total: number;
  completed: number;
  integrated: number;
  percent: number;
}

export type RoadmapStepCreateDraft = NewCardDraft;

export interface RoadmapModel {
  steps: RoadmapStep[];
  activeStepId: number | null;
  activeStep: RoadmapStep | null;
  progress: RoadmapProgress;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectStep: (stepId: number | null) => Promise<void>;
  createStep: (
    title: string,
    position?: number | null,
    metadata?: {
      summary?: string | null;
      acceptanceCriteria?: string | null;
      instructionSeed?: string | null;
    },
  ) => Promise<{ id: number }>;
  updateStepInstruction: (stepId: number, instruction: string) => Promise<void>;
  updateStepTestCommand: (stepId: number, testCommand: string) => Promise<void>;
  saveStepRetrospective: (stepId: number, retrospective: string) => Promise<void>;
  transitionStep: (
    stepId: number,
    action: RoadmapStepAction,
    options?: { approveForce?: boolean },
  ) => Promise<void>;
  verifyStep: (stepId: number) => Promise<void>;
  deleteStep: (stepId: number) => Promise<void>;
  reorderSteps: (orderedIds: number[]) => Promise<void>;
  verifyLogForStep: (stepId: number) => VerifyLogView | null;
  changedFilesForStep: (stepId: number) => ChangedFile[];
  toolCallCountForStep: (stepId: number) => number;
  verifyStateForStep: (stepId: number) => "idle" | "running" | "error";
  verifyErrorForStep: (stepId: number) => string | null;
  workmapCompat: {
    cards: CardTileData[];
    transitionForAction: (action: RoadmapStepAction) => CardTransitionKind;
  };
}
