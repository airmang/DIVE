import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStageBanner } from "../shell/ChatArea";
import type { NewCardDraft } from "../workmap/NewCardDialog";
import type { CardTransitionKind, VerifyLogView } from "../workmap/CardDetailPanel";
import { useSlideInStore } from "../../stores/slideIn";
import {
  inferStageFor,
  selectAllCardsVerified,
  selectCanChat,
  selectCurrentCard,
  useWorkmapStore,
} from "../../stores/workmap";
import { selectHasConnectedProvider, useProjectSessionStore } from "../../stores/project-session";
import { useToast } from "../toast/toast-context";
import type { CardTileData } from "../workmap/types";
import { getCardStateMeta } from "../workmap/card-state-meta";
import { useT } from "../../i18n";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { useWorkmap } from "../../hooks/useWorkmap";
import { useChatSession } from "../../hooks/useChatSession";
import { refreshMenuRecents, useMenuEvents } from "../../lib/menu-events";
import { pickFolder } from "../../lib/tauri-dialog";
import { useTheme } from "../../hooks/useTheme";
import { hasRecognizedDemoRoute } from "../../lib/dev-demo";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import type { DiveStage as PromptDiveStage } from "../../lib/ambiguity";
import { useProductShellDialogs } from "./useProductShellDialogs";

