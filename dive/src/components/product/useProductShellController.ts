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
import type { ChatStageBanner } from "../shell/ChatArea";
import type { VerifyLogView } from "../workmap/types";
import type { ApprovalDecision } from "../workmap/ApprovalJudgment";
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
import type {
  GetStartedModel,
  GetStartedStepKey,
  GetStartedStepStatus,
} from "./GetStartedChecklist";
import { useToast } from "../toast/toast-context";
import { getCardStateMeta } from "../workmap/card-state-meta";
import { useT } from "../../i18n";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { usePlanRoadmap, useRoadmap } from "../../features/roadmap";
import type { PlanRoadmapStep, StepSessionMappingRow } from "../../features/roadmap";
import { usePlan, usePlanRouter, type RouteDecision } from "../../features/planning";
import type { InterviewRow, PlanGenerationResult } from "../../features/planning";
import {
  usePlanInterviewLLM,
  type PlanDraftLlmErrorReason,
} from "../../features/planning/usePlanInterviewLLM";
import { useChatSession, type CheckpointRowPayload } from "../../hooks/useChatSession";
import { refreshMenuRecents, useMenuEvents } from "../../lib/menu-events";
import { pickFolder } from "../../lib/tauri-dialog";
import { useTheme } from "../../hooks/useTheme";
import { hasRecognizedDemoRoute } from "../../lib/dev-demo";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import type { RecoveryCheckpointItem, FailedStepRecovery } from "./RecoveryPanel";
import { useProductShellDialogs } from "./useProductShellDialogs";
import { PlanDraftRecoveryScreen } from "./PlanDraftRecoveryScreen";
import { SocraticInterviewPanel } from "./SocraticInterviewPanel";

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

function checkpointToRecoveryItem(row: CheckpointRowPayload): RecoveryCheckpointItem {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    createdAt: row.created_at,
    changedFiles: row.changed_files ?? [],
  };
}

