import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea, type ChatStageBanner } from "./ChatArea";
import { WorkmapStrip } from "./WorkmapStrip";
import { SlideInPanel } from "../slide-in/SlideInPanel";
import { AiAssistDialog } from "../workmap/AiAssistDialog";
import { OnboardingDialog } from "../onboarding/OnboardingDialog";
import { NewProjectDialog } from "../onboarding/NewProjectDialog";
import {
  CardDetailPanel,
  type CardTransitionKind,
  type VerifyLogView,
} from "../workmap/CardDetailPanel";
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
import { Button } from "../ui/button";
import { hasDevDemoParam } from "../../lib/dev-demo";

export function MainShell() {
  const t = useT();
  const [workmapCollapsed, setWorkmapCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [lastManualCheckpointLabel, setLastManualCheckpointLabel] = useState<string | null>(null);
  const wasStreaming = useRef(false);

  const projectSessionLoaded = useProjectSessionStore((s) => s.loaded);
  const loadProjectSession = useProjectSessionStore((s) => s.loadAll);
  const hasConnectedProvider = useProjectSessionStore(selectHasConnectedProvider);
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
    if (!projectSessionLoaded) void loadProjectSession().catch(() => undefined);
  }, [projectSessionLoaded, loadProjectSession]);

  const isDemoRoute = hasDevDemoParam();

  useEffect(() => {
    if (!projectSessionLoaded || isDemoRoute) return;
    if (!isOnboarded() && !hasConnectedProvider) {
      setOnboardingOpen(true);
    }
  }, [projectSessionLoaded, isDemoRoute, hasConnectedProvider, isOnboarded]);

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

  const inputBlocked = useMemo(() => {
    if (!isDemoRoute && currentSessionId === null) {
      return { reason: "세션을 선택하거나 생성하세요." };
    }
    if (!canChat) {
      return { reason: t("stage.gate_no_cards") };
    }
    if (stage === "i" && currentCard) {
      const hasInstruction = (currentCard.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return { reason: t("stage.gate_no_instruction") };
      }
    }
    if (stage === "v" && currentCard?.state !== "verifying") {
      return { reason: t("stage.gate_not_verifying") };
    }
    return null;
  }, [canChat, currentSessionId, isDemoRoute, stage, currentCard, t]);

  const showWorkmapError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        variant: "error",
        title: "워크맵 저장 실패",
        description: message,
      });
    },
    [toast],
  );

  const handleCardClick = (card: CardTileData) => {
    if (isDemoRoute) {
      setCurrentCardLocal(card.id);
      if (card.state === "verified" || card.state === "extended") {
        openSlideIn({
          tab: "code",
          files: workmap.changedFilesFor(card.id),
          replaceFiles: true,
        });
        return;
      }
      setDetailOpen(true);
      return;
    }

    void (async () => {
      try {
        await workmap.setCurrentCardRemote(card.id);
        if (card.state === "verified" || card.state === "extended") {
          openSlideIn({
            tab: "code",
            files: workmap.changedFilesFor(card.id),
            replaceFiles: true,
          });
          return;
        }
        setDetailOpen(true);
      } catch (err) {
        showWorkmapError(err);
      }
    })();
  };

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
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
          title: "체크포인트 저장 실패",
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
    const picked = await pickFolder({ title: "열 프로젝트 폴더 선택" });
    if (!picked) return;
    try {
      await openProject(picked);
    } catch (err) {
      toast({
        variant: "error",
        title: "프로젝트 열기 실패",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [openProject, toast]);

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
    "menu:new-project": () => setNewProjectOpen(true),
    "menu:open-project": () => void handleOpenProject(),
    "menu:open-recent": (payload) => {
      const projectId = (payload as { project_id?: number } | undefined)?.project_id;
      if (typeof projectId !== "number") return;
      void selectProject(projectId).then(() => refreshMenuRecents());
    },
    "menu:settings": openSettingsRoute,
    "menu:toggle-theme": () => toggleTheme(),
    "menu:help-docs": () => {
      void openExternalUrl(
        "https://github.com/coreelab/dive/blob/main/README.md",
        "문서를 열 수 없습니다",
      );
    },
    "menu:help-issue": () => {
      void openExternalUrl(
        "https://github.com/coreelab/dive/issues/new",
        "이슈 페이지를 열 수 없습니다",
      );
    },
    "menu:help-about": () =>
      toast({
        variant: "info",
        title: "DIVE v1.0.0-rc.2",
        description: "AI 코딩 작업을 카드와 세션으로 관리하는 데스크톱 앱입니다.",
      }),
  });

  useGlobalShortcuts({
    onManualCheckpoint: handleManualCheckpoint,
    onNewProject: () => setNewProjectOpen(true),
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
    openSlideIn({
      tab: "code",
      files: workmap.changedFilesFor(cardId),
      replaceFiles: true,
    });
  };

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
      setNewProjectOpen(true);
      return;
    }
    void createSession(currentProjectId);
  }, [createSession, currentProjectId]);

  const emptyState = useMemo(() => {
    if (currentProjectId === null) {
      return {
        title: "프로젝트를 만들고 세션을 시작하세요",
        description: "DIVE는 프로젝트별로 카드와 대화를 디스크 DB에 저장합니다.",
        actionLabel: "새 프로젝트",
        onAction: handleEmptyStateAction,
      };
    }
    if (currentSessionId === null) {
      return {
        title: "세션을 선택하거나 생성하세요",
        description: "세션이 선택되기 전에는 카드와 채팅을 만들지 않습니다.",
        actionLabel: "새 세션",
        onAction: handleEmptyStateAction,
      };
    }
    return undefined;
  }, [currentProjectId, currentSessionId, handleEmptyStateAction]);

  const sendMessage = useCallback(
    (text: string) => {
      void chat.sendUserMessage(text, stage);
    },
    [chat, stage],
  );

  const showProviderSetupBanner = projectSessionLoaded && !isDemoRoute && !hasConnectedProvider;

  return (
    <div
      className="relative h-screen w-screen grid grid-cols-[280px_1fr] grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg"
      data-testid="main-shell"
    >
      {showProviderSetupBanner ? (
        <div
          role="alert"
          data-testid="provider-required-banner"
          className="pointer-events-none absolute left-[296px] right-4 top-4 z-30 flex items-center justify-between gap-3 rounded-lg border border-warn/50 bg-bg-panel px-4 py-3 text-sm shadow-lg"
        >
          <div>
            <div className="font-semibold text-fg">API 키를 설정하세요</div>
            <div className="text-xs text-fg-muted">
              연결된 프로바이더가 없어 채팅과 검증을 시작할 수 없습니다.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={openSettingsRoute}
            data-testid="provider-banner-cta"
            className="pointer-events-auto"
          >
            설정 열기
          </Button>
        </div>
      ) : null}
      <Sidebar className="row-start-1 col-start-1 min-h-0" />
      <ChatArea
        className="row-start-1 col-start-2 min-h-0 min-w-0"
        messages={chat.messages}
        cardTitle={currentCard ? currentCard.title : null}
        cardStateLabel={cardStateLabel}
        stageBanner={stageBanner}
        onSendMessage={sendMessage}
        onOpenSlidePanel={() => openSlideIn({ tab: "code" })}
        onApproveToolCall={(toolCallId, modifiedArgs) =>
          void chat.approveToolCall(toolCallId, modifiedArgs)
        }
        onDenyToolCall={(toolCallId, reason) => void chat.denyToolCall(toolCallId, reason)}
        inputDisabled={chat.isStreaming || (!isDemoRoute && currentSessionId === null)}
        inputBlocked={inputBlocked}
        emptyState={emptyState}
      />
      <WorkmapStrip
        className="row-start-2 col-span-2"
        collapsed={workmapCollapsed}
        onToggle={() => setWorkmapCollapsed((c) => !c)}
        cards={cards}
        canAddCard={canChat}
        onCardClick={handleCardClick}
        onRequestAiAssist={() => setAiOpen(true)}
      />
      <SlideInPanel />
      <AiAssistDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        onAccept={async (nextCards) => {
          if (isDemoRoute) {
            addCardsLocal(nextCards);
            return;
          }
          try {
            for (const card of nextCards) {
              await workmap.createCard(card.title, card.position);
            }
          } catch (err) {
            showWorkmapError(err);
            throw err;
          }
        }}
        positionStart={cards.length + 1}
        allowDemoFallback={isDemoRoute}
      />
      <CardDetailPanel
        open={detailOpen}
        card={currentCard}
        toolCallCount={currentCard ? workmap.toolCallCountFor(currentCard.id) : 0}
        verifyLog={currentVerifyLog}
        verifyState={currentVerifyState}
        verifyError={currentVerifyError}
        onOpenChange={handleDetailOpenChange}
        onInstructionChange={handleInstructionChange}
        onTestCommandChange={handleTestCommandChange}
        onTransition={handleTransition}
        onVerify={handleVerify}
        onOpenCode={handleOpenCodeForCard}
      />
      <OnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onConnected={() => setNewProjectOpen(true)}
      />
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <input type="hidden" data-testid="current-stage" value={stage} />
      <input type="hidden" data-testid="current-card-id" value={currentCardId ?? ""} />
      <input
        type="hidden"
        data-testid="last-manual-checkpoint"
        value={lastManualCheckpointLabel ?? ""}
      />
    </div>
  );
}

export default MainShell;
