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
  const [lastManualCheckpointLabel, setLastManualCheckpointLabel] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointRowPayload[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<number | null>(null);

  const refreshCheckpoints = useCallback(async () => {
    if (input.currentSessionId === null) {
      setCheckpoints([]);
      setCheckpointsError(null);
      return;
    }
    setCheckpointsLoading(true);
    try {
      const rows = await input.chat.listCheckpoints();
      setCheckpoints(rows);
      setCheckpointsError(null);
    } catch (err) {
      setCheckpointsError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckpointsLoading(false);
    }
  }, [input.chat, input.currentSessionId]);

  useEffect(() => {
    void refreshCheckpoints();
  }, [refreshCheckpoints]);

  const recoveryCheckpoints = useMemo(
    () => checkpoints.map(checkpointToRecoveryItem),
    [checkpoints],
  );

  const handleManualCheckpoint = useCallback(() => {
    const label = input.currentCard
      ? input.t("checkpoint.manual_label_with_card", { title: input.currentCard.title })
      : input.t("checkpoint.manual_label");
    void (async () => {
      try {
        const row = await input.chat.createCheckpoint(input.currentCard?.id ?? null, label);
        const savedLabel = row?.label ?? label;
        setLastManualCheckpointLabel(savedLabel);
        void refreshCheckpoints();
        input.toast({
          variant: "success",
          title: input.t("checkpoint.manual_saved"),
          description: savedLabel,
        });
      } catch (err) {
        input.toast({
          variant: "error",
          title: input.t("toast.checkpoint_save_failed"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [input, refreshCheckpoints]);

  const handleRestoreCheckpoint = useCallback(
    async (checkpointId: number) => {
      setRestoringCheckpointId(checkpointId);
      try {
        await input.chat.restoreCheckpoint(checkpointId);
        input.toast({
          variant: "success",
          title: input.t("recovery.restore_success_title"),
          description: input.t("recovery.restore_success_description"),
        });
        await input.onRefreshRoadmap();
        await refreshCheckpoints();
      } catch (err) {
        input.toast({
          variant: "error",
          title: input.t("recovery.restore_unavailable_title"),
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setRestoringCheckpointId(null);
      }
    },
    [input, refreshCheckpoints],
  );

  const handleExplainRecovery = useCallback(
    (reason: string) => {
      const stepTitle = input.currentCard?.title ?? input.t("roadmap.current_step_fallback");
      void input.chat.sendUserMessage(
        input.t("recovery.explain_failure_prompt", { title: stepTitle, reason }),
        undefined,
        input.planAccepted || input.activePlanStepIdForChat !== undefined,
        input.activePlanStepIdForChat,
      );
    },
    [input],
  );

  const handleRetryRecovery = useCallback(() => {
    if (input.currentCard && (input.currentVerifyLog || input.currentVerifyState === "error")) {
      input.onVerifyCurrentStep();
      return;
    }
    input.onRetryError();
  }, [input]);

  const handleAdjustPlanRecovery = useCallback(
    (reason: string) => {
      const stepTitle = input.currentCard?.title ?? input.t("roadmap.current_step_fallback");
      input.onOpenPlanInterview(
        input.t("planning.interview.adjust_failure_seed", { title: stepTitle, reason }),
      );
    },
    [input],
  );

  const failureReason = deriveFailureReason({
    currentVerifyError: input.currentVerifyError,
    currentVerifyLog: input.currentVerifyLog,
    currentCardState: input.currentCard?.state,
    latestToolFailureSummary: latestToolFailureSummary(input.chat.messages),
    rejectedReason: input.t("recovery.rejected_reason"),
    verifyDidNotPassFallback: (result) => input.t("recovery.verify_did_not_pass", { result }),
  });
  const failedStepRecovery: FailedStepRecovery | null =
    input.currentCard && failureReason
      ? {
          stepTitle: input.currentCard.title,
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
