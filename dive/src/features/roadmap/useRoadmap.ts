import { useMemo } from "react";
import { useWorkmap } from "../../hooks/useWorkmap";
import type { CardTileData, VerifyLogView } from "../../components/workmap/types";
import type { ChangedFile } from "../../components/slide-in/types";
import type { CardTransitionKind } from "../../stores/workmap";
import { deriveAgencyStateView } from "./agencyStatus";
import { cardStateToRoadmapStatus } from "./statusMapping";
import type {
  RoadmapModel,
  RoadmapProgress,
  RoadmapStep,
  RoadmapStepAction,
  RoadmapStepProgress,
  RoadmapStepStatus,
} from "./types";

const STATUS_PROGRESS: Record<RoadmapStepStatus, RoadmapStepProgress> = {
  planned: { ratio: 0, completedUnits: 0, totalUnits: 4 },
  in_progress: { ratio: 0.25, completedUnits: 1, totalUnits: 4 },
  review: { ratio: 0.5, completedUnits: 2, totalUnits: 4 },
  done: { ratio: 1, completedUnits: 4, totalUnits: 4 },
  shipped: { ratio: 1, completedUnits: 4, totalUnits: 4 },
};

export function transitionForRoadmapAction(action: RoadmapStepAction): CardTransitionKind {
  switch (action) {
    case "approve":
      return "approve";
    case "request_changes":
      return "reject";
    case "reopen":
      return "reopen_from_reject";
  }
}

function toRoadmapStep(
  card: CardTileData,
  activeStepId: number | null,
  verifyLog: VerifyLogView | null,
  changedFiles: ChangedFile[],
): RoadmapStep {
  const isActive = activeStepId === card.id;
  const status = cardStateToRoadmapStatus(card.state);
  const progress = STATUS_PROGRESS[status];
  return {
    id: card.id,
    position: card.position,
    title: card.title,
    description: card.summary,
    assistSummary: card.assistSummary ?? null,
    acceptanceCriteria: card.acceptanceCriteria ?? null,
    linkedCriteria: [],
    decompositionRationale: null,
    retrospective: card.retrospective ?? null,
    changeSummary: card.changeSummary ?? null,
    testCommand: card.testCommand ?? null,
    approvalProvenance: card.approvalProvenance ?? null,
    agency: deriveAgencyStateView({
      goalText: [card.title, card.summary].filter(Boolean).join("\n"),
      acceptanceCriteria: card.acceptanceCriteria,
      status,
      changedFiles,
      diffViewed: false,
      verifyLog,
      approvalProvenance: card.approvalProvenance ?? null,
    }),
    status,
    wasRejected: card.state === "rejected",
    progress,
    isActive,
    isComplete: status === "done" || status === "shipped",
    hasChanges: Boolean(card.changeSummary),
  };
}

function calculateProgress(steps: RoadmapStep[]): RoadmapProgress {
  const total = steps.length;
  const completed = steps.filter(
    (step) => step.status === "done" || step.status === "shipped",
  ).length;
  const integrated = steps.filter((step) => step.status === "shipped").length;
  const percent =
    total > 0
      ? Math.round((steps.reduce((sum, step) => sum + step.progress.ratio, 0) / total) * 100)
      : 0;
  return { total, completed, integrated, percent };
}

export function useRoadmap(sessionId: number | null): RoadmapModel {
  const workmap = useWorkmap(sessionId);

  const steps = useMemo(
    () =>
      workmap.cards.map((card) =>
        toRoadmapStep(
          card,
          workmap.currentCardId,
          workmap.verifyLogFor(card.id),
          workmap.changedFilesFor(card.id),
        ),
      ),
    [workmap],
  );
  const activeStep = useMemo(
    () => steps.find((step) => step.id === workmap.currentCardId) ?? null,
    [steps, workmap.currentCardId],
  );
  const progress = useMemo(() => calculateProgress(steps), [steps]);

  return {
    steps,
    activeStepId: workmap.currentCardId,
    activeStep,
    progress,
    loading: workmap.loading,
    error: workmap.error,
    refresh: workmap.refresh,
    selectStep: workmap.setCurrentCardRemote,
    createStep: workmap.createCard,
    updateStepInstruction: workmap.updateInstructionRemote,
    updateStepTestCommand: workmap.updateTestCommandRemote,
    saveStepRetrospective: workmap.saveRetrospectiveRemote,
    transitionStep: (stepId, action, options) =>
      workmap.transitionCardRemote(stepId, transitionForRoadmapAction(action), options),
    verifyStep: workmap.verifyRemote,
    deleteStep: workmap.deleteCard,
    reorderSteps: workmap.reorderCards,
    verifyLogForStep: workmap.verifyLogFor,
    changedFilesForStep: workmap.changedFilesFor,
    toolCallCountForStep: workmap.toolCallCountFor,
    verifyStateForStep: workmap.verifyStateFor,
    verifyErrorForStep: workmap.verifyErrorFor,
    workmapCompat: {
      cards: workmap.cards,
      transitionForAction: transitionForRoadmapAction,
    },
  };
}