export function useProductShellController() {
  const t = useT();
  const [workmapCollapsed, setWorkmapCollapsed] = useState(false);
  const dialogs = useProductShellDialogs();
  const [lastManualCheckpointLabel, setLastManualCheckpointLabel] = useState<string | null>(null);
  const wasStreaming = useRef(false);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
  const addCardLocal = useWorkmapStore((s) => s.addCardLocal);
  const addCardsLocal = useWorkmapStore((s) => s.addCardsLocal);
  const setCurrentCardLocal = useWorkmapStore((s) => s.setCurrentCardLocal);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const currentSessionId = useProjectSessionStore((s) => s.currentSessionId);
  const createSession = useProjectSessionStore((s) => s.createSession);
  const openProject = useProjectSessionStore((s) => s.openProject);
  const selectProject = useProjectSessionStore((s) => s.selectProject);
  const isOnboarded = useProjectSessionStore((s) => s.isOnboarded);
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

  useEffect(() => {
    if (!projectSessionLoaded || isDemoRoute) return;
    if (!isOnboarded() && !hasConnectedProvider) {
      dialogs.setOnboardingOpen(true);
    }
  }, [projectSessionLoaded, isDemoRoute, hasConnectedProvider, isOnboarded, dialogs]);

  const workmap = useWorkmap(currentSessionId);
  const chat = useChatSession(currentSessionId);
  const cards = workmap.cards;
  const currentCard = useWorkmapStore(selectCurrentCard);
  const currentCardId = workmap.currentCardId;
  const canChat = useWorkmapStore(selectCanChat);
  const allVerified = useWorkmapStore(selectAllCardsVerified);

  useEffect(() => {
    if (wasStreaming.current && !chat.isStreaming) {
      void workmap.refresh();
    }
    wasStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, workmap]);

  const openSlideIn = useSlideInStore((s) => s.open);
  const closeSlideIn = useSlideInStore((s) => s.close);
  const slideInOpen = useSlideInStore((s) => s.isOpen);

  const stage = useMemo(
    () => inferStageFor(currentCard, cards.length, allVerified),
    [currentCard, cards.length, allVerified],
  );
  const canAddCard = isDemoRoute || currentSessionId !== null;

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

  const handleCardClick = (card: CardTileData) => {
    if (isDemoRoute) {
      setCurrentCardLocal(card.id);
      if (card.state === "verified" || card.state === "extended") {
        openSlideIn({
          tab: "code",
          files: workmap.changedFilesFor(card.id),
          changeSummary: card.changeSummary ?? null,
          replaceFiles: true,
        });
        return;
      }
      dialogs.setDetailOpen(true);
      return;
    }

    void (async () => {
      try {
        await workmap.setCurrentCardRemote(card.id);
        if (card.state === "verified" || card.state === "extended") {
          openSlideIn({
            tab: "code",
            files: workmap.changedFilesFor(card.id),
            changeSummary: card.changeSummary ?? null,
            replaceFiles: true,
          });
          return;
        }
        dialogs.setDetailOpen(true);
      } catch (err) {
        showWorkmapError(err);
      }
    })();
  };

  const handleDetailOpenChange = (open: boolean) => {
    dialogs.setDetailOpen(open);
    if (!open) {
      if (isDemoRoute) {
        setCurrentCardLocal(null);
        return;
      }
      void workmap.setCurrentCardRemote(null).catch(showWorkmapError);
    }
  };

  const handleInstructionChange = async (cardId: number, instruction: string) => {
    try {
      await workmap.updateInstructionRemote(cardId, instruction);
    } catch (err) {
      showWorkmapError(err);
      throw err;
    }
  };

  const handleTestCommandChange = async (cardId: number, testCommand: string) => {
    try {
      await workmap.updateTestCommandRemote(cardId, testCommand);
    } catch (err) {
      showWorkmapError(err);
      throw err;
    }
  };

  const handleTransition = async (
    cardId: number,
    transition: CardTransitionKind,
    options?: { approveForce?: boolean },
  ) => {
    try {
      await workmap.transitionCardRemote(cardId, transition, options);
      if (transition === "approve" || transition === "extend") {
        const card = cards.find((candidate) => candidate.id === cardId);
        if (card) dialogs.setRetroCard(card);
      }
    } catch (err) {
      showWorkmapError(err);
      throw err;
    }
  };

  const handleManualCheckpoint = useCallback(() => {
    const label = currentCard
      ? t("checkpoint.manual_label_with_card", { title: currentCard.title })
      : t("checkpoint.manual_label");
    void (async () => {
      try {
        const row = await chat.createCheckpoint(currentCard?.id ?? null, label);
        const savedLabel = row?.label ?? label;
        setLastManualCheckpointLabel(savedLabel);
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
  }, [chat, currentCard, toast, t]);

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
    onToggleWorkmap: () => setWorkmapCollapsed((c) => !c),
  });

  const handleVerify = useCallback(
    async (cardId: number) => {
      try {
        await workmap.verifyRemote(cardId);
      } catch (err) {
        showWorkmapError(err);
      }
    },
    [showWorkmapError, workmap],
  );

  const handleOpenCodeForCard = (cardId: number) => {
    const card = cards.find((candidate) => candidate.id === cardId);
    openSlideIn({
      tab: "code",
      files: workmap.changedFilesFor(cardId),
      changeSummary: card?.changeSummary ?? null,
      replaceFiles: true,
    });
  };

  const handleManualAddCard = useCallback(
    async (draft: NewCardDraft) => {
      const position = cards.length + 1;
      if (isDemoRoute) {
        const nextId = Math.max(0, ...cards.map((card) => card.id)) + 1;
        addCardLocal({
          id: nextId,
          title: draft.title,
          summary: draft.instructionSeed,
          assistSummary: draft.summary,
          acceptanceCriteria: draft.acceptanceCriteria,
          state: "decomposed",
          stagesCompleted: { d: true, i: false, v: false, e: false },
          position,
        });
        setCurrentCardLocal(nextId);
        dialogs.setDetailOpen(true);
        return;
      }
      try {
        const row = await workmap.createCard(draft.title, position, {
          summary: draft.summary,
          acceptanceCriteria: draft.acceptanceCriteria,
          instructionSeed: draft.instructionSeed,
        });
        await workmap.setCurrentCardRemote(row.id);
        dialogs.setDetailOpen(true);
      } catch (err) {
        showWorkmapError(err);
        throw err;
      }
    },
    [addCardLocal, cards, dialogs, isDemoRoute, setCurrentCardLocal, showWorkmapError, workmap],
  );

  const cardStateLabel = currentCard ? getCardStateMeta(currentCard.state).label : null;
  const currentVerifyLog: VerifyLogView | null = currentCard
    ? workmap.verifyLogFor(currentCard.id)
    : null;
  const currentVerifyState: "idle" | "running" | "error" = currentCard
    ? workmap.verifyStateFor(currentCard.id)
    : "idle";
  const currentVerifyError = currentCard ? workmap.verifyErrorFor(currentCard.id) : null;
  const handleEmptyStateAction = useCallback(() => {
    if (currentProjectId === null) {
      dialogs.setNewProjectOpen(true);
      return;
    }
    void createSession(currentProjectId);
  }, [createSession, currentProjectId, dialogs]);
  const promptStage = stage.toUpperCase() as PromptDiveStage;

  const inputBlocked = useMemo(() => {
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
        actionLabel:
          currentProjectId === null ? t("sidebar.new_project") : t("sidebar.new_session"),
        onAction: handleEmptyStateAction,
      };
    }
    if (!canChat) {
      return {
        reason: t("stage.gate_no_cards"),
        actionLabel: t("stage.action_add_ai_cards"),
        onAction: () => dialogs.setAiOpen(true),
      };
    }
    if (stage === "i" && currentCard) {
      const hasInstruction = (currentCard.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return {
          reason: t("stage.gate_no_instruction"),
          actionLabel: t("stage.action_write_instruction"),
          onAction: () => dialogs.setDetailOpen(true),
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
    canChat,
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
      void chat.sendUserMessage(text, stage);
    },
    [chat, stage],
  );

  const handleRetryError = useCallback(() => {
    const lastUser = [...chat.messages].reverse().find((message) => message.kind === "user");
    if (lastUser?.kind === "user") {
      void chat.sendUserMessage(lastUser.content, stage);
      return;
    }
    toast({
      variant: "error",
      title: t("toast.retry_unavailable"),
      description: t("toast.retry_unavailable_description"),
    });
  }, [chat, stage, toast, t]);

  const showProviderSetupBanner = projectSessionLoaded && !isDemoRoute && !hasConnectedProvider;

  return {
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
      cardStateLabel,
      stageBanner,
      onSendMessage: sendMessage,
      onOpenSlidePanel: () => openSlideIn({ tab: "code" }),
      onRetryError: handleRetryError,
      onApproveToolCall: (toolCallId: string, modifiedArgs?: unknown) =>
        void chat.approveToolCall(toolCallId, modifiedArgs),
      onDenyToolCall: (toolCallId: string, reason?: string) =>
        void chat.denyToolCall(toolCallId, reason),
      inputDisabled: chat.isStreaming || (!isDemoRoute && currentSessionId === null),
      inputBlocked,
      stage: promptStage,
      emptyState,
    },
    roadmap: {
      collapsed: workmapCollapsed,
      onToggle: () => setWorkmapCollapsed((c) => !c),
      cards,
      canAddCard,
      onAddCard: () => dialogs.setNewCardOpen(true),
      onCardClick: handleCardClick,
      onRequestAiAssist: () => dialogs.setAiOpen(true),
    },
    modals: {
      newCard: {
        open: dialogs.newCardOpen,
        onOpenChange: dialogs.setNewCardOpen,
        position: cards.length + 1,
        onCreate: handleManualAddCard,
      },
      aiAssist: {
        open: dialogs.aiOpen,
        onOpenChange: dialogs.setAiOpen,
        onAccept: async (nextCards: CardTileData[]) => {
          if (isDemoRoute) {
            addCardsLocal(nextCards);
            return;
          }
          try {
            for (const card of nextCards) {
              await workmap.createCard(card.title, card.position, {
                summary: card.assistSummary ?? card.summary,
                acceptanceCriteria: card.acceptanceCriteria ?? null,
              });
            }
          } catch (err) {
            showWorkmapError(err);
            throw err;
          }
        },
        positionStart: cards.length + 1,
        allowDemoFallback: isDemoRoute,
      },
      cardDetail: {
        open: dialogs.detailOpen,
        card: currentCard,
        toolCallCount: currentCard ? workmap.toolCallCountFor(currentCard.id) : 0,
        verifyLog: currentVerifyLog,
        verifyState: currentVerifyState,
        verifyError: currentVerifyError,
        onOpenChange: handleDetailOpenChange,
        onInstructionChange: handleInstructionChange,
        onTestCommandChange: handleTestCommandChange,
        onTransition: handleTransition,
        onVerify: handleVerify,
        onOpenCode: handleOpenCodeForCard,
      },
      onboarding: {
        open: dialogs.onboardingOpen,
        onOpenChange: dialogs.setOnboardingOpen,
        onConnected: () => dialogs.setNewProjectOpen(true),
      },
      newProject: {
        open: dialogs.newProjectOpen,
        onOpenChange: dialogs.setNewProjectOpen,
      },
      retro: {
        open: dialogs.retroCard !== null,
        cardTitle: dialogs.retroCard?.title ?? "",
        onOpenChange: (open: boolean) => {
          if (!open) dialogs.setRetroCard(null);
        },
        onSave: async (content: string) => {
          if (!dialogs.retroCard) return;
          await workmap.saveRetrospectiveRemote(dialogs.retroCard.id, content);
        },
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
