import { useMemo } from "react";
import type { WorkspacePlanStatus } from "../../features/planning";
import type { ChatMessage } from "../chat/types";
import type { CardTileData } from "../workmap/types";
import {
  deriveComposerHint,
  deriveEmptyState,
  deriveGetStartedModel,
  deriveInputBlocked,
  deriveStageBanner,
  findLatestInterviewQuestion,
  shouldShowInterviewPanel,
} from "./productShellConversationLogic";

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Action = () => void;

export function useProductConversationModel(input: {
  isDemoRoute: boolean;
  projectSessionLoaded: boolean;
  currentProjectId: number | null;
  currentSessionId: number | null;
  currentProjectName: string | null;
  hasConnectedProvider: boolean;
  providerDoneHint: string | null;
  cardCount: number;
  currentCard: Pick<CardTileData, "state" | "summary"> | null;
  allVerified: boolean;
  messages: ChatMessage[];
  generatedPlanDraftPresent: boolean;
  planStatus: WorkspacePlanStatus | null;
  onEmptyStateAction: Action;
  onOpenSettings: Action;
  onWriteInstruction: Action;
  onProviderAction: Action;
  onSessionAction: Action;
  onOpenResultPanel: Action;
  onOpenReviewPanel: Action;
  t: Translate;
}) {
  const stageBanner = useMemo(
    () =>
      deriveStageBanner({
        cardCount: input.cardCount,
        currentCard: input.currentCard,
        allVerified: input.allVerified,
        onOpenResultPanel: input.onOpenResultPanel,
        onOpenReviewPanel: input.onOpenReviewPanel,
        t: input.t,
      }),
    [
      input.allVerified,
      input.cardCount,
      input.currentCard,
      input.onOpenResultPanel,
      input.onOpenReviewPanel,
      input.t,
    ],
  );

  const inputBlocked = useMemo(
    () =>
      deriveInputBlocked({
        isDemoRoute: input.isDemoRoute,
        currentProjectId: input.currentProjectId,
        currentSessionId: input.currentSessionId,
        hasConnectedProvider: input.hasConnectedProvider,
        onEmptyStateAction: input.onEmptyStateAction,
        onOpenSettings: input.onOpenSettings,
        t: input.t,
      }),
    [
      input.currentProjectId,
      input.currentSessionId,
      input.hasConnectedProvider,
      input.isDemoRoute,
      input.onEmptyStateAction,
      input.onOpenSettings,
      input.t,
    ],
  );

  const composerHint = useMemo(
    () =>
      deriveComposerHint({
        currentCard: input.currentCard,
        onWriteInstruction: input.onWriteInstruction,
        t: input.t,
      }),
    [input.currentCard, input.onWriteInstruction, input.t],
  );

  const emptyState = useMemo(
    () =>
      deriveEmptyState({
        currentProjectId: input.currentProjectId,
        currentSessionId: input.currentSessionId,
        onEmptyStateAction: input.onEmptyStateAction,
        t: input.t,
      }),
    [input.currentProjectId, input.currentSessionId, input.onEmptyStateAction, input.t],
  );

  const getStarted = useMemo(
    () =>
      deriveGetStartedModel({
        isDemoRoute: input.isDemoRoute,
        projectSessionLoaded: input.projectSessionLoaded,
        currentProjectId: input.currentProjectId,
        hasConnectedProvider: input.hasConnectedProvider,
        currentSessionId: input.currentSessionId,
        currentProjectName: input.currentProjectName,
        providerDoneHint: input.providerDoneHint,
        onProjectAction: input.onEmptyStateAction,
        onProviderAction: input.onProviderAction,
        onSessionAction: input.onSessionAction,
        t: input.t,
      }),
    [
      input.currentProjectId,
      input.currentProjectName,
      input.currentSessionId,
      input.hasConnectedProvider,
      input.isDemoRoute,
      input.onEmptyStateAction,
      input.onProviderAction,
      input.onSessionAction,
      input.projectSessionLoaded,
      input.providerDoneHint,
      input.t,
    ],
  );

  const interviewQuestionFallback = input.t("planning.interview.question_fallback");
  const latestInterviewQuestion = useMemo(
    () => findLatestInterviewQuestion(input.messages, interviewQuestionFallback),
    [input.messages, interviewQuestionFallback],
  );

  const showInterviewPanel = shouldShowInterviewPanel({
    isDemoRoute: input.isDemoRoute,
    currentProjectId: input.currentProjectId,
    generatedPlanDraftPresent: input.generatedPlanDraftPresent,
    planStatus: input.planStatus,
  });

  const showProviderSetupBanner =
    input.projectSessionLoaded &&
    !input.isDemoRoute &&
    input.currentProjectId !== null &&
    !input.hasConnectedProvider;

  return {
    stageBanner,
    inputBlocked,
    composerHint,
    emptyState,
    getStarted,
    latestInterviewQuestion,
    showInterviewPanel,
    showProviderSetupBanner,
  };
}
