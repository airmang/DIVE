import { useCallback } from "react";
import type { ProvocationAction, ProvocationCard, SupervisorFeasibility } from "./types";
import { useT } from "../../i18n";

type Seed = (text: string) => void;

export interface ProvocationActionResolverOptions {
  pushComposerSeed?: Seed;
  onGoToChat?: () => void;
  onOpenDiff?: () => void;
  onOpenPreview?: () => void;
  onRunApp?: () => void;
  onRunTests?: () => void;
  onOpenRecovery?: () => void;
  onAddAcceptanceCriteria?: () => void;
  onAddVerificationStep?: () => void;
  onSplitScope?: () => void;
  onAskAiForRationale?: () => void;
  onCreateReproSteps?: () => void;
  onRetryWithAi?: () => void;
  onContinueWithRisk?: (reason: string | undefined, card: ProvocationCard) => void;
  onStatus?: (message: string) => void;
  feasibility?: SupervisorFeasibility;
}

function seedAndGo(seed: Seed | undefined, go: (() => void) | undefined, text: string) {
  seed?.(text);
  go?.();
}

function isSupervisorBackedCard(card: ProvocationCard): boolean {
  return typeof card.metadata?.supervisorEvaluationId === "string";
}

export function useProvocationActionResolver({
  pushComposerSeed,
  onGoToChat,
  onOpenDiff,
  onOpenPreview,
  onRunApp,
  onRunTests,
  onOpenRecovery,
  onAddAcceptanceCriteria,
  onAddVerificationStep,
  onSplitScope,
  onAskAiForRationale,
  onCreateReproSteps,
  onRetryWithAi,
  onContinueWithRisk,
  onStatus,
  feasibility,
}: ProvocationActionResolverOptions) {
  const t = useT();
  const feasible = feasibility ?? {
    runnable: true,
    previewable: true,
    hasTests: true,
    diffAvailable: true,
  };
  return useCallback(
    (action: ProvocationAction, card: ProvocationCard, reason?: string) => {
      switch (action.kind) {
        case "add_acceptance_criteria":
          if (onAddAcceptanceCriteria) onAddAcceptanceCriteria();
          else seedAndGo(pushComposerSeed, onGoToChat, t("provocation_action.seed_add_criteria"));
          onStatus?.(t("provocation_action.status_add_criteria"));
          return;
        case "link_criterion":
          if (onAddAcceptanceCriteria) onAddAcceptanceCriteria();
          onStatus?.(t("provocation_action.status_link_criterion"));
          return;
        case "edit_prd":
          onStatus?.(t("provocation_action.status_edit_prd"));
          return;
        case "add_verification_step":
          if (onAddVerificationStep) onAddVerificationStep();
          else
            seedAndGo(pushComposerSeed, onGoToChat, t("provocation_action.seed_add_verification"));
          onStatus?.(t("provocation_action.status_add_verification"));
          return;
        case "split_scope":
          if (onSplitScope) onSplitScope();
          else seedAndGo(pushComposerSeed, onGoToChat, t("provocation_action.seed_split_scope"));
          onStatus?.(t("provocation_action.status_split_scope"));
          return;
        case "open_diff":
          if (!feasible.diffAvailable) {
            onStatus?.(t("provocation_action.status_diff_unavailable"));
            return;
          }
          onOpenDiff?.();
          return;
        case "open_preview":
          if (!feasible.previewable || !onOpenPreview) {
            onStatus?.(t("provocation_action.status_preview_unavailable"));
            return;
          }
          onOpenPreview?.();
          return;
        case "run_app":
          if (!feasible.runnable || !onRunApp) {
            onStatus?.(t("provocation_action.status_app_unavailable"));
            return;
          }
          onRunApp();
          return;
        case "run_tests":
          if (!feasible.hasTests || !onRunTests) {
            onStatus?.(t("provocation_action.status_tests_unavailable"));
            return;
          }
          if (onRunTests) onRunTests();
          onStatus?.(t("provocation_action.status_tests_started"));
          return;
        case "rollback_last_change":
        case "revert_unrelated_changes":
          onOpenRecovery?.();
          return;
        case "ask_ai_for_rationale":
          if (onAskAiForRationale) onAskAiForRationale();
          else seedAndGo(pushComposerSeed, onGoToChat, t("provocation_action.seed_ask_rationale"));
          onStatus?.(t("provocation_action.status_ask_rationale"));
          return;
        case "create_repro_steps":
          if (onCreateReproSteps) onCreateReproSteps();
          else seedAndGo(pushComposerSeed, onGoToChat, t("provocation_action.seed_create_repro"));
          onStatus?.(t("provocation_action.status_create_repro"));
          return;
        case "retry_with_ai":
          if (onRetryWithAi) onRetryWithAi();
          else seedAndGo(pushComposerSeed, onGoToChat, t("provocation_action.seed_retry"));
          onStatus?.(t("provocation_action.status_retry"));
          return;
        case "continue_with_risk":
          if (isSupervisorBackedCard(card)) {
            onStatus?.(t("provocation_action.status_continue_risk_blocked"));
            return;
          }
          onContinueWithRisk?.(reason, card);
          return;
        case "dismiss":
        case "dismiss_review":
        case "mark_irrelevant":
          return;
      }
    },
    [
      t,
      onAddAcceptanceCriteria,
      onAddVerificationStep,
      onAskAiForRationale,
      onContinueWithRisk,
      onCreateReproSteps,
      feasible.diffAvailable,
      feasible.hasTests,
      feasible.previewable,
      feasible.runnable,
      onGoToChat,
      onOpenDiff,
      onOpenPreview,
      onOpenRecovery,
      onRetryWithAi,
      onRunApp,
      onRunTests,
      onSplitScope,
      onStatus,
      pushComposerSeed,
    ],
  );
}
