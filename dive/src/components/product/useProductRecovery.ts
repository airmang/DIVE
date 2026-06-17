import { useCallback, useEffect, useMemo, useState } from "react";
import type { ToastContextValue } from "../toast/toast-context";
import type { ChatMessage } from "../chat/types";
import type { VerifyLogView, CardTileData } from "../workmap/types";
import type { CheckpointRowPayload } from "../../hooks/useChatSession";
import type { FailedStepRecovery } from "./RecoveryPanel";
import {
  checkpointToRecoveryItem,
  compactFailureReason,
  deriveFailureReason,
  latestToolFailureSummary,
} from "./productShellRecoveryLogic";

type Translate = (key: string, values?: Record<string, string | number>) => string;

interface ProductRecoveryChat {
  messages: ChatMessage[];
  listCheckpoints: () => Promise<CheckpointRowPayload[]>;
  createCheckpoint: (cardId: number | null, label: string) => Promise<CheckpointRowPayload | null>;
  restoreCheckpoint: (checkpointId: number) => Promise<void>;
  sendUserMessage: (
    text: string,
    runMode?: "interview" | "plan" | "build" | "verify",
    planAccepted?: boolean,
    stepId?: number,
  ) => Promise<void>;
}

export function useProductRecovery(input: {
  chat: ProductRecoveryChat;
  currentSessionId: number | null;
  currentCard: Pick<CardTileData, "id" | "title" | "state"> | null;
  currentVerifyLog: VerifyLogView | null;
  currentVerifyState: "idle" | "running" | "error";
  currentVerifyError: string | null;
  planAccepted: boolean;
  activePlanStepIdForChat: number | undefined;
  onRefreshRoadmap: () => Promise<unknown>;
  onVerifyCurrentStep: () => void;
  onRetryError: () => void;
  onOpenPlanInterview: (goal?: string) => void;
  toast: ToastContextValue["toast"];
  t: Translate;
}) {
  const {
    chat,
    currentSessionId,
    currentCard,
    currentVerifyLog,
    currentVerifyState,
    currentVerifyError,
    planAccepted,
    activePlanStepIdForChat,
    onRefreshRoadmap,
    onVerifyCurrentStep,
    onRetryError,
    onOpenPlanInterview,
    toast,
    t,
  } = input;
  const { messages, listCheckpoints, createCheckpoint, restoreCheckpoint, sendUserMessage } = chat;
  const [lastManualCheckpointLabel, setLastManualCheckpointLabel] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointRowPayload[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<number | null>(null);

  const refreshCheckpoints = useCallback(async () => {
    if (currentSessionId === null) {
      setCheckpoints((current) => (current.length === 0 ? current : []));
      setCheckpointsError((current) => (current === null ? current : null));
      return;
    }
    setCheckpointsLoading(true);
    try {
      const rows = await listCheckpoints();
      setCheckpoints(rows);
      setCheckpointsError(null);
    } catch (err) {
      setCheckpointsError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointsLoading(false);
    }
  }, [currentSessionId, listCheckpoints]);

  useEffect(() => {
    void refreshCheckpoints();
  }, [refreshCheckpoints]);

  const recoveryCheckpoints = useMemo(
    () => checkpoints.map(checkpointToRecoveryItem),
    [checkpoints],
  );

  const handleManualCheckpoint = useCallback(() => {
    const label = currentCard
      ? t("checkpoint.manual_label_with_card", { title: currentCard.title })
      : t("checkpoint.manual_label");
    void (async () => {
      try {
        const row = await createCheckpoint(currentCard?.id ?? null, label);
        const savedLabel = row?.label ?? label;
        setLastManualCheckpointLabel(savedLabel);
        void refreshCheckpoints();
        toast({
          variant: "success",
          title: t("checkpoint.manual_saved"),
          description: savedLabel,
        });
      } catch (err) {
        toast({
          variant: "error",
          title: t("toast.checkpoint_save_failed"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [createCheckpoint, currentCard, refreshCheckpoints, t, toast]);

  const handleRestoreCheckpoint = useCallback(
    async (checkpointId: number) => {
      setRestoringCheckpointId(checkpointId);
      try {
        await restoreCheckpoint(checkpointId);
        toast({
          variant: "success",
          title: t("recovery.restore_success_title"),
          description: t("recovery.restore_success_description"),
        });
        await onRefreshRoadmap();
        await refreshCheckpoints();
      } catch (err) {
        toast({
          variant: "error",
          title: t("recovery.restore_unavailable_title"),
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRestoringCheckpointId(null);
      }
    },
    [onRefreshRoadmap, refreshCheckpoints, restoreCheckpoint, t, toast],
  );

  const handleExplainRecovery = useCallback(
    (reason: string) => {
      const stepTitle = currentCard?.title ?? t("roadmap.current_step_fallback");
      void sendUserMessage(
        t("recovery.explain_failure_prompt", { title: stepTitle, reason }),
        undefined,
        planAccepted || activePlanStepIdForChat !== undefined,
        activePlanStepIdForChat,
      );
    },
    [activePlanStepIdForChat, currentCard?.title, planAccepted, sendUserMessage, t],
  );

  const handleRetryRecovery = useCallback(() => {
    if (currentCard && (currentVerifyLog || currentVerifyState === "error")) {
      onVerifyCurrentStep();
      return;
    }
    onRetryError();
  }, [currentCard, currentVerifyLog, currentVerifyState, onRetryError, onVerifyCurrentStep]);

  const handleAdjustPlanRecovery = useCallback(
    (reason: string) => {
      const stepTitle = currentCard?.title ?? t("roadmap.current_step_fallback");
      onOpenPlanInterview(
        t("planning.interview.adjust_failure_seed", { title: stepTitle, reason }),
      );
    },
    [currentCard?.title, onOpenPlanInterview, t],
  );

  const failureReason = deriveFailureReason({
    currentVerifyError,
    currentVerifyLog,
    currentCardState: currentCard?.state,
    latestToolFailureSummary: latestToolFailureSummary(messages),
    rejectedReason: t("recovery.rejected_reason"),
    verifyDidNotPassFallback: (result) => t("recovery.verify_did_not_pass", { result }),
  });
  const failedStepRecovery: FailedStepRecovery | null =
    currentCard && failureReason
      ? {
          stepTitle: currentCard.title,
          reason: compactFailureReason(failureReason),
          onExplainError: () => handleExplainRecovery(failureReason),
          onRetry: handleRetryRecovery,
          onAdjustPlan: () => handleAdjustPlanRecovery(failureReason),
        }
      : null;

  return {
    lastManualCheckpointLabel,
    recoveryCheckpoints,
    checkpointsLoading,
    checkpointsError,
    restoringCheckpointId,
    failedStepRecovery,
    refreshCheckpoints,
    handleManualCheckpoint,
    handleRestoreCheckpoint,
  };
}
