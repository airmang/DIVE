import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStageBanner } from "../shell/ChatArea";
import type { VerifyLogView } from "../workmap/types";
import { useSlideInStore } from "../../stores/slideIn";
import { useChatComposerStore } from "../../stores/chatComposer";
import {
  inferStageFor,
  selectAllCardsVerified,
  selectCurrentCard,
  useWorkmapStore,
} from "../../stores/workmap";
import { selectHasConnectedProvider, useProjectSessionStore } from "../../stores/project-session";
import { useToast } from "../toast/toast-context";
import { getCardStateMeta } from "../workmap/card-state-meta";
import { useT } from "../../i18n";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { usePlanRoadmap, useRoadmap } from "../../features/roadmap";
import type { StepSessionMappingRow } from "../../features/roadmap";
import { usePlan, usePlanRouter, type RouteDecision } from "../../features/planning";
import type { InterviewRow, PlanGenerationResult } from "../../features/planning";
import { usePlanInterviewLLM } from "../../features/planning/usePlanInterviewLLM";
import { useChatSession, type CheckpointRowPayload } from "../../hooks/useChatSession";
import { refreshMenuRecents, useMenuEvents } from "../../lib/menu-events";
import { pickFolder } from "../../lib/tauri-dialog";
import { useTheme } from "../../hooks/useTheme";
import { hasRecognizedDemoRoute } from "../../lib/dev-demo";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import type { DiveStage as PromptDiveStage } from "../../lib/ambiguity";
import type { RecoveryCheckpointItem, FailedStepRecovery } from "./RecoveryPanel";
import { useProductShellDialogs } from "./useProductShellDialogs";
import { PlanDraftApprovalScreen } from "./PlanDraftApprovalScreen";
import { SocraticInterviewPanel } from "./SocraticInterviewPanel";

const ONBOARDING_DISMISSED_PROJECT_KEY = "dive:onboarding-dismissed-project-id";

type AddStepRouteDecision = Extract<RouteDecision, { action: "add_step" }>;

interface PendingPlanRouteConfirmation {
  decision: AddStepRouteDecision;
  resolve: (approved: boolean) => void;
}

