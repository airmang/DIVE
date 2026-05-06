import { useMemo } from "react";
import { useWorkmap } from "../../hooks/useWorkmap";
import type { CardState, CardTileData } from "../../components/workmap/types";
import type { CardTransitionKind } from "../../components/workmap/CardDetailPanel";
import type {
  RoadmapModel,
  RoadmapProgress,
  RoadmapStep,
  RoadmapStepAction,
  RoadmapStepProgress,
  RoadmapStepStatus,
} from "./types";

const STATUS_PROGRESS: Record<RoadmapStepStatus, RoadmapStepProgress> = {
  planned: { ratio: 0.25, completedUnits: 1, totalUnits: 4 },
  ready: { ratio: 0.5, completedUnits: 2, totalUnits: 4 },
  working: { ratio: 0.5, completedUnits: 2, totalUnits: 4 },
  checking: { ratio: 0.5, completedUnits: 2, totalUnits: 4 },
  needs_changes: { ratio: 0.5, completedUnits: 2, totalUnits: 4 },
  done: { ratio: 0.75, completedUnits: 3, totalUnits: 4 },
  integrated: { ratio: 1, completedUnits: 4, totalUnits: 4 },
};

export function mapCardStateToRoadmapStatus(
  state: CardState,
  options: { isActive?: boolean } = {},
): RoadmapStepStatus {
  switch (state) {
    case "decomposed":
      return "planned";
    case "instructed":
      return options.isActive ? "working" : "ready";
    case "verifying":
      return "checking";
    case "verified":
      return "done";
    case "rejected":
      return "needs_changes";
    case "extended":
      return "integrated";
  }
}

export function transitionForRoadmapAction(action: RoadmapStepAction): CardTransitionKind {
  switch (action) {
    case "prepare":
      return "enter_instruct";
    case "request_check":
      return "request_verify";
    case "approve":
      return "approve";
    case "request_changes":
      return "reject";
    case "reopen":
      return "reopen_from_reject";
    case "integrate":
      return "extend";
  }
}

function toRoadmapStep(card: CardTileData, activeStepId: number | null): RoadmapStep {
  const isActive = activeStepId === card.id;
  const status = mapCardStateToRoadmapStatus(card.state, { isActive });
  const progress = STATUS_PROGRESS[status];
  return {
    id: card.id,
    position: card.position,
    title: card.title,
    description: card.summary,
    assistSummary: card.assistSummary ?? null,
    acceptanceCriteria: card.acceptanceCriteria ?? null,
    retrospective: card.retrospective ?? null,
    changeSummary: card.changeSummary ?? null,
    testCommand: card.testCommand ?? null,
    status,
    progress,
    isActive,
    isComplete: status === "done" || status === "integrated",
    hasChanges: Boolean(card.changeSummary),
  };
}

function calculateProgress(steps: RoadmapStep[]): RoadmapProgress {
  const total = steps.length;
  const completed = steps.filter(
    (step) => step.status === "done" || step.status === "integrated",
  ).length;
  const integrated = steps.filter((step) => step.status === "integrated").length;
  const percent =
    total > 0
      ? Math.round((steps.reduce((sum, step) => sum + step.progress.ratio, 0) / total) * 100)
      : 0;
  return { total, completed, integrated, percent };
}

export function useRoadmap(sessionId: number | null): RoadmapModel {
  const workmap = useWorkmap(sessionId);

  const steps = useMemo(
    () => workmap.cards.map((card) => toRoadmapStep(card, workmap.currentCardId)),
    [workmap.cards, workmap.currentCardId],
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
