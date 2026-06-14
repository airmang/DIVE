import { useCallback } from "react";
import type { ProvocationAction, ProvocationCard } from "./types";

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
}

function seedAndGo(seed: Seed | undefined, go: (() => void) | undefined, text: string) {
  seed?.(text);
  go?.();
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
}: ProvocationActionResolverOptions) {
  return useCallback(
    (action: ProvocationAction, card: ProvocationCard, reason?: string) => {
      switch (action.kind) {
        case "add_acceptance_criteria":
          if (onAddAcceptanceCriteria) onAddAcceptanceCriteria();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "완료 기준을 2~3개로 구체화해줘. 사용자가 무엇을 보면 끝났다고 판단할 수 있는지 포함해줘.",
            );
          onStatus?.("완료 기준 보강 요청을 준비했습니다.");
          return;
        case "add_verification_step":
          if (onAddVerificationStep) onAddVerificationStep();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "이 단계의 검증 방법을 실행/프리뷰/테스트 중 하나로 구체화해줘.",
            );
          onStatus?.("검증 단계 보강 요청을 준비했습니다.");
          return;
        case "split_scope":
          if (onSplitScope) onSplitScope();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "현재 요청을 첫 번째 기능 하나로 줄여서 다시 요청할 문장을 만들어줘.",
            );
          onStatus?.("범위 축소 요청을 준비했습니다.");
          return;
        case "open_diff":
          onOpenDiff?.();
          return;
        case "open_preview":
          onOpenPreview?.();
          return;
        case "run_app":
          (onRunApp ?? onOpenPreview)?.();
          return;
        case "run_tests":
          if (onRunTests) onRunTests();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "AI 완료 보고를 검증할 수 있는 가장 작은 테스트 또는 확인 명령을 제안해줘.",
            );
          onStatus?.("테스트 확인 흐름을 시작했습니다.");
          return;
        case "rollback_last_change":
        case "revert_unrelated_changes":
          onOpenRecovery?.();
          return;
        case "ask_ai_for_rationale":
          if (onAskAiForRationale) onAskAiForRationale();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "이 변경이 목표와 어떻게 연결되는지 근거를 설명해줘.",
            );
          onStatus?.("AI 근거 요청을 준비했습니다.");
          return;
        case "create_repro_steps":
          if (onCreateReproSteps) onCreateReproSteps();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "반복되는 오류를 기준으로 재현 단계, 가장 작은 확인 명령, 마지막 변경에서 볼 부분을 정리해줘.",
            );
          onStatus?.("재현 단계 정리 요청을 준비했습니다.");
          return;
        case "retry_with_ai":
          if (onRetryWithAi) onRetryWithAi();
          else
            seedAndGo(
              pushComposerSeed,
              onGoToChat,
              "복구 지점, 재현 단계, 범위 축소 여부를 먼저 확인한 뒤 같은 실패를 피해서 다시 고쳐줘.",
            );
          onStatus?.("recovery-first 재시도 요청을 준비했습니다.");
          return;
        case "continue_with_risk":
          onContinueWithRisk?.(reason, card);
          return;
        case "dismiss":
        case "mark_irrelevant":
          return;
      }
    },
    [
      onAddAcceptanceCriteria,
      onAddVerificationStep,
      onAskAiForRationale,
      onContinueWithRisk,
      onCreateReproSteps,
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