function readDismissedOnboardingProjectId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(ONBOARDING_DISMISSED_PROJECT_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeDismissedOnboardingProjectId(projectId: number | null) {
  if (typeof window === "undefined") return;
  if (projectId === null) window.sessionStorage.removeItem(ONBOARDING_DISMISSED_PROJECT_KEY);
  else window.sessionStorage.setItem(ONBOARDING_DISMISSED_PROJECT_KEY, String(projectId));
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
  const [pendingPlanRoute, setPendingPlanRoute] = useState<PendingPlanRouteConfirmation | null>(
    null,
  );
  const pendingPlanRouteRef = useRef<PendingPlanRouteConfirmation | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointRowPayload[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<number | null>(null);
  const [justOpenedPlanStepBySession, setJustOpenedPlanStepBySession] = useState<
    Record<number, number>
  >({});
  const wasStreaming = useRef(false);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
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
  const isOnboarded = useProjectSessionStore((s) => s.isOnboarded);
  const { toast } = useToast();
  const { toggleTheme } = useTheme();
  const [dismissedOnboardingProjectId, setDismissedOnboardingProjectId] = useState<number | null>(
    readDismissedOnboardingProjectId,
  );

  useEffect(() => {
    if (!projectSessionLoaded) {
      void loadProjectSession().catch((err) => {
        console.warn("project session load failed:", err);
      });
    }
  }, [projectSessionLoaded, loadProjectSession]);

  const isDemoRoute = import.meta.env.DEV && hasRecognizedDemoRoute();

  useEffect(() => {
    if (!hasConnectedProvider) return;
    writeDismissedOnboardingProjectId(null);
    setDismissedOnboardingProjectId(null);
  }, [hasConnectedProvider]);

  useEffect(() => {
    if (!projectSessionLoaded || isDemoRoute || currentProjectId === null) return;
    if (dismissedOnboardingProjectId === currentProjectId) return;
    if (!isOnboarded() && !hasConnectedProvider) {
      setOnboardingOpen(true);
    }
  }, [
    projectSessionLoaded,
    isDemoRoute,
    currentProjectId,
    dismissedOnboardingProjectId,
    hasConnectedProvider,
    isOnboarded,
    setOnboardingOpen,
  ]);

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
        toast({
          variant: "error",
          title: t("planning.route.error.routing_failed", {
            message: err instanceof Error ? err.message : String(err),
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
          const generated = await plan.generateDraft(interview.id, draft.planInput);
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

  const stage = useMemo(
    () => inferStageFor(currentCard, cards.length, allVerified),
    [currentCard, cards.length, allVerified],
  );

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
      if (!open && currentProjectId !== null && !hasConnectedProvider) {
        writeDismissedOnboardingProjectId(currentProjectId);
        setDismissedOnboardingProjectId(currentProjectId);
      }
    },
    [currentProjectId, hasConnectedProvider, setOnboardingOpen],
  );

  const pushChatComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const requestChatFocus = useChatComposerStore((s) => s.requestFocus);

  const handleApproveStepInChat = useCallback(() => {
    if (!currentCard) return;
    pushChatComposerSeed(
      t("roadmap.chat_actions.step_approve_message_seed", {
        position: currentCard.position,
        title: currentCard.title,
      }),
    );
    dialogs.setStepDetailOpen(false);
  }, [currentCard, dialogs, pushChatComposerSeed, t]);

  const handleRequestStepChangesInChat = useCallback(() => {
    if (!currentCard) return;
    pushChatComposerSeed(
      t("roadmap.chat_actions.step_request_changes_message_seed", {
        position: currentCard.position,
        title: currentCard.title,
      }),
    );
    dialogs.setStepDetailOpen(false);
  }, [currentCard, dialogs, pushChatComposerSeed, t]);

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
    onOpenPromptHelper: () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("demo");
      url.searchParams.set("route", "prompt-helper");
      window.history.pushState({}, "", url.toString());
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
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
    openSlideIn({
      tab: "code",
      files: roadmapModel.changedFilesForStep(cardId),
      changeSummary: card?.changeSummary ?? null,
      replaceFiles: true,
    });
  };

  const cardStateLabel = currentCard ? getCardStateMeta(currentCard.state).label : null;
  const currentVerifyLog: VerifyLogView | null = currentCard
    ? roadmapModel.verifyLogForStep(currentCard.id)
    : null;
  const currentVerifyState: "idle" | "running" | "error" = currentCard
    ? roadmapModel.verifyStateForStep(currentCard.id)
    : "idle";
  const currentVerifyError = currentCard ? roadmapModel.verifyErrorForStep(currentCard.id) : null;
  const handleEmptyStateAction = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    void createSession(currentProjectId);
  }, [createSession, currentProjectId, dialogs]);
  const promptStage = stage.toUpperCase() as PromptDiveStage;

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
    if (stage === "i" && currentCard) {
      const hasInstruction = (currentCard.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return {
          reason: t("stage.gate_no_instruction"),
          actionLabel: t("stage.action_write_instruction"),
          onAction: () => dialogs.setStepDetailOpen(true),
        };
      }
    }
    if (stage === "v" && currentCard?.state !== "verifying") {
      return {
        reason: t("stage.gate_not_verifying"),
        actionLabel: t("stage.action_start_verify"),
        onAction: currentCard ? () => void handleVerify(currentCard.id) : undefined,
      };
    }
    return null;
  }, [
    currentCard,
    currentProjectId,
    currentSessionId,
    dialogs,
    handleEmptyStateAction,
    handleVerify,
    hasConnectedProvider,
    isDemoRoute,
    openSettingsRoute,
    stage,
    t,
  ]);

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

  const sendMessage = useCallback(
    (text: string) => {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(
        text,
        stage,
        undefined,
        effectivePlanAccepted,
        activePlanStepIdForChat,
      );
    },
    [activePlanStepIdForChat, chat, stage, planAccepted],
  );

  const handleRetryError = useCallback(() => {
    const lastUser = [...chat.messages].reverse().find((message) => message.kind === "user");
    if (lastUser?.kind === "user") {
      const effectivePlanAccepted = planAccepted || activePlanStepIdForChat !== undefined;
      void chat.sendUserMessage(
        lastUser.content,
        stage,
        undefined,
        effectivePlanAccepted,
        activePlanStepIdForChat,
      );
      return;
    }
    toast({
      variant: "error",
      title: t("toast.retry_unavailable"),
      description: t("toast.retry_unavailable_description"),
    });
  }, [activePlanStepIdForChat, chat, stage, planAccepted, toast, t]);

  const openPlanInterview = useCallback(
    (goal?: string) => {
      const trimmed = goal?.trim() ?? "";
      if (trimmed.length > 0) {
        void chat.sendUserMessage(trimmed, stage, "interview", false);
      }
    },
    [chat, stage],
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
        stage,
        undefined,
        planAccepted || activePlanStepIdForChat !== undefined,
        activePlanStepIdForChat,
      );
    },
    [activePlanStepIdForChat, chat, currentCard, stage, planAccepted, t],
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
  const interviewPanelDisabled =
    chat.isStreaming || currentSessionId === null || !hasConnectedProvider || plan.loading;

  const handleStartInterview = useCallback(
    (goal: string) => {
      if (currentProjectId === null) return;
      void (async () => {
        try {
          const interview = await plan.startInterview(goal);
          setActiveInterview(interview);
          await chat.sendUserMessage(goal, stage, "interview", false);
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.start_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [chat, currentProjectId, plan, stage, t, toast],
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
          await chat.sendUserMessage(answer, stage, "interview", false);
        } catch (err) {
          toast({
            variant: "error",
            title: t("planning.interview.save_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [chat, handleStartInterview, latestInterviewQuestion, plan, stage, t, toast],
  );

  const handleCompleteInterview = useCallback(() => {
    const interview = activeInterviewRef.current;
    if (!interview) return;
    const submitPrompt = t("planning.interview.submit_prompt", {
      goal: interview.goal,
    });
    void chat.sendUserMessage(submitPrompt, stage, "interview", false);
  }, [chat, stage, t]);

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
      void chat.sendUserMessage(prompt, stage, "interview", false);
    },
    [chat, generatedPlanDraft, stage, t],
  );

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
      show: showProviderSetupBanner,
      title: t("chat.provider_setup_title"),
      description: t("stage.gate_no_provider"),
      actionLabel: t("stage.action_open_settings"),
      onOpenSettings: openSettingsRoute,
    },
    conversation: {
      messages: chat.messages,
      cardTitle: currentCard ? currentCard.title : null,
      sessionTitle: currentSessionTitle,
      cardStateLabel,
      stageBanner,
      onSendMessage: sendMessage,
      onOpenSlidePanel: () => openSlideIn({ tab: "code" }),
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
      modelLabel: planRouter.busy ? t("planning.route.routing_status") : undefined,
      inputDisabled:
        chat.isStreaming ||
        planRouter.busy ||
        pendingPlanRoute !== null ||
        (!isDemoRoute && currentSessionId === null),
      inputBlocked,
      stage: promptStage,
      emptyState,
      planDraftApproval: generatedPlanDraft
        ? createElement(PlanDraftApprovalScreen, {
            draft: generatedPlanDraft,
            interview: activeInterview,
            busy: chat.isStreaming,
            onApprove: handleApproveGeneratedPlan,
            onRequestRevision: handleRequestPlanRevision,
            onDiscard: handleDiscardGeneratedPlan,
          })
        : null,
    },
    roadmap: {
      visible: roadmapModel.steps.length > 0 || planAccepted,
      steps: roadmapModel.steps,
      activeStepId: roadmapModel.activeStepId,
      progress: roadmapModel.progress,
      goal: generatedPlanDraft?.plan.goal ?? plan.status?.plan_summary ?? null,
      onSelectStep: handleStepSelect,
      onPlanStepOpened: rememberJustOpenedPlanStepMapping,
    },
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
      onApproveInChat: handleApproveStepInChat,
      onRequestChangesInChat: handleRequestStepChangesInChat,
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
    },
    hiddenState: {
      stage,
      currentCardId,
      lastManualCheckpointLabel,
    },
  };
}

export type ProductShellController = ReturnType<typeof useProductShellController>;
