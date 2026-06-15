import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanRoadmapStep, StepSessionMappingRow } from "../../features/roadmap";
import type { CardTileData } from "../workmap/types";
import {
  buildPlanStepExecutionPrompt,
  deriveActivePlanStepIdForChat,
  pruneCaughtUpPlanStepSessionMap,
} from "./productShellPlanStepLogic";

interface PlanStepRuntimeChat {
  isStreaming: boolean;
  isTauri: boolean;
  sendUserMessage: (
    text: string,
    runMode?: "interview" | "plan" | "build" | "verify",
    planAccepted?: boolean,
    stepId?: number,
  ) => Promise<void>;
}

interface RememberPlanStepMappingOptions {
  autoRun?: boolean;
}

export function useProductPlanStepRuntime(input: {
  currentSessionId: number | null;
  currentCard: Pick<CardTileData, "id"> | null;
  planRoadmapSteps: PlanRoadmapStep[];
  chat: PlanStepRuntimeChat;
}) {
  const [justOpenedPlanStepBySession, setJustOpenedPlanStepBySession] = useState<
    Record<number, number>
  >({});
  const [pendingAutoRunPlanStepBySession, setPendingAutoRunPlanStepBySession] = useState<
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
      setPendingAutoRunPlanStepBySession((current) => {
        if (options.autoRun ?? true) {
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

  useEffect(() => {
    if (input.currentSessionId === null || input.chat.isStreaming || !input.chat.isTauri) return;
    const stepId = pendingAutoRunPlanStepBySession[input.currentSessionId];
    if (stepId === undefined) return;
    const item = input.planRoadmapSteps.find((candidate) => candidate.step.id === stepId);
    if (!item) return;
    setPendingAutoRunPlanStepBySession((current) => {
      const next = { ...current };
      delete next[input.currentSessionId as number];
      return next;
    });
    void input.chat.sendUserMessage(
      buildPlanStepExecutionPrompt(item),
      "build",
      true,
      item.step.id,
    );
  }, [input.chat, input.currentSessionId, input.planRoadmapSteps, pendingAutoRunPlanStepBySession]);

  return {
    activePlanStepIdForChat,
    rememberJustOpenedPlanStepMapping,
  };
}
