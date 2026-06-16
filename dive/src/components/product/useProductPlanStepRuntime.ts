import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanRoadmapStep, StepSessionMappingRow } from "../../features/roadmap";
import type { CardTileData } from "../workmap/types";
import {
  buildPlanStepExecutionPrompt,
  deriveActivePlanStepIdForChat,
  pruneCaughtUpPlanStepSessionMap,
} from "./productShellPlanStepLogic";

interface RememberPlanStepMappingOptions {
  suggestPrompt?: boolean;
}

export interface PendingPlanStepPrompt {
  stepId: number;
  prompt: string;
}

export function useProductPlanStepRuntime(input: {
  currentSessionId: number | null;
  currentCard: Pick<CardTileData, "id"> | null;
  planRoadmapSteps: PlanRoadmapStep[];
}) {
  const [justOpenedPlanStepBySession, setJustOpenedPlanStepBySession] = useState<
    Record<number, number>
  >({});
  const [pendingPromptPlanStepBySession, setPendingPromptPlanStepBySession] = useState<
    Record<number, number>
  >({});

  const rememberJustOpenedPlanStepMapping = useCallback(
    (mapping: StepSessionMappingRow, options: RememberPlanStepMappingOptions = {}) => {
      const sessionId = mapping.session_id;
      if (sessionId === null) return;
      setJustOpenedPlanStepBySession((current) => ({
        ...current,
        [sessionId]: mapping.step_id,
      }));
      setPendingPromptPlanStepBySession((current) => {
        if (options.suggestPrompt ?? true) {
          return {
            ...current,
            [sessionId]: mapping.step_id,
          };
        }
        if (!(sessionId in current)) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    },
    [],
  );

  const activePlanStepIdForChat = useMemo(
    () =>
      deriveActivePlanStepIdForChat({
        currentSessionId: input.currentSessionId,
        justOpenedPlanStepBySession,
        currentCard: input.currentCard,
        planRoadmapSteps: input.planRoadmapSteps,
      }),
    [
      input.currentCard,
      input.currentSessionId,
      input.planRoadmapSteps,
      justOpenedPlanStepBySession,
    ],
  );

  useEffect(() => {
    setJustOpenedPlanStepBySession((current) =>
      pruneCaughtUpPlanStepSessionMap(current, input.planRoadmapSteps),
    );
  }, [input.planRoadmapSteps]);

  const pendingPlanStepPrompt = useMemo<PendingPlanStepPrompt | null>(() => {
    if (input.currentSessionId === null) return null;
    const stepId = pendingPromptPlanStepBySession[input.currentSessionId];
    if (stepId === undefined) return null;
    const item = input.planRoadmapSteps.find((candidate) => candidate.step.id === stepId);
    if (!item) return null;
    return {
      stepId,
      prompt: buildPlanStepExecutionPrompt(item),
    };
  }, [input.currentSessionId, input.planRoadmapSteps, pendingPromptPlanStepBySession]);

  const clearPendingPlanStepPrompt = useCallback(() => {
    const sessionId = input.currentSessionId;
    if (sessionId === null) return;
    setPendingPromptPlanStepBySession((current) => {
      if (!(sessionId in current)) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, [input.currentSessionId]);

  return {
    activePlanStepIdForChat,
    pendingPlanStepPrompt,
    clearPendingPlanStepPrompt,
    rememberJustOpenedPlanStepMapping,
  };
}
