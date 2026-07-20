import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VerifyLogView } from "../workmap/types";
import type { ApprovalDecision } from "../workmap/ApprovalJudgment";
import type { ToolApprovalMetadata } from "../chat/types";
import { useSlideInStore } from "../../stores/slideIn";
import { useChatComposerStore } from "../../stores/chatComposer";
import {
  promptContextFor,
  selectAllCardsVerified,
  selectCurrentCard,
  useWorkmapStore,
} from "../../stores/workmap";
import { selectHasConnectedProvider, useProjectSessionStore } from "../../stores/project-session";
import { cockpitProviderLabel } from "../../lib/provider-format";
import { useToast } from "../toast/toast-context";
import { getCardStateMeta } from "../workmap/card-state-meta";
import { useT } from "../../i18n";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { usePlanRoadmap, useRoadmap } from "../../features/roadmap";
import {
  createLiveProjectSpecDraft,
  quickIntakeInterviewAnswers,
  validateConfirmableProjectSpec,
  usePlan,
  usePlanRouter,
  type ArchitectureProposals,
  type LiveProjectSpecDraft,
  type PrdInterviewConversationTurn,
  type ProjectSpec,
  type InterviewAnswer,
  type QuickIntakeInput,
} from "../../features/planning";
import type { PlanCritiqueResolution } from "../../features/planning";
import {
  buildIssueLines,
  collectRecoveryExamples,
} from "../../features/planning/usePlanInterviewLLM";
import { useChatSession } from "../../hooks/useChatSession";
import { useTheme } from "../../hooks/useTheme";
import { hasRecognizedDemoRoute } from "../../lib/dev-demo";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import {
  buildApprovalProvenance,
  normalizeChangedFile,
  normalizePlanStep,
} from "../../features/provocation";
import {
  hasConcreteAutomatedPass,
  hasExecutedTestCommand,
} from "../../features/provocation/verificationGrade";
import { useProductShellDialogs } from "./useProductShellDialogs";
import { useProductPlanStepRuntime } from "./useProductPlanStepRuntime";
import { useProductConversationModel } from "./useProductConversationModel";
import { useProductRecovery } from "./useProductRecovery";
import type { PrdPatchFeedback } from "./PrdAuthoringBoard";
import {
  type InterviewSurfaceData,
  type PlanDraftSurfaceData,
  type PrdSurfaceData,
} from "./ConversationSurfaces";
import { usePlanChatRouting } from "./usePlanChatRouting";
import { usePlanDraftLifecycle } from "./usePlanDraftLifecycle";
import { useShellMenus, useShellNavigation } from "./useShellMenus";
import {
  buildPrdPlanGenerationPrompt,
  draftFromProjectSpec,
  interviewAnswersFromQuestions,
  modelNotFoundToastArgs,
  prdRuntimeSelection,
  prdTurnFailureDescription,
  restorePrdDraftIfCurrent,
  runtimeSetupActionLabel,
  shouldRenderPlanDraftPending,
  shouldShowEmptyPlanRail,
  shouldUsePrdReferenceSurface,
  stringArray,
  type PrdMode,
} from "./productShellControllerLogic";

// The pure helpers moved to ./productShellControllerLogic; re-export the ones
// external callers and unit tests still import from this module.
export {
  buildPrdPlanGenerationPrompt,
  draftFromProjectSpec,
  modelNotFoundToastArgs,
  restorePrdDraftIfCurrent,
  runtimeSetupActionLabel,
  shouldRenderPlanDraftPending,
  shouldShowEmptyPlanRail,
  shouldUsePrdReferenceSurface,
} from "./productShellControllerLogic";
export type { ModelNotFoundToastArgs, PrdMode } from "./productShellControllerLogic";
export { usePlanDraftPendingController } from "./usePlanDraftLifecycle";

interface PendingPrdPlanRequest {
  projectSpec: ProjectSpec;
  interviewAnswers?: InterviewAnswer[];
}

