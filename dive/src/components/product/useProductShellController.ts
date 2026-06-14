import {
  Suspense,
  createElement,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { usePlan, usePlanRouter, type RouteDecision } from "../../features/planning";
import type { InterviewRow, PlanGenerationResult } from "../../features/planning";
import {
  usePlanInterviewLLM,
  type PlanDraftLlmErrorReason,
} from "../../features/planning/usePlanInterviewLLM";
import { useChatSession } from "../../hooks/useChatSession";
import { refreshMenuRecents, useMenuEvents } from "../../lib/menu-events";
import { pickFolder } from "../../lib/tauri-dialog";
import { useTheme } from "../../hooks/useTheme";
import { hasRecognizedDemoRoute } from "../../lib/dev-demo";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import {
  buildApprovalProvenance,
  normalizeChangedFile,
  normalizePlanStep,
} from "../../features/provocation";
import { useProductShellDialogs } from "./useProductShellDialogs";
import { PlanDraftRecoveryScreen } from "./PlanDraftRecoveryScreen";
import { SocraticInterviewPanel } from "./SocraticInterviewPanel";
import { useProductPlanStepRuntime } from "./useProductPlanStepRuntime";
import { useProductConversationModel } from "./useProductConversationModel";
import { useProductRecovery } from "./useProductRecovery";

const PlanDraftApprovalScreen = lazy(() =>
  import("./PlanDraftApprovalScreen").then((module) => ({
    default: module.PlanDraftApprovalScreen,
  })),
);

type AddStepRouteDecision = Extract<RouteDecision, { action: "add_step" }>;

interface PendingPlanRouteConfirmation {
  decision: AddStepRouteDecision;
  resolve: (approved: boolean) => void;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function useProductShellController() {
  const t = useT();
  const dialogs = useProductShellDialogs();
  const setOnboardingOpen = dialogs.setOnboardingOpen;
  const [activeInterview, setActiveInterview] = useState<InterviewRow | null>(null);
  const activeInterviewRef = useRef<InterviewRow | null>(null);
  const [generatedPlanDraft, setGeneratedPlanDraft] = useState<PlanGenerationResult | null>(null);
  const [planDraftFailure, setPlanDraftFailure] = useState<{
    reason: PlanDraftLlmErrorReason;
  } | null>(null);
  const expectingPlanDraftRef = useRef(false);
  const [pendingPlanRoute, setPendingPlanRoute] = useState<PendingPlanRouteConfirmation | null>(
    null,
  );
  const pendingPlanRouteRef = useRef<PendingPlanRouteConfirmation | null>(null);
  const [pendingPlanReplace, setPendingPlanReplace] = useState<{
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const pendingPlanReplaceRef = useRef<{ resolve: (confirmed: boolean) => void } | null>(null);
  const wasStreaming = useRef(false);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
  const providers = useProjectSessionStore((s) => s.providers);
  const setCurrentCardLocal = useWorkmapStore((s) => s.setCurrentCardLocal);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
  const enableProvocationCards = useUiPreferencesStore((s) => s.enableProvocationCards);
  const provocationScaffoldMode = useUiPreferencesStore((s) => s.provocationScaffoldMode);
  const currentProjectName = useProjectSessionStore(
    (s) => s.projects.find((p) => p.id === s.currentProjectId)?.name ?? null,
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
  const planRouter = usePlanRouter(currentProjectId);
  const currentDraft = plan.currentDraft;
  const planStatus = plan.status?.status;

  useEffect(() => {
    if (generatedPlanDraft && generatedPlanDraft.plan.project_id !== currentProjectId) {
      setGeneratedPlanDraft(null);
    }
  }, [currentProjectId, generatedPlanDraft]);

  useEffect(() => {
    if (currentProjectId === null || generatedPlanDraft !== null || planStatus !== "draft") {
      return;
    }
    let cancelled = false;
    void currentDraft()
      .then((draft) => {
        if (!cancelled && draft) {
          setGeneratedPlanDraft(draft);
        }
      })
      .catch((err) => {
        console.warn("load current plan draft failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentDraft, currentProjectId, generatedPlanDraft, planStatus]);

  useEffect(() => {
    pendingPlanRouteRef.current = pendingPlanRoute;
  }, [pendingPlanRoute]);

  useEffect(
    () => () => {
      pendingPlanRouteRef.current?.resolve(false);
    },
    [],
  );

  const requestPlanRouteConfirmation = useCallback(
    (decision: AddStepRouteDecision) =>
      new Promise<boolean>((resolve) => {
        setPendingPlanRoute({ decision, resolve });
      }),
    [],
  );

  const settlePlanRouteConfirmation = useCallback((approved: boolean) => {
    const pending = pendingPlanRouteRef.current;
    if (!pending) return;
    pending.resolve(approved);
    pendingPlanRouteRef.current = null;
    setPendingPlanRoute(null);
  }, []);

  useEffect(() => {
    pendingPlanReplaceRef.current = pendingPlanReplace;
  }, [pendingPlanReplace]);
  useEffect(
    () => () => {
      pendingPlanReplaceRef.current?.resolve(false);
    },
    [],
  );
  const requestPlanReplaceConfirmation = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        setPendingPlanReplace({ resolve });
      }),
    [],
  );
  const settlePlanReplaceConfirmation = useCallback((confirmed: boolean) => {
    const pending = pendingPlanReplaceRef.current;
    if (!pending) return;
    pending.resolve(confirmed);
    pendingPlanReplaceRef.current = null;
    setPendingPlanReplace(null);
  }, []);

  const handleBeforeChatSend = useCallback(
    async ({
      text,
      runMode,
    }: {
      text: string;
      runMode?: "interview" | "plan" | "build" | "verify";
    }) => {
      if (runMode === "interview") return true;
      const approvedPlanId = planRoadmap.status?.has_approved_plan
        ? planRoadmap.status.plan_id
        : plan.status?.has_approved_plan
          ? plan.status.plan_id
          : null;
      if (approvedPlanId === null) return true;

      let decision: RouteDecision;
      try {
        decision = await planRouter.route(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("cancel")) return false;
        toast({
          variant: "error",
          title: t("planning.route.error.routing_failed", {
            message,
          }),
        });
        return true;
      }

      if (decision.action !== "add_step") return true;
      const approved = await requestPlanRouteConfirmation(decision);
      if (!approved) return true;

      try {
        await planRouter.appendStep(approvedPlanId, decision.draft);
        await Promise.all([planRoadmap.refresh(), plan.refresh()]);
      } catch (err) {
        toast({
          variant: "error",
          title: t("planning.route.error.routing_failed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      }
      return true;
    },
    [plan, planRoadmap, planRouter, requestPlanRouteConfirmation, t, toast],
  );

  const planInterviewObserver = usePlanInterviewLLM({
    onPlanDraft: (draft) => {
      const interview = activeInterviewRef.current;
      if (!interview) return;
      expectingPlanDraftRef.current = false;
      setPlanDraftFailure(null);
      void (async () => {
        try {
          const submitted =
            interview.status === "draft"
              ? await plan.submitInterview(
                  interview.id,
                  draft.intentSummary,
                  draft.unresolvedQuestions,
                )
              : interview;
          setActiveInterview({
            ...submitted,
            intent_summary: draft.intentSummary,
            unresolved_questions: draft.unresolvedQuestions,
          });
          // A project already carrying an APPROVED plan would make plan
          // generation hard-fail in the backend ("already has approved plan").
          // We know this up front via plan.status, so confirm a deliberate
          // replacement (discards the approved plan + its steps) before
          // generating, instead of dead-ending the student on a raw error.
          let replaceApproved = false;
          if (plan.status?.has_approved_plan) {
            replaceApproved = await requestPlanReplaceConfirmation();
            if (!replaceApproved) {
              toast({
                variant: "info",
                title: t("planning.replace.kept_title"),
                description: t("planning.replace.kept_description"),
              });
              return;
            }
          }
          const generated = await plan.generateDraft(
            interview.id,
            draft.planInput,
            replaceApproved,
          );
          setGeneratedPlanDraft(generated);
          await planRoadmap.refresh();
          toast({
            variant: "success",
            title: t("planning.interview.draft_ready_title"),
            description: t("planning.interview.draft_ready_description"),
          });
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.draft_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    onPlanDraftError: (error) => {
      if (!expectingPlanDraftRef.current || !activeInterviewRef.current) return;
      expectingPlanDraftRef.current = false;
      setPlanDraftFailure({
        reason: error.reason,
      });
      toast({
        variant: "warn",
        title: t(`planning.interview.recovery.${error.reason}.title`),
        description: t(`planning.interview.recovery.${error.reason}.description`),
      });
    },
  });
  const chat = useChatSession(currentSessionId, planInterviewObserver, handleBeforeChatSend);

  useEffect(() => {
    activeInterviewRef.current = activeInterview;
  }, [activeInterview]);

  const cards = roadmapModel.workmapCompat.cards;
  const currentCard = useWorkmapStore(selectCurrentCard);
  const currentCardId = roadmapModel.activeStepId;
  const allVerified = useWorkmapStore(selectAllCardsVerified);
  const { activePlanStepIdForChat, rememberJustOpenedPlanStepMapping } = useProductPlanStepRuntime({
    currentSessionId,
    currentCard,
    planRoadmapSteps: planRoadmap.steps,
    chat,
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
      dependencies: stringArray(step.dependencies),
      parallelGroup: step.parallel_group,
      purpose: step.summary,
    };
  }, [currentPlanRoadmapStep]);
  const planAccepted = planRoadmap.hasPlan;

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
      replaceFiles: true,
    });
  }, [currentCard, openSlideIn, roadmapModel]);

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
    if (!open) {
      if (isDemoRoute) {
        setCurrentCardLocal(null);
        return;
      }
      void roadmapModel.selectStep(null).catch(showWorkmapError);
    }
  };

  const handleOnboardingOpenChange = useCallback(
    (open: boolean) => {
      setOnboardingOpen(open);
    },
    [setOnboardingOpen],
  );

  const pushChatComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const requestChatFocus = useChatComposerStore((s) => s.requestFocus);

  const handleApprovalDecision = useCallback(
    (decision: ApprovalDecision) => {
      if (!currentCard) return;
      const decidedAt = Date.now();
      const judgment = { ...decision, decided_at: decidedAt };
      const isApprove = decision.outcome !== "revision_requested";
      const action = isApprove ? "approve" : "request_changes";
      const verifyLog = roadmapModel.verifyLogForStep(currentCard.id);
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
                automatedTestsPassed: verifyLog?.test_result === "pass",
                testResult: verifyLog?.test_result,
                externalTestRun: verifyLog ? verifyLog.test_result !== "skipped" : undefined,
              },
            },
            {
              outcome: decision.outcome,
              decidedAt,
              riskReason: decision.note,
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
      void roadmapModel
        .transitionStep(currentCard.id, action, {
          judgment,
          approveForce: isApprove,
          approvalProvenance,
        })
        .then(async () => {
          await planRoadmap.refresh();
          if (decision.outcome === "revision_requested" && decision.note) {
            pushChatComposerSeed(decision.note);
            requestChatFocus();
          }
          dialogs.setStepDetailOpen(false);
        })
        .catch(showWorkmapError);
    },
    [
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

  const openSettingsRoute = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("route", "settings");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  const openPromptHelperRoute = import.meta.env.DEV
    ? () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        url.searchParams.set("route", "prompt-helper");
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    : undefined;

  const handleOpenProject = useCallback(async () => {
    const picked = await pickFolder({ title: t("project.open_pick_title") });
    if (!picked) return;
    try {
      await openProject(picked);
    } catch (err) {
      toast({
        variant: "error",
        title: t("toast.project_open_failed"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [openProject, toast, t]);

  const openExternalUrl = useCallback(
    async (url: string, title: string) => {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } catch (err) {
        toast({
          variant: "error",
          title,
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  useMenuEvents({
    "menu:new-project": () => dialogs.setNewProjectOpen(true),
    "menu:open-project": () => void handleOpenProject(),
    "menu:open-recent": (payload) => {
      const projectId = (payload as { project_id?: number } | undefined)?.project_id;
      if (typeof projectId !== "number") return;
      void selectProject(projectId).then(() => refreshMenuRecents());
    },
    "menu:settings": openSettingsRoute,
    "menu:toggle-theme": () => toggleTheme(),
    "menu:help-tutorial": () => {
      const { tutorialEnabled, setTutorialEnabled } = useUiPreferencesStore.getState();
      const nextEnabled = !tutorialEnabled;
      setTutorialEnabled(nextEnabled);
      toast({
        variant: "info",
        title: nextEnabled ? t("toast.tutorial_on") : t("toast.tutorial_off"),
        description: t("toast.tutorial_description"),
      });
    },
    "menu:help-docs": () => {
      void openExternalUrl(
        "https://github.com/coreelab/dive/blob/main/README.md",
        t("toast.docs_open_failed"),
      );
    },
    "menu:help-issue": () => {
      void openExternalUrl(
        "https://github.com/coreelab/dive/issues/new",
        t("toast.issue_open_failed"),
      );
    },
    "menu:help-about": () =>
      toast({
        variant: "info",
        title: t("toast.about_title"),
        description: t("toast.about_description"),
      }),
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
  const currentVerifyLog: VerifyLogView | null = currentCard
    ? roadmapModel.verifyLogForStep(currentCard.id)
    : null;
  const currentVerifyState: "idle" | "running" | "error" = currentCard
    ? roadmapModel.verifyStateForStep(currentCard.id)
    : "idle";
  const currentVerifyError = currentCard ? roadmapModel.verifyErrorForStep(currentCard.id) : null;

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

  const handleEmptyStateAction = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    void createSession(currentProjectId);
  }, [createSession, currentProjectId, dialogs]);
  const {
    stageBanner,
    inputBlocked,
    composerHint,
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
    providerDoneHint: cockpitProviderLabel(providers),
    cardCount: cards.length,
    currentCard,
    allVerified,
    messages: chat.messages,
    generatedPlanDraftPresent: generatedPlanDraft !== null,
    planStatus: plan.status,
    onEmptyStateAction: handleEmptyStateAction,
    onOpenSettings: openSettingsRoute,
    onWriteInstruction: () => dialogs.setStepDetailOpen(true),
    onProviderAction: () => setOnboardingOpen(true),
    onSessionAction: () => {
      if (currentProjectId !== null) void createSession(currentProjectId);
    },
    onOpenResultPanel: openResultPanelWithContext,
    t,
  });

  const handleCreatePlanFromRail = useCallback(() => {
    if (currentProjectId === null || currentSessionId === null) {
      handleEmptyStateAction();
      return;
    }
    if (!hasConnectedProvider) {
      openSettingsRoute();
      return;
    }
    requestChatFocus();
  }, [
    currentProjectId,
    currentSessionId,
    handleEmptyStateAction,
    hasConnectedProvider,
    openSettingsRoute,
    requestChatFocus,
  ]);

  const sendMessage = useCallback(
    (text: string) => {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(text, undefined, effectivePlanAccepted, activePlanStepIdForChat);
    },
    [activePlanStepIdForChat, chat, planAccepted],
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
    [chat, currentProjectId, plan, t, toast],
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
    [chat, handleStartInterview, latestInterviewQuestion, plan, t, toast],
  );

  const handleCompleteInterview = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview) return;
    const submitPrompt = t("planning.interview.submit_prompt", {
      goal: interview.goal,
    });
    expectingPlanDraftRef.current = true;
    setPlanDraftFailure(null);
    void chat.sendUserMessage(submitPrompt, "interview", false);
  }, [chat, t]);

  const handleApproveGeneratedPlan = useCallback(() => {
    if (!generatedPlanDraft) return;
    void (async () => {
      try {
        await plan.approvePlan(generatedPlanDraft.plan.id);
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
  }, [generatedPlanDraft, plan, planRoadmap, t, toast]);

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
      expectingPlanDraftRef.current = true;
      setPlanDraftFailure(null);
      void chat.sendUserMessage(prompt, "interview", false);
    },
    [chat, generatedPlanDraft, t],
  );

  const handleRetryPlanDraft = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview || !planDraftFailure) return;
    const prompt = t("planning.interview.compact_retry_prompt", {
      goal: interview.goal,
      reason: planDraftFailure.reason,
    });
    expectingPlanDraftRef.current = true;
    setPlanDraftFailure(null);
    void chat.sendUserMessage(prompt, "interview", false);
  }, [chat, planDraftFailure, t]);

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
  }, [generatedPlanDraft, plan, t, toast]);

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
      interviewPanel: showInterviewPanel
        ? createElement(SocraticInterviewPanel, {
            started: activeInterview !== null,
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
          })
        : null,
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
        checkpointAvailable: recoveryCheckpoints.length > 0,
        onOpenRecovery: () => dialogs.setRecoveryOpen(true),
      },
      planDraftApproval: generatedPlanDraft
        ? createElement(
            Suspense,
            { fallback: null },
            createElement(PlanDraftApprovalScreen, {
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
            }),
          )
        : planDraftFailure
          ? createElement(PlanDraftRecoveryScreen, {
              reason: planDraftFailure.reason,
              busy: chat.isStreaming,
              onRetry: handleRetryPlanDraft,
              onDismiss: () => setPlanDraftFailure(null),
            })
          : null,
    },
    roadmap: {
      visible: roadmapModel.steps.length > 0 || planAccepted,
      showEmpty: currentProjectId !== null && !planAccepted && roadmapModel.steps.length === 0,
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
      step: currentCard ? (roadmapModel.steps.find((s) => s.id === currentCard.id) ?? null) : null,
      toolCallCount: currentCard ? roadmapModel.toolCallCountForStep(currentCard.id) : 0,
      verifyLog: currentVerifyLog,
      verifyState: currentVerifyState,
      verifyError: currentVerifyError,
      changedFiles: currentCard ? roadmapModel.changedFilesForStep(currentCard.id) : [],
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
