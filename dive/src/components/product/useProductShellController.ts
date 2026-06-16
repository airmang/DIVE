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
import {
  selectHasConnectedProvider,
  useProjectSessionStore,
  type ProviderSummary,
} from "../../stores/project-session";
import { cockpitProviderLabel } from "../../lib/provider-format";
import { useToast } from "../toast/toast-context";
import { getCardStateMeta } from "../workmap/card-state-meta";
import { useT } from "../../i18n";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { usePlanRoadmap, useRoadmap } from "../../features/roadmap";
import {
  PLAN_DRAFT_REVIEW_REQUEST_EVENT,
  createLiveProjectSpecDraft,
  requestPlanAdjustmentReview,
  usePlan,
  usePlanRouter,
  type LiveProjectSpecDraft,
  type ProjectSpec,
  type RationaleChallengeOffer,
  type RouteDecision,
} from "../../features/planning";
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
import { PrdAuthoringBoard, type PrdPatchFeedback } from "./PrdAuthoringBoard";
import { FinalPrdReadView } from "./FinalPrdReadView";
import { fallbackModels } from "../settings/providerModels";

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

function safeExportFilenamePart(value: string | null, fallback: string): string {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function downloadSessionExport(
  sessionId: number,
  sessionTitle: string | null,
  jsonl: string,
): void {
  const filenamePart = safeExportFilenamePart(sessionTitle, `session-${sessionId}`);
  const blob = new Blob([jsonl], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dive-${filenamePart}.jsonl`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function activeConnectedProvider(providers: ProviderSummary[]): ProviderSummary | null {
  return (
    providers.find((provider) => provider.is_connected && provider.is_active) ??
    providers.find((provider) => provider.is_connected) ??
    null
  );
}

function prdTurnFailureDescription(
  err: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("internal_error") ||
    normalized.includes("internal server error") ||
    normalized.includes("api error (5") ||
    normalized.includes("provider chat api error")
  ) {
    return t("prd.authoring.turn_failed_retryable_description");
  }
  return message;
}

function prdRuntimeSelection(
  providers: ProviderSummary[],
): { provider: string; model: string } | null {
  const provider = activeConnectedProvider(providers);
  if (!provider) return null;
  return {
    provider: provider.kind,
    model: provider.selected_model?.trim() || fallbackModels(provider.kind)[0]?.id || "default",
  };
}

function draftFromProjectSpec(projectSpec: ProjectSpec): LiveProjectSpecDraft {
  return createLiveProjectSpecDraft(projectSpec.projectId, {
    draftId: `prd-draft-${projectSpec.projectId}`,
    projectSpecId: projectSpec.projectSpecId,
    baseVersion: projectSpec.currentVersion,
    currentVersion: projectSpec.currentVersion,
    goal: projectSpec.goal,
    intentSummary: projectSpec.intentSummary,
    scope: projectSpec.scope,
    nonGoals: projectSpec.nonGoals,
    constraints: projectSpec.constraints,
    acceptanceCriteria: projectSpec.acceptanceCriteria,
    status: "draft",
  });
}

export function useProductShellController() {
  const t = useT();
  const dialogs = useProductShellDialogs();
  const setOnboardingOpen = dialogs.setOnboardingOpen;
  const [activeInterview, setActiveInterview] = useState<InterviewRow | null>(null);
  const activeInterviewRef = useRef<InterviewRow | null>(null);
  const [generatedPlanDraft, setGeneratedPlanDraft] = useState<PlanGenerationResult | null>(null);
  const [planDraftReviewRequestNonce, setPlanDraftReviewRequestNonce] = useState(0);
  const [planDraftFailure, setPlanDraftFailure] = useState<{
    reason: PlanDraftLlmErrorReason;
  } | null>(null);
  const [prdMode, setPrdMode] = useState<"authoring" | "read" | null>(null);
  const [prdDraft, setPrdDraft] = useState<LiveProjectSpecDraft | null>(null);
  const [currentProjectSpec, setCurrentProjectSpec] = useState<ProjectSpec | null>(null);
  const [prdPatchFeedback, setPrdPatchFeedback] = useState<PrdPatchFeedback | null>(null);
  const [prdBusy, setPrdBusy] = useState(false);
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
  const currentDraft = plan.currentDraft;
  const planStatus = plan.status?.status;
  const prdReadiness = plan.prdStatus?.status ?? "missing";

  useEffect(() => {
    if (generatedPlanDraft && generatedPlanDraft.plan.project_id !== currentProjectId) {
      setGeneratedPlanDraft(null);
    }
  }, [currentProjectId, generatedPlanDraft]);

  useEffect(() => {
    setPrdMode(null);
    setPrdDraft(null);
    setCurrentProjectSpec(null);
    setPrdPatchFeedback(null);
    setPrdBusy(false);
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

  useEffect(() => {
    const handler = (event: Event) => {
      const requestedProjectId = (event as CustomEvent<{ projectId?: number }>).detail?.projectId;
      if (typeof requestedProjectId === "number" && requestedProjectId !== currentProjectId) {
        return;
      }
      setPlanDraftReviewRequestNonce((nonce) => nonce + 1);
    };
    window.addEventListener(PLAN_DRAFT_REVIEW_REQUEST_EVENT, handler);
    return () => window.removeEventListener(PLAN_DRAFT_REVIEW_REQUEST_EVENT, handler);
  }, [currentProjectId]);

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
  }, [currentDraft, currentProjectId, generatedPlanDraft, planDraftReviewRequestNonce, planStatus]);

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

      toast({
        variant: "info",
        title: t("planning.route.confirm.dedicated_area_title"),
        description: t("planning.route.confirm.dedicated_area_description"),
      });
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
  const handleChallengeStepRationale = useCallback(
    async (input: { stepId: number; text: string; linkedCriterionIds: string[] }) => {
      void input.stepId;
      if (!currentPlanRoadmapStep) {
        throw new Error("Plan step context unavailable");
      }
      return plan.challengeStepRationale({
        planId: currentPlanRoadmapStep.step.plan_id,
        stepDbId: currentPlanRoadmapStep.step.id,
        text: input.text,
        linkedCriterionIds: input.linkedCriterionIds,
      });
    },
    [currentPlanRoadmapStep, plan],
  );
  const handleAcceptRationaleChallengeOffer = useCallback(
    async (offer: RationaleChallengeOffer) => {
      if (!currentPlanRoadmapStep) {
        throw new Error("Plan step context unavailable");
      }
      await plan.acceptRationaleChallengeOffer({
        planId: currentPlanRoadmapStep.step.plan_id,
        stepDbId: currentPlanRoadmapStep.step.id,
        objectionId: offer.objectionId,
        offerId: offer.offerId,
      });
      const offerMessage = offer.message || t("planning.decomposition.offer_message");
      if (currentProjectId !== null) {
        requestPlanAdjustmentReview({
          projectId: currentProjectId,
          planId: currentPlanRoadmapStep.step.plan_id,
          stepDbId: currentPlanRoadmapStep.step.id,
          objectionId: offer.objectionId,
          offerId: offer.offerId,
          offerKind: offer.offerKind,
          message: offerMessage,
          suggestedSeed: offer.suggestedSeed,
        });
      }
      await planRoadmap.refresh();
      toast({
        variant: "info",
        title: t("planning.decomposition.offer_title"),
        description: offerMessage,
      });
    },
    [currentPlanRoadmapStep, currentProjectId, plan, planRoadmap, t, toast],
  );
  const handleDismissRationaleChallengeOffer = useCallback(
    async (offer: RationaleChallengeOffer) => {
      if (!currentPlanRoadmapStep) {
        throw new Error("Plan step context unavailable");
      }
      await plan.dismissRationaleChallengeOffer({
        planId: currentPlanRoadmapStep.step.plan_id,
        stepDbId: currentPlanRoadmapStep.step.id,
        objectionId: offer.objectionId,
        offerId: offer.offerId,
      });
    },
    [currentPlanRoadmapStep, plan],
  );
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

  const openUserGuideRoute = useCallback((doc: "index" | "troubleshooting") => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("route", "user-guide");
    if (doc === "troubleshooting") {
      url.searchParams.set("doc", "troubleshooting");
    } else {
      url.searchParams.delete("doc");
    }
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

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

  const handleExportSession = useCallback(async () => {
    if (currentSessionId === null) {
      toast({
        variant: "error",
        title: t("toast.export_no_session_title"),
        description: t("toast.export_no_session_description"),
      });
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const jsonl = await invoke<string>("export_session", { sessionId: currentSessionId });
      downloadSessionExport(currentSessionId, currentSessionTitle, jsonl);
      toast({
        variant: "success",
        title: t("toast.export_success_title"),
        description: t("toast.export_success_description"),
      });
    } catch (err) {
      toast({
        variant: "error",
        title: t("toast.export_failed_title"),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentSessionId, currentSessionTitle, t, toast]);

  useMenuEvents({
    "menu:new-project": () => dialogs.setNewProjectOpen(true),
    "menu:open-project": () => void handleOpenProject(),
    "menu:open-recent": (payload) => {
      const projectId = (payload as { project_id?: number } | undefined)?.project_id;
      if (typeof projectId !== "number") return;
      void selectProject(projectId).then(() => refreshMenuRecents());
    },
    "menu:export-session": () => void handleExportSession(),
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
      openUserGuideRoute("index");
    },
    "menu:help-issue": () => {
      openUserGuideRoute("troubleshooting");
      toast({
        variant: "info",
        title: t("toast.issue_guidance_title"),
        description: t("toast.issue_guidance_description"),
      });
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

  const ensurePrdDraft = useCallback(() => {
    if (currentProjectId === null) return null;
    if (prdDraft?.projectId === currentProjectId && currentProjectSpec === null) {
      return prdDraft;
    }
    if (currentProjectSpec) {
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
    void getProjectSpecDraft(nextDraft.draftId)
      .then((savedDraft) => {
        if (savedDraft) setPrdDraft(savedDraft);
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
    (answer: string) => {
      if (!prdDraft || prdBusy) return;
      const runtime = prdRuntimeSelection(providers);
      if (!runtime) {
        openSettingsRoute();
        return;
      }
      setPrdBusy(true);
      return plan
        .submitPrdInterviewTurn({
          draftId: prdDraft.draftId,
          answer,
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
          return {
            assistantMessage: result.assistantMessage,
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

  const handleCreatePlanFromRail = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    if (!hasConnectedProvider) {
      openSettingsRoute();
      return;
    }
    if (currentSessionId === null) {
      void createSession(currentProjectId).then(() => requestChatFocus());
      return;
    }
    requestChatFocus();
  }, [
    createSession,
    currentProjectId,
    currentSessionId,
    dialogs,
    hasConnectedProvider,
    openSettingsRoute,
    requestChatFocus,
  ]);

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

  const prdSurface = useMemo(() => {
    if (prdMode === "authoring" && prdDraft) {
      return createElement(PrdAuthoringBoard, {
        projectName: currentProjectName ?? t("project.untitled"),
        projectPath: currentProjectPath,
        prdState: prdReadiness === "minimal" ? "editing" : prdReadiness,
        draft: prdDraft,
        busy: prdBusy,
        recentlyChangedFields: prdPatchFeedback?.appliedFieldPaths ?? [],
        patchFeedback: prdPatchFeedback,
        onDraftChange: setPrdDraft,
        onSubmitAnswer: handleSubmitPrdAnswer,
        onSavePrdAndCreatePlan: handleSavePrdAndCreatePlan,
      });
    }
    if (prdMode === "read" && currentProjectSpec) {
      return createElement(FinalPrdReadView, {
        projectName: currentProjectName ?? t("project.untitled"),
        projectSpec: currentProjectSpec,
        planActionLabel: t("get_started.plan_action"),
        onEdit: () => {
          setPrdDraft(draftFromProjectSpec(currentProjectSpec));
          setPrdPatchFeedback(null);
          setPrdMode("authoring");
        },
        onCreatePlan: handleCreatePlanFromRail,
      });
    }
    return null;
  }, [
    currentProjectName,
    currentProjectPath,
    currentProjectSpec,
    handleCreatePlanFromRail,
    handleSavePrdAndCreatePlan,
    handleSubmitPrdAnswer,
    prdBusy,
    prdDraft,
    prdMode,
    prdPatchFeedback,
    prdReadiness,
    t,
  ]);

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
        verification: currentCard
          ? {
              aiClaimedDone: Boolean(currentVerifyLog?.intent_match),
              automatedTestsPassed: currentVerifyLog?.test_result === "pass",
              testResult: currentVerifyLog?.test_result,
              externalTestRun: currentVerifyLog
                ? currentVerifyLog.test_result !== "skipped"
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
      prdSurface,
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
      step: currentStepDetailStep,
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
      onChallengeStepRationale: handleChallengeStepRationale,
      onAcceptRationaleChallengeOffer: handleAcceptRationaleChallengeOffer,
      onDismissRationaleChallengeOffer: handleDismissRationaleChallengeOffer,
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