export function useProductShellController() {
  const t = useT();
  const dialogs = useProductShellDialogs();
  const setOnboardingOpen = dialogs.setOnboardingOpen;
  const [prdMode, setPrdMode] = useState<PrdMode>(null);
  const [prdDraft, setPrdDraft] = useState<LiveProjectSpecDraft | null>(null);
  const [currentProjectSpec, setCurrentProjectSpec] = useState<ProjectSpec | null>(null);
  const [prdPatchFeedback, setPrdPatchFeedback] = useState<PrdPatchFeedback | null>(null);
  // S-047: the AI's architecture option cards for the current two-stage focus,
  // carried out of the latest interview turn so the board can render them. The
  // student's card click (not this state) is what authors the decision.
  const [architectureProposals, setArchitectureProposals] = useState<ArchitectureProposals | null>(
    null,
  );
  const [prdBusy, setPrdBusy] = useState(false);
  const [pendingPrdPlanRequest, setPendingPrdPlanRequest] = useState<PendingPrdPlanRequest | null>(
    null,
  );
  const wasStreaming = useRef(false);
  const prdDraftRestoreRequestRef = useRef(0);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
  const providers = useProjectSessionStore((s) => s.providers);
  const setCurrentCardLocal = useWorkmapStore((s) => s.setCurrentCardLocal);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
  const enableProvocationCards = useUiPreferencesStore((s) => s.enableProvocationCards);
  const provocationScaffoldMode = useUiPreferencesStore((s) => s.provocationScaffoldMode);
  const quickIntakeEnabled = useUiPreferencesStore((s) => s.quickIntakeEnabled);
  const currentProjectName = useProjectSessionStore(
    (s) => s.projects.find((p) => p.id === s.currentProjectId)?.name ?? null,
  );
  const currentProjectPath = useProjectSessionStore(
    (s) => s.projects.find((p) => p.id === s.currentProjectId)?.path ?? null,
  );
  const currentSessionTitle = useProjectSessionStore((s) =>
    s.currentSessionId === null
      ? null
      : (s.sessions.find((session) => session.id === s.currentSessionId)?.title ?? null),
  );
  const createSession = useProjectSessionStore((s) => s.createSession);
  const openProject = useProjectSessionStore((s) => s.openProject);
  const selectProject = useProjectSessionStore((s) => s.selectProject);
  const { toast } = useToast();
  const { toggleTheme } = useTheme();

  useEffect(() => {
    if (!projectSessionLoaded) {
      void loadProjectSession().catch((err) => {
        console.warn("project session load failed:", err);
      });
    }
  }, [projectSessionLoaded, loadProjectSession]);

  const isDemoRoute = import.meta.env.DEV && hasRecognizedDemoRoute();

  const roadmapModel = useRoadmap(currentSessionId);
  const planRoadmap = usePlanRoadmap(currentProjectId);
  const plan = usePlan(currentProjectId);
  const getProjectSpec = plan.getProjectSpec;
  const getProjectSpecDraft = plan.getProjectSpecDraft;
  const saveProjectSpecDraft = plan.saveProjectSpecDraft;
  const planRouter = usePlanRouter(currentProjectId);
  const prdReadiness = plan.prdStatus?.status ?? "missing";

  useEffect(() => {
    prdDraftRestoreRequestRef.current += 1;
    setPrdMode(null);
    setPrdDraft(null);
    setCurrentProjectSpec(null);
    setPrdPatchFeedback(null);
    setPrdBusy(false);
    setPendingPrdPlanRequest(null);
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId === null || prdReadiness !== "minimal") {
      return;
    }
    let cancelled = false;
    void getProjectSpec()
      .then((projectSpec) => {
        if (cancelled || !projectSpec) return;
        setCurrentProjectSpec(projectSpec);
        if (prdMode === null) {
          setPrdMode("read");
        }
      })
      .catch((err) => {
        console.warn("load project spec failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId, getProjectSpec, prdMode, prdReadiness]);

  const {
    handleBeforeChatSend,
    pendingPlanRoute,
    settlePlanRouteConfirmation,
    requestPlanReplaceConfirmation,
    pendingPlanReplace,
    settlePlanReplaceConfirmation,
  } = usePlanChatRouting({
    currentProjectId,
    plan,
    planRoadmap,
    planRouter,
    toast,
    t,
  });

  const {
    activeInterview,
    setActiveInterview,
    activeInterviewRef,
    generatedPlanDraft,
    setGeneratedPlanDraft,
    planDraftFailure,
    setPlanDraftFailure,
    planDraftPending,
    setPlanDraftExpectation,
    planInterviewObserver,
  } = usePlanDraftLifecycle({
    currentProjectId,
    plan,
    planRoadmap,
    requestPlanReplaceConfirmation,
    toast,
    t,
  });
  const chat = useChatSession(currentSessionId, planInterviewObserver, handleBeforeChatSend);

  const cards = roadmapModel.workmapCompat.cards;
  const currentCard = useWorkmapStore(selectCurrentCard);
  const currentCardId = roadmapModel.activeStepId;
  const allVerified = useWorkmapStore(selectAllCardsVerified);
  const pushChatComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const requestChatFocus = useChatComposerStore((s) => s.requestFocus);
  const {
    activePlanStepIdForChat,
    pendingPlanStepPrompt,
    clearPendingPlanStepPrompt,
    rememberJustOpenedPlanStepMapping,
  } = useProductPlanStepRuntime({
    currentSessionId,
    currentCard,
    planRoadmapSteps: planRoadmap.steps,
  });
  const activePlanStep = useMemo(
    () =>
      activePlanStepIdForChat === undefined
        ? null
        : (planRoadmap.steps.find((item) => item.step.id === activePlanStepIdForChat) ?? null),
    [activePlanStepIdForChat, planRoadmap.steps],
  );
  const activePlanStepTargetFiles = useMemo(
    () =>
      Array.isArray(activePlanStep?.step.expected_files)
        ? activePlanStep.step.expected_files.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : [],
    [activePlanStep],
  );
  const currentPlanRoadmapStep = useMemo(() => {
    if (!currentCard) return null;
    return (
      planRoadmap.steps.find((item) => item.mapping?.card_id === currentCard.id) ??
      (activePlanStepIdForChat === undefined
        ? null
        : (planRoadmap.steps.find((item) => item.step.id === activePlanStepIdForChat) ?? null))
    );
  }, [activePlanStepIdForChat, currentCard, planRoadmap.steps]);
  const currentPlanStepContext = useMemo(() => {
    const step = currentPlanRoadmapStep?.step;
    if (!step) return undefined;
    return {
      expectedFiles: stringArray(step.expected_files),
      verificationCommand: step.verification_command,
      verificationManualCheck: step.verification_manual_check,
      verificationKind: step.verification_kind,
      stepKind: step.step_kind ?? null,
      dependencies: stringArray(step.dependencies),
      parallelGroup: step.parallel_group,
      purpose: step.summary,
    };
  }, [currentPlanRoadmapStep]);
  const currentStepDetailStep = useMemo(() => {
    if (!currentCard) return null;
    const base = roadmapModel.steps.find((s) => s.id === currentCard.id) ?? null;
    if (!base) return null;
    return {
      ...base,
      linkedCriteria: currentPlanRoadmapStep?.linkedCriteria ?? base.linkedCriteria ?? [],
      decompositionRationale:
        currentPlanRoadmapStep?.decompositionRationale ?? base.decompositionRationale ?? null,
    };
  }, [currentCard, currentPlanRoadmapStep, roadmapModel.steps]);
  const hasExistingPlan = Boolean(
    plan.status?.has_plan ||
    plan.status?.has_approved_plan ||
    planRoadmap.hasPlan ||
    planRoadmap.status?.has_plan ||
    planRoadmap.status?.has_approved_plan,
  );
  const prdReferenceMode = shouldUsePrdReferenceSurface({
    prdMode,
    hasPlan: hasExistingPlan,
    roadmapStepCount: roadmapModel.steps.length,
    activePlanStepIdForChat,
  });
  const planAccepted = planRoadmap.hasPlan;
  const showEmptyPlanRail = shouldShowEmptyPlanRail({
    currentProjectId,
    planAccepted,
    roadmapStepCount: roadmapModel.steps.length,
    prdReadiness,
    prdMode,
  });

  const openSlideIn = useSlideInStore((s) => s.open);
  const closeSlideIn = useSlideInStore((s) => s.close);
  const slideInOpen = useSlideInStore((s) => s.isOpen);

  const openResultPanelWithContext = useCallback(() => {
    const currentFiles = currentCard ? roadmapModel.changedFilesForStep(currentCard.id) : [];
    openSlideIn({
      tab: "preview",
      files: currentFiles,
      changeSummary: currentCard?.changeSummary ?? null,
      emptyReason: currentFiles.length > 0 ? null : "no_output",
      previewRequestContext: {
        sessionId: currentSessionId,
        cardId: currentCard?.id ?? null,
        source: "review_action",
      },
      replaceFiles: true,
    });
  }, [currentCard, currentSessionId, openSlideIn, roadmapModel]);

  const promptContext = useMemo(
    () => promptContextFor(currentCard, cards.length, allVerified),
    [currentCard, cards.length, allVerified],
  );

  const showWorkmapError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        variant: "error",
        title: t("toast.workmap_save_failed"),
        description: message,
      });
    },
    [toast, t],
  );

  const handleStepSelect = (stepId: number) => {
    const card = cards.find((candidate) => candidate.id === stepId);
    if (!card) return;

    if (isDemoRoute) {
      setCurrentCardLocal(card.id);
      dialogs.setStepDetailOpen(true);
      return;
    }

    void (async () => {
      try {
        await roadmapModel.selectStep(card.id);
        dialogs.setStepDetailOpen(true);
      } catch (err) {
        showWorkmapError(err);
      }
    })();
  };

  const handleStepDetailOpenChange = (open: boolean) => {
    dialogs.setStepDetailOpen(open);
  };

  const handleOnboardingOpenChange = useCallback(
    (open: boolean) => {
      setOnboardingOpen(open);
    },
    [setOnboardingOpen],
  );

  const handleApprovalDecision = useCallback(
    (decision: ApprovalDecision) => {
      if (!currentCard) return;
      const decidedAt = Date.now();
      const judgment = { ...decision, decided_at: decidedAt };
      const isApprove = decision.outcome !== "revision_requested";
      const action = isApprove ? "approve" : "request_changes";
      const verifyLog = roadmapModel.verifyLogForStep(currentCard.id);
      const executedTestCommand = hasExecutedTestCommand({
        testCommand: verifyLog?.test_command ?? null,
        testExitCode: verifyLog?.test_exit_code ?? null,
      });
      const automatedTestsPassed = hasConcreteAutomatedPass({
        testResult: verifyLog?.test_result ?? null,
        testCommand: verifyLog?.test_command ?? null,
        testExitCode: verifyLog?.test_exit_code ?? null,
      });
      const changedFilesForCurrentStep = roadmapModel.changedFilesForStep(currentCard.id);
      const approvalProvenance = isApprove
        ? buildApprovalProvenance(
            {
              mode: provocationScaffoldMode,
              stage: "finalApproval",
              projectId: currentProjectId,
              sessionId: currentSessionId,
              taskId: currentCard.id,
              goalText: [currentCard.title, currentCard.summary].filter(Boolean).join("\n"),
              changedFiles: changedFilesForCurrentStep.map((file) =>
                normalizeChangedFile({ path: file.path }),
              ),
              verification: {
                aiClaimedDone: Boolean(verifyLog?.intent_match),
                automatedTestsPassed,
                testResult: verifyLog?.test_result,
                testCommand: verifyLog?.test_command ?? null,
                testExitCode: verifyLog?.test_exit_code ?? null,
                externalTestRun: verifyLog ? executedTestCommand : undefined,
                acceptanceCriterionConfirmed:
                  (decision.observationEvidence?.criterionIds.length ?? 0) > 0,
                manualChecks: decision.observationEvidence?.manualChecks ?? [],
                observationIds: decision.observationEvidence?.observationIds ?? [],
              },
            },
            {
              outcome: decision.outcome,
              decidedAt,
              riskReason: decision.outcome === "verification_deferred" ? null : decision.note,
            },
          )
        : null;
      // The ApprovalJudgment gate IS the deliberate human evaluation. honest-verify
      // labels `intent_match` as the AI's self-reported CLAIM, and the thesis makes
      // the human the final evaluator — so an explicit human approve (확인함 → 승인,
      // or 우려 있음 → 그래도 승인) must take effect even when the AI self-reports
      // intent unmet, instead of being blocked by the backend approve-eligibility
      // gate. Blind approval isn't prevented here; it's recorded as the
      // over-trust anti-metric (research design). Hence approveForce on approve.
      void (async () => {
        if (currentCard.state === "rejected") {
          if (!isApprove) {
            if (decision.note) {
              pushChatComposerSeed(decision.note);
              requestChatFocus();
            }
            dialogs.setStepDetailOpen(false);
            return "handled_rejected_revision" as const;
          }
          await roadmapModel.transitionStep(currentCard.id, "reopen");
          await chat.transitionCardRemote(currentCard.id, "request_verify");
        }
        await roadmapModel.transitionStep(currentCard.id, action, {
          judgment,
          approveForce: isApprove,
          approvalProvenance,
        });
        return "transitioned" as const;
      })()
        .then(async (result) => {
          await planRoadmap.refresh();
          if (result === "handled_rejected_revision") return;
          if (decision.outcome === "revision_requested" && decision.note) {
            pushChatComposerSeed(decision.note);
            requestChatFocus();
          }
          dialogs.setStepDetailOpen(false);
        })
        .catch(showWorkmapError);
    },
    [
      chat,
      currentCard,
      currentProjectId,
      currentSessionId,
      dialogs,
      planRoadmap,
      pushChatComposerSeed,
      provocationScaffoldMode,
      requestChatFocus,
      roadmapModel,
      showWorkmapError,
    ],
  );

  const handleGoToChatFromStepDetail = useCallback(() => {
    requestChatFocus();
    dialogs.setStepDetailOpen(false);
  }, [dialogs, requestChatFocus]);

  const { openSettingsRoute, openPromptHelperRoute, openUserGuideRoute } = useShellNavigation();

  useShellMenus({
    setNewProjectOpen: dialogs.setNewProjectOpen,
    openProject,
    selectProject,
    openSettingsRoute,
    toggleTheme,
    openUserGuideRoute,
    currentSessionId,
    currentSessionTitle,
    toast,
    t,
  });

  const handleVerify = useCallback(
    async (cardId: number) => {
      try {
        await roadmapModel.verifyStep(cardId);
      } catch (err) {
        showWorkmapError(err);
      }
    },
    [showWorkmapError, roadmapModel],
  );

  const handleOpenCodeForCard = (cardId: number) => {
    const card = cards.find((candidate) => candidate.id === cardId);
    const files = roadmapModel.changedFilesForStep(cardId);
    openSlideIn({
      tab: "code",
      files,
      changeSummary: card?.changeSummary ?? null,
      emptyReason: files.length > 0 ? null : "no_output",
      replaceFiles: true,
    });
  };

  const openCodePanelWithContext = useCallback(() => {
    const currentFiles = currentCard ? roadmapModel.changedFilesForStep(currentCard.id) : [];
    const hasBlockedWithoutOutput =
      planRoadmap.steps.some((step) => step.status === "blocked") &&
      cards.every((card) => roadmapModel.changedFilesForStep(card.id).length === 0);
    openSlideIn({
      tab: "code",
      files: currentFiles,
      changeSummary: currentCard?.changeSummary ?? null,
      emptyReason:
        currentFiles.length > 0
          ? null
          : hasBlockedWithoutOutput
            ? "blocked_no_output"
            : "no_output",
      replaceFiles: true,
    });
  }, [cards, currentCard, openSlideIn, planRoadmap.steps, roadmapModel]);

  const cardStateLabel = currentCard ? t(getCardStateMeta(currentCard.state).labelKey) : null;
  const currentCardIdForDerivedState = currentCard?.id ?? null;
  const currentChangedFiles = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.changedFilesForStep(currentCardIdForDerivedState)
        : [],
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentToolCallCount = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.toolCallCountForStep(currentCardIdForDerivedState)
        : 0,
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentVerifyLog: VerifyLogView | null = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.verifyLogForStep(currentCardIdForDerivedState)
        : null,
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentVerifyState: "idle" | "running" | "error" = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.verifyStateForStep(currentCardIdForDerivedState)
        : "idle",
    [currentCardIdForDerivedState, roadmapModel],
  );
  const currentVerifyError = useMemo(
    () =>
      currentCardIdForDerivedState !== null
        ? roadmapModel.verifyErrorForStep(currentCardIdForDerivedState)
        : null,
    [currentCardIdForDerivedState, roadmapModel],
  );

  // F2 (2026-06-10 E2E): on the happy path a build step never reached the
  // verified state, so the ApprovalJudgment gate — the core supervision moment —
  // was unreachable (handleVerify was only wired into recovery). When a build
  // turn finishes for the active step (still in `decomposed`), automatically
  // drive enter_instruct → request_verify → card_verify and open the step
  // detail so the honest-verify labels + the 확인/우려/수정요청 judgment surface.
  // The student still makes the judgment; the gate is just no longer
  // skippable/hidden. card_verify requires the card to be in Verifying
  // (src-tauri/.../verify.rs), hence the two transitions. We intentionally do
  // NOT gate on changed-files: that data may not have refreshed the instant the
  // turn ends, and missing it would re-hide the gate (the exact F2 bug);
  // card_verify honestly reports a no-output step so the student can pick 우려.
  const autoSurfaceVerifyInFlightRef = useRef(false);
  const prevChatStreamingRef = useRef(false);
  const autoSurfaceVerify = useCallback(async () => {
    const card = currentCard;
    if (autoSurfaceVerifyInFlightRef.current) return;
    if (!card || card.state !== "decomposed") return;
    if (currentVerifyState === "running" || currentVerifyLog) return;
    if (chat.error) return;
    autoSurfaceVerifyInFlightRef.current = true;
    try {
      await chat.transitionCardRemote(card.id, "enter_instruct");
      await chat.transitionCardRemote(card.id, "request_verify");
      await roadmapModel.verifyStep(card.id);
      dialogs.setStepDetailOpen(true);
    } catch (err) {
      showWorkmapError(err);
    } finally {
      autoSurfaceVerifyInFlightRef.current = false;
    }
  }, [
    chat,
    currentCard,
    currentVerifyLog,
    currentVerifyState,
    dialogs,
    roadmapModel,
    showWorkmapError,
  ]);

  useEffect(() => {
    const wasStreaming = prevChatStreamingRef.current;
    prevChatStreamingRef.current = chat.isStreaming;
    if (wasStreaming && !chat.isStreaming) {
      void autoSurfaceVerify();
    }
  }, [autoSurfaceVerify, chat.isStreaming]);

  // S-051 D3: a preflight-missed sidecar `model not found` failure (registry
  // drift, or a run-time race) lands in `chat.error` as a raw IPC rejection
  // string — today that surfaces only inside the chat transcript, which is
  // silent when the student is looking at the PRD screen (P0-02 QA
  // observation). Name the model and offer the switch action wherever they
  // are instead of relying on transcript visibility.
  const lastHandledModelNotFoundErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chat.error) return;
    if (lastHandledModelNotFoundErrorRef.current === chat.error) return;
    const args = modelNotFoundToastArgs(chat.error, t);
    if (!args) return;
    lastHandledModelNotFoundErrorRef.current = chat.error;
    toast({ variant: "error", ...args, onAction: openSettingsRoute });
  }, [chat.error, openSettingsRoute, t, toast]);

  const handleEmptyStateAction = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    void createSession(currentProjectId);
  }, [createSession, currentProjectId, dialogs]);

  const ensurePrdDraft = useCallback(() => {
    if (currentProjectId === null) return null;
    if (prdDraft?.projectId === currentProjectId && currentProjectSpec === null) {
      return prdDraft;
    }
    if (currentProjectSpec?.projectId === currentProjectId) {
      return draftFromProjectSpec(currentProjectSpec);
    }
    return createLiveProjectSpecDraft(currentProjectId, {
      draftId: plan.prdStatus?.draftId ?? `prd-draft-${currentProjectId}`,
      projectSpecId: plan.prdStatus?.projectSpecId ?? undefined,
      baseVersion: plan.prdStatus?.baseVersion ?? null,
      currentVersion: plan.prdStatus?.baseVersion ?? undefined,
    });
  }, [currentProjectId, currentProjectSpec, plan.prdStatus, prdDraft]);

  const handleOpenPrdAuthoring = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    if (!hasConnectedProvider) {
      openSettingsRoute();
      return;
    }
    const nextDraft = ensurePrdDraft();
    if (!nextDraft) return;
    setPrdDraft(nextDraft);
    setPrdPatchFeedback(null);
    setPrdMode("authoring");
    const restoreRequestId = prdDraftRestoreRequestRef.current + 1;
    prdDraftRestoreRequestRef.current = restoreRequestId;
    const requestedProjectId = nextDraft.projectId;
    const requestedDraftId = nextDraft.draftId;
    const requestedDraftUpdatedAt = nextDraft.updatedAt;
    void getProjectSpecDraft(nextDraft.draftId)
      .then((savedDraft) => {
        if (prdDraftRestoreRequestRef.current !== restoreRequestId) return;
        setPrdDraft((currentDraft) =>
          restorePrdDraftIfCurrent({
            currentDraft,
            restoredDraft: savedDraft,
            requestedProjectId,
            requestedDraftId,
            requestedDraftUpdatedAt,
          }),
        );
      })
      .catch(() => {
        // Keep the local draft visible; autosave will retry on the next edit.
      });
  }, [
    currentProjectId,
    dialogs,
    ensurePrdDraft,
    getProjectSpecDraft,
    hasConnectedProvider,
    openSettingsRoute,
  ]);

  const handleSubmitPrdAnswer = useCallback(
    (answer: string, conversation: PrdInterviewConversationTurn[] = []) => {
      if (!prdDraft || prdBusy) return;
      const runtime = prdRuntimeSelection(providers);
      if (!runtime) {
        openSettingsRoute();
        return;
      }
      prdDraftRestoreRequestRef.current += 1;
      setPrdBusy(true);
      return plan
        .submitPrdInterviewTurn({
          draftId: prdDraft.draftId,
          answer,
          conversation,
          provider: runtime.provider,
          model: runtime.model,
        })
        .then((result) => {
          setPrdDraft(result.liveDraft);
          setPrdPatchFeedback({
            validationOutcome: result.validationOutcome,
            appliedFieldPaths: result.appliedFieldPaths,
            rejectedReasons: result.rejectedReasons,
          });
          // S-047: surface (or clear) the AI's architecture cards for this turn.
          setArchitectureProposals(result.architectureProposals ?? null);
          return {
            assistantMessage: result.assistantMessage,
            appliedChange: (result.appliedFieldPaths?.length ?? 0) > 0,
          };
        })
        .catch((err) => {
          toast({
            variant: "error",
            title: t("prd.authoring.turn_failed_title"),
            description: prdTurnFailureDescription(err, t),
          });
          throw err;
        })
        .finally(() => {
          setPrdBusy(false);
        });
    },
    [openSettingsRoute, plan, prdBusy, prdDraft, providers, t, toast],
  );

  const handlePrdDraftChange = useCallback((draft: LiveProjectSpecDraft) => {
    prdDraftRestoreRequestRef.current += 1;
    setPrdDraft(draft);
  }, []);

  useEffect(() => {
    if (prdMode !== "authoring" || !prdDraft || currentProjectId === null) return;
    const handle = window.setTimeout(() => {
      void saveProjectSpecDraft(prdDraft).catch(() => {
        // Draft autosave is best-effort; the next edit or interview turn retries.
      });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [currentProjectId, prdDraft, prdMode, saveProjectSpecDraft]);

  const handleSavePrdAndCreatePlan = useCallback(
    (draft: LiveProjectSpecDraft) => {
      if (currentProjectId === null || prdBusy) return;
      setPrdBusy(true);
      void plan
        .saveProjectSpec(draft.spec, "interview")
        .then((saved) => {
          setCurrentProjectSpec(saved);
          setPrdDraft(null);
          setPrdPatchFeedback(null);
          setArchitectureProposals(null);
          setPrdMode("read");
          toast({
            variant: "success",
            title: t("prd.authoring.save_success_title"),
            description: t("prd.authoring.save_success_description"),
          });
        })
        .catch((err) => {
          toast({
            variant: "error",
            title: t("prd.authoring.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          setPrdBusy(false);
        });
    },
    [currentProjectId, plan, prdBusy, t, toast],
  );

  const startPlanGenerationFromPrd = useCallback(
    async (projectSpec: ProjectSpec, options: { interviewAnswers?: InterviewAnswer[] } = {}) => {
      if (currentProjectId === null) return;
      if (chat.isStreaming) {
        requestChatFocus();
        return;
      }
      try {
        let interview = await plan.startInterview(projectSpec.goal);
        for (const answer of options.interviewAnswers ?? []) {
          interview = await plan.saveInterviewAnswer(interview.id, answer.question, answer.answer);
        }
        activeInterviewRef.current = interview;
        setActiveInterview(interview);
        setPlanDraftExpectation(true);
        setPlanDraftFailure(null);
        setGeneratedPlanDraft(null);
        requestChatFocus();
        await chat.sendUserMessage(buildPrdPlanGenerationPrompt(projectSpec), "interview", false);
      } catch (err) {
        setPlanDraftExpectation(false);
        toast({
          variant: "error",
          title: t("planning.interview.draft_failed_title"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [
      activeInterviewRef,
      chat,
      currentProjectId,
      plan,
      requestChatFocus,
      setActiveInterview,
      setGeneratedPlanDraft,
      setPlanDraftExpectation,
      setPlanDraftFailure,
      t,
      toast,
    ],
  );

  useEffect(() => {
    if (
      pendingPrdPlanRequest === null ||
      currentSessionId === null ||
      chat.loadingHistory ||
      !chat.isTauri
    ) {
      return;
    }
    const { projectSpec, interviewAnswers } = pendingPrdPlanRequest;
    setPendingPrdPlanRequest(null);
    void startPlanGenerationFromPrd(projectSpec, { interviewAnswers });
  }, [
    chat.isTauri,
    chat.loadingHistory,
    currentSessionId,
    pendingPrdPlanRequest,
    startPlanGenerationFromPrd,
  ]);

  const handleCreatePlanFromRail = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    if (!hasConnectedProvider) {
      openSettingsRoute();
      return;
    }
    if (currentProjectSpec) {
      if (hasExistingPlan) {
        setPrdMode("read");
        requestChatFocus();
        toast({
          variant: "info",
          title: t("prd.read_view.plan_created"),
          description: t("prd.read_view.plan_created_description"),
        });
        return;
      }
      if (currentSessionId === null || chat.loadingHistory || !chat.isTauri) {
        setPendingPrdPlanRequest({ projectSpec: currentProjectSpec });
        if (currentSessionId === null) {
          void createSession(currentProjectId);
        }
        requestChatFocus();
        return;
      }
      void startPlanGenerationFromPrd(currentProjectSpec);
      return;
    }
    if (currentSessionId === null) {
      void createSession(currentProjectId).then(() => requestChatFocus());
      return;
    }
    requestChatFocus();
  }, [
    chat.isTauri,
    chat.loadingHistory,
    createSession,
    currentProjectId,
    currentProjectSpec,
    currentSessionId,
    dialogs,
    hasExistingPlan,
    hasConnectedProvider,
    openSettingsRoute,
    requestChatFocus,
    startPlanGenerationFromPrd,
    t,
    toast,
  ]);

  const handleQuickIntakeSubmit = useCallback(
    (draft: LiveProjectSpecDraft, input: QuickIntakeInput) => {
      if (currentProjectId === null || prdBusy) return;
      if (!hasConnectedProvider) {
        openSettingsRoute();
        return;
      }
      // QuickIntake must clear the SAME confirmable gate as the interview path —
      // do not fast-path a vacuous PRD straight to save (round-2 P1-13). The
      // student's answers are already on the live draft, so keep them on the board.
      if (!validateConfirmableProjectSpec(draft.spec).valid) {
        toast({
          variant: "error",
          title: t("prd.authoring.quick_intake_incomplete_title"),
          description: t("prd.authoring.quick_intake_incomplete_description"),
        });
        return;
      }
      const interviewAnswers = quickIntakeInterviewAnswers(input);
      setPrdBusy(true);
      void plan
        .saveProjectSpec(draft.spec, "interview")
        .then((saved) => {
          setCurrentProjectSpec(saved);
          setPrdDraft(null);
          setPrdPatchFeedback(null);
          setArchitectureProposals(null);
          setPrdMode("read");
          toast({
            variant: "success",
            title: t("prd.authoring.save_success_title"),
            description: t("prd.authoring.save_success_description"),
          });
          if (currentSessionId === null || chat.loadingHistory || !chat.isTauri) {
            setPendingPrdPlanRequest({ projectSpec: saved, interviewAnswers });
            if (currentSessionId === null) {
              void createSession(currentProjectId);
            }
            requestChatFocus();
            return;
          }
          void startPlanGenerationFromPrd(saved, { interviewAnswers });
        })
        .catch((err) => {
          toast({
            variant: "error",
            title: t("prd.authoring.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          setPrdBusy(false);
        });
    },
    [
      chat.isTauri,
      chat.loadingHistory,
      createSession,
      currentProjectId,
      currentSessionId,
      hasConnectedProvider,
      openSettingsRoute,
      plan,
      prdBusy,
      requestChatFocus,
      startPlanGenerationFromPrd,
      t,
      toast,
    ],
  );

  const {
    stageBanner,
    inputBlocked,
    composerHint: baseComposerHint,
    emptyState,
    getStarted,
    latestInterviewQuestion,
    showInterviewPanel,
    showProviderSetupBanner,
  } = useProductConversationModel({
    isDemoRoute,
    projectSessionLoaded,
    currentProjectId,
    currentSessionId,
    currentProjectName,
    hasConnectedProvider,
    // S-046 (P1-01): gate the composer when the supervised runtime is
    // unavailable even though a provider is connected. Reason + action come
    // from the concrete runtimeSelection state (message + setupAction).
    runtimeUnavailable: !isDemoRoute && chat.runtimeSelection?.state === "unavailable",
    runtimeReason: chat.runtimeSelection?.message,
    runtimeActionLabel: runtimeSetupActionLabel(chat.runtimeSelection?.setupAction, t),
    runtimeOnAction:
      chat.runtimeSelection?.setupAction === "open_project"
        ? handleEmptyStateAction
        : chat.runtimeSelection?.setupAction === "retry_runtime"
          ? undefined
          : openSettingsRoute,
    providerDoneHint: cockpitProviderLabel(providers),
    cardCount: cards.length,
    currentCard,
    allVerified,
    messages: chat.messages,
    messagesLoading: chat.loadingHistory,
    generatedPlanDraftPresent: generatedPlanDraft !== null,
    planStatus: plan.status,
    prdStatus: prdReadiness,
    hasPlan: Boolean(plan.status?.has_plan || planRoadmap.hasPlan || generatedPlanDraft !== null),
    hasApprovedPlan: Boolean(
      plan.status?.has_approved_plan || planRoadmap.status?.has_approved_plan,
    ),
    onEmptyStateAction: handleEmptyStateAction,
    onOpenSettings: openSettingsRoute,
    onWriteInstruction: () => dialogs.setStepDetailOpen(true),
    onProviderAction: () => setOnboardingOpen(true),
    onPrdAction: handleOpenPrdAuthoring,
    onPlanAction: handleCreatePlanFromRail,
    onSessionAction: () => {
      if (currentProjectId !== null) void createSession(currentProjectId);
    },
    onOpenResultPanel: openResultPanelWithContext,
    onOpenReviewPanel: () => dialogs.setStepDetailOpen(true),
    t,
  });

  const planStepComposerHint = useMemo(
    () =>
      pendingPlanStepPrompt
        ? {
            message: t("stage.hint_plan_step_prompt"),
            actionLabel: t("stage.action_insert_step_prompt"),
            onAction: () => {
              pushChatComposerSeed(pendingPlanStepPrompt.prompt);
              clearPendingPlanStepPrompt();
            },
          }
        : null,
    [clearPendingPlanStepPrompt, pendingPlanStepPrompt, pushChatComposerSeed, t],
  );
  const composerHint = planStepComposerHint ?? baseComposerHint;

  const sendMessage = useCallback(
    (text: string) => {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(text, undefined, effectivePlanAccepted, activePlanStepIdForChat);
      if (pendingPlanStepPrompt) clearPendingPlanStepPrompt();
    },
    [
      activePlanStepIdForChat,
      chat,
      clearPendingPlanStepPrompt,
      pendingPlanStepPrompt,
      planAccepted,
    ],
  );

  const handleRetryError = useCallback(() => {
    const lastUser = [...chat.messages].reverse().find((message) => message.kind === "user");
    if (lastUser?.kind === "user") {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(
        lastUser.content,
        undefined,
        effectivePlanAccepted,
        activePlanStepIdForChat,
      );
      return;
    }
    if (chat.retryLastUserMessage()) return;
    toast({
      variant: "error",
      title: t("toast.retry_unavailable"),
      description: t("toast.retry_unavailable_description"),
    });
  }, [activePlanStepIdForChat, chat, planAccepted, toast, t]);

  const openPlanInterview = useCallback(
    (goal?: string) => {
      const trimmed = goal?.trim() ?? "";
      if (trimmed.length > 0) {
        void chat.sendUserMessage(trimmed, "interview", false);
      }
    },
    [chat],
  );

  const interviewPanelDisabled = currentSessionId === null || !hasConnectedProvider;
  const interviewAnswers = useMemo(
    () => interviewAnswersFromQuestions(activeInterview?.questions),
    [activeInterview?.questions],
  );
  const unresolvedQuestionCount = useMemo(
    () => stringArray(activeInterview?.unresolved_questions).length,
    [activeInterview?.unresolved_questions],
  );

  const {
    lastManualCheckpointLabel,
    recoveryCheckpoints,
    checkpointsLoading,
    checkpointsError,
    restoringCheckpointId,
    failedStepRecovery,
    refreshCheckpoints,
    handleManualCheckpoint,
    handleRestoreCheckpoint,
  } = useProductRecovery({
    chat,
    currentSessionId,
    currentCard,
    currentVerifyLog,
    currentVerifyState,
    currentVerifyError,
    planAccepted,
    activePlanStepIdForChat,
    onRefreshRoadmap: roadmapModel.refresh,
    onVerifyCurrentStep: () => {
      if (!currentCard) return;
      void handleVerify(currentCard.id);
    },
    onRetryError: handleRetryError,
    onOpenPlanInterview: openPlanInterview,
    toast,
    t,
  });

  useEffect(() => {
    if (wasStreaming.current && !chat.isStreaming) {
      void roadmapModel.refresh();
      void planRoadmap.refresh();
      void refreshCheckpoints();
    }
    wasStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, refreshCheckpoints, roadmapModel, planRoadmap]);

  useGlobalShortcuts({
    onManualCheckpoint: handleManualCheckpoint,
    onNewProject: () => dialogs.setNewProjectOpen(true),
    onOpenSettings: openSettingsRoute,
    onOpenPromptHelper: openPromptHelperRoute,
    onToggleSlidePanel: () => {
      if (slideInOpen) {
        closeSlideIn();
      } else {
        openSlideIn({ tab: "code" });
      }
    },
  });

  const handleStartInterview = useCallback(
    (goal: string) => {
      if (currentProjectId === null) return;
      void (async () => {
        try {
          const interview = await plan.startInterview(goal);
          setActiveInterview(interview);
          await chat.sendUserMessage(goal, "interview", false);
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.start_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [chat, currentProjectId, plan, setActiveInterview, t, toast],
  );

  const handleSubmitInterviewAnswer = useCallback(
    (answer: string) => {
      const interview = activeInterviewRef.current;
      if (!interview) {
        handleStartInterview(answer);
        return;
      }
      void (async () => {
        try {
          const updated = await plan.saveInterviewAnswer(
            interview.id,
            latestInterviewQuestion,
            answer,
          );
          setActiveInterview(updated);
          await chat.sendUserMessage(answer, "interview", false);
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [
      activeInterviewRef,
      chat,
      handleStartInterview,
      latestInterviewQuestion,
      plan,
      setActiveInterview,
      t,
      toast,
    ],
  );

  const handleCompleteInterview = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview) return;
    const submitPrompt = t("planning.interview.submit_prompt", {
      goal: interview.goal,
    });
    setPlanDraftExpectation(true);
    setPlanDraftFailure(null);
    void chat.sendUserMessage(submitPrompt, "interview", false);
  }, [activeInterviewRef, chat, setPlanDraftExpectation, setPlanDraftFailure, t]);

  const handleApproveGeneratedPlan = useCallback(
    (critiqueResolution?: PlanCritiqueResolution) => {
      if (!generatedPlanDraft) return;
      void (async () => {
        try {
          await plan.approvePlan(generatedPlanDraft.plan.id, critiqueResolution);
          setGeneratedPlanDraft(null);
          await planRoadmap.refresh();
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.approval.approve_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [generatedPlanDraft, plan, planRoadmap, setGeneratedPlanDraft, t, toast],
  );

  const handleRequestPlanRevision = useCallback(
    (feedback: string) => {
      if (!generatedPlanDraft) return;
      const prompt = t("planning.approval.revision_prompt", {
        feedback,
        draft: JSON.stringify({
          plan: generatedPlanDraft.plan,
          steps: generatedPlanDraft.steps,
        }),
      });
      setPlanDraftExpectation(true);
      setPlanDraftFailure(null);
      void chat.sendUserMessage(prompt, "interview", false);
    },
    [chat, generatedPlanDraft, setPlanDraftExpectation, setPlanDraftFailure, t],
  );

  const handleRetryPlanDraft = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview || !planDraftFailure) return;
    // Feed the concrete missing checks into the retry so regeneration makes
    // progress instead of reproducing the identical rejection (round-2 S-041
    // plan-confirm loop). The reason slug alone never told the model what to add.
    // S-050 D4: when the backend attached machine-coded issues, build the
    // missing-checks line from the same localized copy the recovery screen
    // shows, and append self-passing examples so regeneration has a target.
    const issues = planDraftFailure.issues ?? [];
    const missing =
      issues.length > 0
        ? buildIssueLines(issues, t).join("; ")
        : planDraftFailure.unresolvedQuestions
            .map((item) => item.trim())
            .filter(Boolean)
            .join("; ");
    const recoveryExamples = issues.length > 0 ? collectRecoveryExamples(issues, t) : [];
    const examples =
      recoveryExamples.length > 0
        ? t("planning.interview.compact_retry_examples", { list: recoveryExamples.join("; ") })
        : "";
    const prompt = t("planning.interview.compact_retry_prompt", {
      goal: interview.goal,
      reason: planDraftFailure.reason,
      missing: missing || t("planning.interview.compact_retry_missing_fallback"),
      examples,
    });
    setPlanDraftExpectation(true);
    setPlanDraftFailure(null);
    void chat.sendUserMessage(prompt, "interview", false);
  }, [activeInterviewRef, chat, planDraftFailure, setPlanDraftExpectation, setPlanDraftFailure, t]);

  const handleDiscardGeneratedPlan = useCallback(() => {
    if (!generatedPlanDraft) return;
    void (async () => {
      try {
        await plan.discardPlan(generatedPlanDraft.plan.id);
        setGeneratedPlanDraft(null);
        await plan.refresh();
      } catch (err) {
        toast({
          variant: "error",
          title: t("planning.approval.discard_failed_title"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [generatedPlanDraft, plan, setGeneratedPlanDraft, t, toast]);

  const prdSurface = useMemo<PrdSurfaceData | null>(() => {
    if (prdMode === "authoring" && prdDraft) {
      return {
        mode: "authoring",
        props: {
          projectName: currentProjectName ?? t("project.untitled"),
          projectPath: currentProjectPath,
          prdState: prdReadiness === "minimal" ? "editing" : prdReadiness,
          draft: prdDraft,
          busy: prdBusy,
          recentlyChangedFields: prdPatchFeedback?.appliedFieldPaths ?? [],
          patchFeedback: prdPatchFeedback,
          architectureProposals,
          quickIntakeEnabled,
          onDraftChange: handlePrdDraftChange,
          onSubmitAnswer: handleSubmitPrdAnswer,
          onSavePrdAndCreatePlan: handleSavePrdAndCreatePlan,
          onQuickIntakeSubmit: handleQuickIntakeSubmit,
        },
      };
    }
    if (prdMode === "read" && currentProjectSpec) {
      return {
        mode: "read",
        props: {
          projectName: currentProjectName ?? t("project.untitled"),
          projectSpec: currentProjectSpec,
          planActionLabel: t("prd.authoring.create_plan"),
          canCreatePlan: !hasExistingPlan,
          planStatusLabel: hasExistingPlan ? t("prd.read_view.plan_created") : null,
          onEdit: () => {
            setPrdDraft(draftFromProjectSpec(currentProjectSpec));
            setPrdPatchFeedback(null);
            setArchitectureProposals(null);
            setPrdMode("authoring");
          },
          onCreatePlan: handleCreatePlanFromRail,
        },
      };
    }
    return null;
  }, [
    architectureProposals,
    currentProjectName,
    currentProjectPath,
    currentProjectSpec,
    hasExistingPlan,
    handleCreatePlanFromRail,
    handlePrdDraftChange,
    handleQuickIntakeSubmit,
    handleSavePrdAndCreatePlan,
    handleSubmitPrdAnswer,
    prdBusy,
    prdDraft,
    prdMode,
    prdPatchFeedback,
    prdReadiness,
    quickIntakeEnabled,
    t,
  ]);

  const interviewSurface: InterviewSurfaceData | null = showInterviewPanel
    ? {
        started: activeInterview !== null,
        answers: interviewAnswers,
        unresolvedQuestionCount,
        loading: chat.isStreaming,
        disabled: interviewPanelDisabled,
        provocation: {
          enabled: enableProvocationCards,
          mode: provocationScaffoldMode,
          projectId: currentProjectId,
          sessionId: currentSessionId,
        },
        onSubmitGoal: handleStartInterview,
        onSubmitAnswer: handleSubmitInterviewAnswer,
        onComplete: handleCompleteInterview,
      }
    : null;

  const planDraftSurface: PlanDraftSurfaceData | null = generatedPlanDraft
    ? {
        mode: "approval",
        props: {
          draft: generatedPlanDraft,
          interview: activeInterview,
          busy: chat.isStreaming,
          provocation: {
            enabled: enableProvocationCards,
            mode: provocationScaffoldMode,
            projectId: currentProjectId,
            sessionId: currentSessionId,
          },
          onApprove: handleApproveGeneratedPlan,
          onRequestRevision: handleRequestPlanRevision,
          onDiscard: handleDiscardGeneratedPlan,
        },
      }
    : planDraftFailure
      ? {
          mode: "recovery",
          props: {
            reason: planDraftFailure.reason,
            unresolvedQuestions: planDraftFailure.unresolvedQuestions,
            issues: planDraftFailure.issues,
            busy: chat.isStreaming,
            onRetry: handleRetryPlanDraft,
            onDismiss: () => setPlanDraftFailure(null),
            onEditPrd: () => {
              setPlanDraftFailure(null);
              handleOpenPrdAuthoring();
            },
          },
        }
      : shouldRenderPlanDraftPending({
            planDraftPending,
            hasGeneratedPlanDraft: generatedPlanDraft !== null,
            hasPlanDraftFailure: planDraftFailure !== null,
          })
        ? { mode: "pending" }
        : null;

  return {
    projectName: currentProjectName,
    providerBanner: {
      show: showProviderSetupBanner && getStarted === null,
      title: t("chat.provider_setup_title"),
      description: t("stage.gate_no_provider"),
      actionLabel: t("stage.action_open_settings"),
      onOpenSettings: openSettingsRoute,
    },
    conversation: {
      messages: chat.messages,
      messagesLoading: chat.loadingHistory,
      getStarted,
      cardTitle: currentCard ? currentCard.title : null,
      sessionTitle: currentSessionTitle,
      cardStateLabel,
      stageBanner,
      onSendMessage: sendMessage,
      onOpenSlidePanel: openCodePanelWithContext,
      onOpenResultPanel: openResultPanelWithContext,
      onRetryError: handleRetryError,
      onApproveToolCall: (
        toolCallId: string,
        modifiedArgs?: unknown,
        approvalMetadata?: ToolApprovalMetadata,
      ) => void chat.approveToolCall(toolCallId, modifiedArgs, approvalMetadata),
      onDenyToolCall: (toolCallId: string, reason?: string) =>
        void chat.denyToolCall(toolCallId, reason),
      interview: interviewSurface,
      modelLabel: planRouter.routeBusy
        ? planRouter.routeCancelRequested
          ? t("planning.route.cancel_requested_status")
          : t("planning.route.routing_status")
        : (cockpitProviderLabel(providers) ?? t("chat.input.model_disconnected_label")),
      runtimeSelection: chat.runtimeSelection,
      isStreaming: chat.isStreaming,
      runStartedAt: chat.runStartedAt,
      cancelRequested: chat.cancelRequested,
      onCancelStreaming: () => void chat.cancel(),
      isRouting: planRouter.routeBusy,
      routeStartedAt: planRouter.routeStartedAt,
      routeCancelRequested: planRouter.routeCancelRequested,
      onCancelRouting: () => void planRouter.cancelRoute(),
      inputDisabled:
        chat.isStreaming ||
        planRouter.busy ||
        pendingPlanRoute !== null ||
        (!isDemoRoute && currentSessionId === null),
      inputBlocked,
      composerHint,
      context: promptContext,
      emptyState,
      provocation: {
        enabled: enableProvocationCards,
        mode: provocationScaffoldMode,
        projectId: currentProjectId,
        sessionId: currentSessionId,
        goalText: currentCard?.title ?? currentSessionTitle,
        changedFiles: currentCard
          ? roadmapModel
              .changedFilesForStep(currentCard.id)
              .map((file) => normalizeChangedFile({ path: file.path }))
          : [],
        targetFiles: activePlanStepTargetFiles,
        planSteps: activePlanStep ? [normalizePlanStep(activePlanStep.step)] : [],
        verification: currentCard
          ? {
              aiClaimedDone: Boolean(currentVerifyLog?.intent_match),
              automatedTestsPassed: hasConcreteAutomatedPass({
                testResult: currentVerifyLog?.test_result ?? null,
                testCommand: currentVerifyLog?.test_command ?? null,
                testExitCode: currentVerifyLog?.test_exit_code ?? null,
              }),
              testResult: currentVerifyLog?.test_result,
              testCommand: currentVerifyLog?.test_command ?? null,
              testExitCode: currentVerifyLog?.test_exit_code ?? null,
              externalTestRun: currentVerifyLog
                ? hasExecutedTestCommand({
                    testCommand: currentVerifyLog.test_command ?? null,
                    testExitCode: currentVerifyLog.test_exit_code ?? null,
                  })
                : undefined,
              approvalProvenance: currentCard.approvalProvenance,
              approvedWithRisk: Boolean(currentCard.approvalProvenance?.riskAccepted),
            }
          : undefined,
        approvalProvenance: currentCard?.approvalProvenance ?? null,
        suppressAiSelfReportOnly:
          allVerified || currentCard?.state === "verified" || currentCard?.state === "extended",
        checkpointAvailable: recoveryCheckpoints.length > 0,
        onOpenRecovery: () => dialogs.setRecoveryOpen(true),
      },
      planDraft: planDraftSurface,
      prdSurface,
      prdSurfaceMode: prdReferenceMode ? ("reference" as const) : ("full" as const),
    },
    roadmap: {
      visible: roadmapModel.steps.length > 0 || planAccepted,
      showEmpty: showEmptyPlanRail,
      steps: roadmapModel.steps,
      activeStepId: roadmapModel.activeStepId,
      progress: roadmapModel.progress,
      goal: generatedPlanDraft?.plan.goal ?? plan.status?.plan_summary ?? null,
      onSelectStep: handleStepSelect,
      onPlanStepOpened: rememberJustOpenedPlanStepMapping,
      onCreatePlan: handleCreatePlanFromRail,
    },
    planRoadmap,
    stepDetail: {
      open: dialogs.stepDetailOpen,
      step: currentStepDetailStep,
      toolCallCount: currentToolCallCount,
      verifyLog: currentVerifyLog,
      verifyState: currentVerifyState,
      verifyError: currentVerifyError,
      changedFiles: currentChangedFiles,
      planContext: currentPlanStepContext,
      onOpenChange: handleStepDetailOpenChange,
      onOpenCode: () => {
        if (!currentCard) return;
        handleOpenCodeForCard(currentCard.id);
      },
      onOpenPreview: openResultPanelWithContext,
      onOpenRecovery: () => {
        dialogs.setStepDetailOpen(false);
        dialogs.setRecoveryOpen(true);
      },
      onVerifyFirst: () => {
        if (!currentCard) return;
        void handleVerify(currentCard.id);
      },
      rollbackAvailable: recoveryCheckpoints.length > 0,
      provocation: {
        enabled: enableProvocationCards,
        mode: provocationScaffoldMode,
        projectId: currentProjectId,
        sessionId: currentSessionId,
      },
      onApprovalDecision: handleApprovalDecision,
      onGoToChat: handleGoToChatFromStepDetail,
    },
    recovery: {
      open: dialogs.recoveryOpen,
      onOpenChange: dialogs.setRecoveryOpen,
      panel: {
        sessionAvailable: currentSessionId !== null,
        checkpoints: recoveryCheckpoints,
        loading: checkpointsLoading,
        error: checkpointsError,
        restoringCheckpointId,
        failedStep: failedStepRecovery,
        onRefresh: () => void refreshCheckpoints(),
        onCreateCheckpoint: handleManualCheckpoint,
        onRestoreCheckpoint: (checkpointId: number) => void handleRestoreCheckpoint(checkpointId),
      },
      checkpointCount: recoveryCheckpoints.length,
      hasFailedStep: failedStepRecovery !== null,
    },
    modals: {
      onboarding: {
        open: dialogs.onboardingOpen,
        onOpenChange: handleOnboardingOpenChange,
        onConnected: () => {
          if (currentProjectId === null) {
            dialogs.setNewProjectOpen(true);
            return;
          }
          if (currentSessionId === null) void createSession(currentProjectId);
        },
      },
      newProject: {
        open: dialogs.newProjectOpen,
        onOpenChange: dialogs.setNewProjectOpen,
      },
      planRoute: {
        open: pendingPlanRoute !== null,
        decision: pendingPlanRoute?.decision ?? null,
        steps: planRoadmap.steps,
        busy: planRouter.appendBusy,
        onApprove: () => settlePlanRouteConfirmation(true),
        onReject: () => settlePlanRouteConfirmation(false),
      },
      planReplace: {
        open: pendingPlanReplace !== null,
        onConfirm: () => settlePlanReplaceConfirmation(true),
        onCancel: () => settlePlanReplaceConfirmation(false),
      },
    },
    hiddenState: {
      currentCardId,
      lastManualCheckpointLabel,
    },
  };
}

export type ProductShellController = ReturnType<typeof useProductShellController>;
