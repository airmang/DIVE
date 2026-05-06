import type { CardTileData, VerifyLogView } from "../../components/workmap/types";
import type { CardTransitionKind } from "../../stores/workmap";
import type { ChangedFile } from "../../components/slide-in/types";

/**
 * User-facing Roadmap step status (redesign §3.5).
 *
 * Five values only. Internal `CardState` (decomposed/instructed/verifying/...)
 * is an implementation detail and MUST NOT leak into the UI surface.
 *
 *   planned      — not started yet
 *   in_progress  — AI working or awaiting user input
 *   review       — verification results ready; user decides approve/request_changes
 *   done         — verified and approved
 *   shipped      — integrated / final
 */
export type RoadmapStepStatus = "planned" | "in_progress" | "review" | "done" | "shipped";

/**
 * Actions a chat handler can issue against a roadmap step. Kept to the
 * Must-Have set (approve / request_changes / reopen) per redesign §9.1.
 * Deeper transitions (prepare/check/integrate) are orchestrated by the
 * agent runtime, not by explicit user UI, so they are no longer exposed.
 */
export type RoadmapStepAction = "approve" | "request_changes" | "reopen";

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
  /**
   * True when `status === "review"` was reached via a prior rejection
   * (internal `CardState === "rejected"`), as opposed to entering review
   * normally from `verifying`. UI uses this to show a "changes requested"
   * sub-badge without re-exposing the internal card state.
   */
  wasRejected: boolean;
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