function buildPlanStepExecutionPrompt(item: PlanRoadmapStep): string {
  const lines = [
    "이 roadmap step을 바로 실행해 주세요.",
    `Step: ${item.step.step_id} - ${item.step.title}`,
  ];
  if (item.step.instruction_seed?.trim()) {
    lines.push("", item.step.instruction_seed.trim());
  } else if (item.step.summary?.trim()) {
    lines.push("", item.step.summary.trim());
  }
  const expectedFiles = Array.isArray(item.step.expected_files)
    ? item.step.expected_files.filter((value): value is string => typeof value === "string")
    : [];
  if (expectedFiles.length > 0) {
    lines.push("", `Expected files: ${expectedFiles.join(", ")}`);
  }
  const acceptanceCriteria = Array.isArray(item.step.acceptance_criteria)
    ? item.step.acceptance_criteria.filter((value): value is string => typeof value === "string")
    : [];
  if (acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance criteria:", ...acceptanceCriteria.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function compactFailureReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= 220) return trimmed;
  return `${trimmed.slice(0, 217)}...`;
}

export function useProductShellController() {
  const t = useT();
  const dialogs = useProductShellDialogs();
  const setOnboardingOpen = dialogs.setOnboardingOpen;
  const [lastManualCheckpointLabel, setLastManualCheckpointLabel] = useState<string | null>(null);
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
  const [checkpoints, setCheckpoints] = useState<CheckpointRowPayload[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<number | null>(null);
  const [justOpenedPlanStepBySession, setJustOpenedPlanStepBySession] = useState<
    Record<number, number>
  >({});
  const [pendingAutoRunPlanStepBySession, setPendingAutoRunPlanStepBySession] = useState<
    Record<number, number>
  >({});
  const wasStreaming = useRef(false);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
  const providers = useProjectSessionStore((s) => s.providers);
  const setCurrentCardLocal = useWorkmapStore((s) => s.setCurrentCardLocal);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
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
  const listCheckpoints = chat.listCheckpoints;

  useEffect(() => {
    activeInterviewRef.current = activeInterview;
  }, [activeInterview]);
  const refreshCheckpoints = useCallback(async () => {
    if (currentSessionId === null) {
      setCheckpoints([]);
      setCheckpointsError(null);
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

  const cards = roadmapModel.workmapCompat.cards;
  const currentCard = useWorkmapStore(selectCurrentCard);
  const currentCardId = roadmapModel.activeStepId;
  const allVerified = useWorkmapStore(selectAllCardsVerified);
  const rememberJustOpenedPlanStepMapping = useCallback((mapping: StepSessionMappingRow) => {
    const sessionId = mapping.session_id;
    if (sessionId === null) return;
    setJustOpenedPlanStepBySession((current) => ({
      ...current,
      [sessionId]: mapping.step_id,
    }));
    setPendingAutoRunPlanStepBySession((current) => ({
      ...current,
      [sessionId]: mapping.step_id,
    }));
  }, []);
  const activePlanStepIdForChat = useMemo(() => {
    if (currentSessionId === null) return undefined;
    const justOpenedStepId = justOpenedPlanStepBySession[currentSessionId];
    if (justOpenedStepId !== undefined) return justOpenedStepId;
    if (!currentCard) return undefined;
    return planRoadmap.steps.find(
      (item) =>
        item.mapping?.session_id === currentSessionId && item.mapping?.card_id === currentCard.id,
    )?.step.id;
  }, [currentCard, currentSessionId, justOpenedPlanStepBySession, planRoadmap.steps]);
  const planAccepted = planRoadmap.hasPlan;

  useEffect(() => {
    setJustOpenedPlanStepBySession((current) => {
      let changed = false;
      const next = { ...current };
      for (const [sessionIdText, stepId] of Object.entries(current)) {
        const sessionId = Number(sessionIdText);
        const mappingCaughtUp = planRoadmap.steps.some(
          (item) => item.mapping?.session_id === sessionId && item.mapping?.step_id === stepId,
        );
        if (mappingCaughtUp) {
          delete next[sessionId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [planRoadmap.steps]);

  useEffect(() => {
    void refreshCheckpoints();
  }, [refreshCheckpoints]);

  useEffect(() => {
    if (wasStreaming.current && !chat.isStreaming) {
      void roadmapModel.refresh();
      void planRoadmap.refresh();
      void refreshCheckpoints();
    }
    wasStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, refreshCheckpoints, roadmapModel, planRoadmap]);

  const openSlideIn = useSlideInStore((s) => s.open);
  const closeSlideIn = useSlideInStore((s) => s.close);
  const slideInOpen = useSlideInStore((s) => s.isOpen);

  const promptContext = useMemo(
    () => promptContextFor(currentCard, cards.length, allVerified),
    [currentCard, cards.length, allVerified],
  );

  useEffect(() => {
    if (currentSessionId === null || chat.isStreaming || !chat.isTauri) return;
    const stepId = pendingAutoRunPlanStepBySession[currentSessionId];
    if (stepId === undefined) return;
    const item = planRoadmap.steps.find((candidate) => candidate.step.id === stepId);
    if (!item) return;
    setPendingAutoRunPlanStepBySession((current) => {
      const next = { ...current };
      delete next[currentSessionId];
      return next;
    });
    void chat.sendUserMessage(buildPlanStepExecutionPrompt(item), "build", true, item.step.id);
  }, [chat, currentSessionId, pendingAutoRunPlanStepBySession, planRoadmap.steps]);

  const stageBanner = useMemo<ChatStageBanner | null>(() => {
    if (cards.length === 0) return null;
    const active = currentCard;
    if (!active) {
      if (allVerified) {
        return {
          tone: "success",
          message: t("stage.banner_all_verified"),
        };
      }
      return {
        tone: "info",
        message: t("stage.banner_select_card"),
      };
    }
    if (active.state === "decomposed") {
      return { tone: "warn", message: t("stage.banner_decomposed") };
    }
    if (active.state === "instructed") {
      const hasInstruction = (active.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return { tone: "warn", message: t("stage.banner_instructed_empty") };
      }
      return { tone: "info", message: t("stage.banner_instructed") };
    }
    if (active.state === "verifying") {
      return { tone: "info", message: t("stage.banner_verifying") };
    }
    if (active.state === "rejected") {
      return { tone: "warn", message: t("stage.banner_rejected") };
    }
    if (active.state === "verified") {
      return { tone: "success", message: t("stage.banner_verified") };
    }
    return { tone: "success", message: t("stage.banner_extended") };
  }, [cards.length, currentCard, allVerified, t]);

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
      const judgment = { ...decision, decided_at: Date.now() };
      const isApprove = decision.outcome !== "revision_requested";
      const action = isApprove ? "approve" : "request_changes";
      // The ApprovalJudgment gate IS the deliberate human evaluation. honest-verify
      // labels `intent_match` as the AI's self-reported CLAIM, and the thesis makes
      // the human the final evaluator — so an explicit human approve (확인함 → 승인,
      // or 우려 있음 → 그래도 승인) must take effect even when the AI self-reports
      // intent unmet, instead of being blocked by the backend approve-eligibility
      // gate. Blind approval isn't prevented here; it's recorded as the
      // over-trust anti-metric (research design). Hence approveForce on approve.
      void roadmapModel
        .transitionStep(currentCard.id, action, { judgment, approveForce: isApprove })
        .then(() => {
          if (decision.outcome === "revision_requested" && decision.note) {
            pushChatComposerSeed(decision.note);
            requestChatFocus();
          }
          dialogs.setStepDetailOpen(false);
        })
        .catch(showWorkmapError);
    },
    [currentCard, dialogs, pushChatComposerSeed, requestChatFocus, roadmapModel, showWorkmapError],
  );

  const handleGoToChatFromStepDetail = useCallback(() => {
    requestChatFocus();
    dialogs.setStepDetailOpen(false);
  }, [dialogs, requestChatFocus]);

  const handleManualCheckpoint = useCallback(() => {
    const label = currentCard
      ? t("checkpoint.manual_label_with_card", { title: currentCard.title })
      : t("checkpoint.manual_label");
    void (async () => {
      try {
        const row = await chat.createCheckpoint(currentCard?.id ?? null, label);
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
  }, [chat, currentCard, refreshCheckpoints, toast, t]);

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
  const inputBlocked = useMemo(() => {
    if (!isDemoRoute && currentProjectId === null) {
      return {
        reason: t("stage.gate_no_session"),
        actionLabel: t("sidebar.new_project"),
        onAction: handleEmptyStateAction,
      };
    }
    if (!isDemoRoute && !hasConnectedProvider) {
      return {
        reason: t("stage.gate_no_provider"),
        actionLabel: t("stage.action_open_settings"),
        onAction: openSettingsRoute,
      };
    }
    if (!isDemoRoute && currentSessionId === null) {
      return {
        reason: t("stage.gate_no_session"),
        actionLabel: t("sidebar.new_session"),
        onAction: handleEmptyStateAction,
      };
    }
    return null;
  }, [
    currentProjectId,
    currentSessionId,
    handleEmptyStateAction,
    hasConnectedProvider,
    isDemoRoute,
    openSettingsRoute,
    t,
  ]);

  // C1: a missing step instruction is coaching, not a wall. Cockpit-first means
  // chat is never blocked just because a card has no instruction yet — we surface
  // a dismissible, non-blocking hint instead. (Card-summary persistence still
  // records whether an instruction was written, so research telemetry is intact.)
  const composerHint = useMemo(() => {
    if (currentCard?.state === "instructed") {
      const hasInstruction = (currentCard.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return {
          message: t("stage.hint_no_instruction"),
          actionLabel: t("stage.action_write_instruction"),
          onAction: () => dialogs.setStepDetailOpen(true),
        };
      }
    }
    return null;
  }, [currentCard, dialogs, t]);

  const emptyState = useMemo(() => {
    if (currentProjectId === null) {
      return {
        title: t("chat.empty_no_project_title"),
        description: t("chat.empty_no_project_description"),
        actionLabel: t("sidebar.new_project"),
        onAction: handleEmptyStateAction,
      };
    }
    if (currentSessionId === null) {
      return {
        title: t("chat.empty_no_session_title"),
        description: t("chat.empty_no_session_description"),
        actionLabel: t("sidebar.new_session"),
        onAction: handleEmptyStateAction,
      };
    }
    return undefined;
  }, [currentProjectId, currentSessionId, handleEmptyStateAction, t]);

  // C2: one cockpit-center checklist (project -> AI -> session) replaces the
  // scattered first-run anchors. null once all prerequisites are met (or on demo
  // routes); otherwise the first unmet step is "current".
  const getStarted = useMemo<GetStartedModel | null>(() => {
    if (isDemoRoute || !projectSessionLoaded) return null;
    const hasProject = currentProjectId !== null;
    const hasProvider = hasConnectedProvider;
    const hasSession = currentSessionId !== null;
    if (hasProject && hasProvider && hasSession) return null;

    const firstIncomplete: GetStartedStepKey = !hasProject
      ? "project"
      : !hasProvider
        ? "provider"
        : "session";
    const statusOf = (key: GetStartedStepKey, done: boolean): GetStartedStepStatus =>
      done ? "done" : key === firstIncomplete ? "current" : "pending";

    return {
      steps: [
        {
          key: "project",
          status: statusOf("project", hasProject),
          title: t("get_started.project_title"),
          description: t("get_started.project_desc"),
          doneHint: currentProjectName ?? undefined,
          actionLabel: t("get_started.project_action"),
          onAction: handleEmptyStateAction,
        },
        {
          key: "provider",
          status: statusOf("provider", hasProvider),
          title: t("get_started.provider_title"),
          description: t("get_started.provider_desc"),
          doneHint: cockpitProviderLabel(providers) ?? undefined,
          actionLabel: t("get_started.provider_action"),
          onAction: () => setOnboardingOpen(true),
        },
        {
          key: "session",
          status: statusOf("session", hasSession),
          title: t("get_started.session_title"),
          description: t("get_started.session_desc"),
          actionLabel: t("get_started.session_action"),
          onAction: () => {
            if (currentProjectId !== null) void createSession(currentProjectId);
          },
        },
      ],
    };
  }, [
    isDemoRoute,
    projectSessionLoaded,
    currentProjectId,
    hasConnectedProvider,
    currentSessionId,
    currentProjectName,
    providers,
    handleEmptyStateAction,
    setOnboardingOpen,
    createSession,
    t,
  ]);

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

  const recoveryCheckpoints = useMemo(
    () => checkpoints.map(checkpointToRecoveryItem),
    [checkpoints],
  );

  const handleRestoreCheckpoint = useCallback(
    async (checkpointId: number) => {
      setRestoringCheckpointId(checkpointId);
      try {
        await chat.restoreCheckpoint(checkpointId);
        toast({
          variant: "success",
          title: t("recovery.restore_success_title"),
          description: t("recovery.restore_success_description"),
        });
        await roadmapModel.refresh();
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
    [chat, refreshCheckpoints, roadmapModel, t, toast],
  );

  const handleExplainRecovery = useCallback(
    (reason: string) => {
      const stepTitle = currentCard?.title ?? t("roadmap.current_step_fallback");
      void chat.sendUserMessage(
        t("recovery.explain_failure_prompt", { title: stepTitle, reason }),
        undefined,
        planAccepted || activePlanStepIdForChat !== undefined,
        activePlanStepIdForChat,
      );
    },
    [activePlanStepIdForChat, chat, currentCard, planAccepted, t],
  );

  const handleRetryRecovery = useCallback(() => {
    if (currentCard && (currentVerifyLog || currentVerifyState === "error")) {
      void handleVerify(currentCard.id);
      return;
    }
    handleRetryError();
  }, [currentCard, currentVerifyLog, currentVerifyState, handleRetryError, handleVerify]);

  const handleAdjustPlanRecovery = useCallback(
    (reason: string) => {
      const stepTitle = currentCard?.title ?? t("roadmap.current_step_fallback");
      openPlanInterview(t("planning.interview.adjust_failure_seed", { title: stepTitle, reason }));
    },
    [currentCard, openPlanInterview, t],
  );

  const lastToolFailure = [...chat.messages]
    .reverse()
    .find((message) => message.kind === "tool_result" && !message.success);
  const verifyFailureReason =
    currentVerifyError ??
    (currentVerifyLog && !(currentVerifyLog.intent_match && currentVerifyLog.test_result === "pass")
      ? currentVerifyLog.details ||
        t("recovery.verify_did_not_pass", { result: currentVerifyLog.test_result })
      : null);
  const rejectedReason = currentCard?.state === "rejected" ? t("recovery.rejected_reason") : null;
  const failureReason =
    verifyFailureReason ??
    rejectedReason ??
    (lastToolFailure?.kind === "tool_result" ? lastToolFailure.summary : null);
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

  const showProviderSetupBanner =
    projectSessionLoaded && !isDemoRoute && currentProjectId !== null && !hasConnectedProvider;

  const latestInterviewQuestion = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
      const message = chat.messages[i];
      if (message.kind === "assistant" && message.content.trim().length > 0) {
        return message.content.trim();
      }
    }
    return t("planning.interview.question_fallback");
  }, [chat.messages, t]);

  const planStatus = plan.status;
  const showInterviewPanel =
    !isDemoRoute &&
    currentProjectId !== null &&
    generatedPlanDraft === null &&
    planStatus !== null &&
    !planStatus.has_approved_plan &&
    (planStatus.status === "needs_interview" ||
      planStatus.status === "interview_draft" ||
      planStatus.status === "interview_submitted" ||
      planStatus.status === "draft" ||
      planStatus.status === "submitted");
  const interviewPanelDisabled = currentSessionId === null || !hasConnectedProvider;

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
      onRetryError: handleRetryError,
      onApproveToolCall: (toolCallId: string, modifiedArgs?: unknown) =>
        void chat.approveToolCall(toolCallId, modifiedArgs),
      onDenyToolCall: (toolCallId: string, reason?: string) =>
        void chat.denyToolCall(toolCallId, reason),
      interviewPanel: showInterviewPanel
        ? createElement(SocraticInterviewPanel, {
            started: activeInterview !== null,
            loading: chat.isStreaming,
            disabled: interviewPanelDisabled,
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
      planDraftApproval: generatedPlanDraft
        ? createElement(
            Suspense,
            { fallback: null },
            createElement(PlanDraftApprovalScreen, {
              draft: generatedPlanDraft,
              interview: activeInterview,
              busy: chat.isStreaming,
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
      onOpenChange: handleStepDetailOpenChange,
      onOpenCode: () => {
        if (!currentCard) return;
        handleOpenCodeForCard(currentCard.id);
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
