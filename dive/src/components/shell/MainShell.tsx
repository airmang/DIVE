import { useCallback, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea, type ChatStageBanner } from "./ChatArea";
import { WorkmapStrip } from "./WorkmapStrip";
import { SlideInPanel } from "../slide-in/SlideInPanel";
import { AiAssistDialog } from "../workmap/AiAssistDialog";
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
import type { CardState, CardTileData } from "../workmap/types";
import type { ChangedFile } from "../slide-in/types";
import { getCardStateMeta } from "../workmap/card-state-meta";

const DEMO_CHANGED_FILES: ChangedFile[] = [
  {
    path: "src/App.tsx",
    diff: {
      path: "src/App.tsx",
      before: "function App() {\n  return <div>old</div>;\n}\n",
      after: "function App() {\n  return <div>new feature</div>;\n}\n",
    },
  },
];

const TRANSITION_TO_STATE: Record<CardTransitionKind, CardState> = {
  enter_instruct: "instructed",
  request_verify: "verifying",
  approve: "verified",
  reject: "rejected",
  reopen_from_reject: "instructed",
  extend: "extended",
};

export function MainShell() {
  const [workmapCollapsed, setWorkmapCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [verifyLogs, setVerifyLogs] = useState<Record<number, VerifyLogView | null>>({});
  const [verifyStates, setVerifyStates] = useState<Record<number, "idle" | "running" | "error">>(
    {},
  );
  const [verifyErrors, setVerifyErrors] = useState<Record<number, string | null>>({});

  const cards = useWorkmapStore((s) => s.cards);
  const addCards = useWorkmapStore((s) => s.addCards);
  const currentCard = useWorkmapStore(selectCurrentCard);
  const currentCardId = useWorkmapStore((s) => s.currentCardId);
  const setCurrentCard = useWorkmapStore((s) => s.setCurrentCard);
  const transitionCard = useWorkmapStore((s) => s.transitionCard);
  const setInstruction = useWorkmapStore((s) => s.setInstruction);
  const canChat = useWorkmapStore(selectCanChat);
  const allVerified = useWorkmapStore(selectAllCardsVerified);

  const openSlideIn = useSlideInStore((s) => s.open);

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
          message: "모든 카드 완료 — E 단계: 새 카드 추가 또는 세션 종료",
        };
      }
      return {
        tone: "info",
        message: "작업할 카드를 선택하세요.",
      };
    }
    if (active.state === "decomposed") {
      return { tone: "warn", message: "카드에 지시를 작성해 I 단계로 진입하세요." };
    }
    if (active.state === "instructed") {
      const hasInstruction = (active.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return { tone: "warn", message: "카드에 지시를 작성해 주세요." };
      }
      return { tone: "info", message: "I 단계: 지시대로 작업을 진행합니다." };
    }
    if (active.state === "verifying") {
      return { tone: "info", message: "V 단계: 검증 진행 중 — 결과를 확인하세요." };
    }
    if (active.state === "rejected") {
      return { tone: "warn", message: "거부된 카드 — 지시를 수정해 다시 시작하세요." };
    }
    if (active.state === "verified") {
      return { tone: "success", message: "검증 완료 — 코드를 확인하거나 다음 카드로 이동하세요." };
    }
    return { tone: "success", message: "확장 완료 (E)" };
  }, [cards.length, currentCard, allVerified]);

  const inputBlocked = useMemo(() => {
    if (!canChat) {
      return { reason: "먼저 워크맵에 카드를 추가하세요. (D 단계 게이트)" };
    }
    if (stage === "i" && currentCard) {
      const hasInstruction = (currentCard.summary ?? "").trim().length > 0;
      if (!hasInstruction) {
        return { reason: "카드에 지시를 작성해 주세요. (I 단계 게이트)" };
      }
    }
    if (stage === "v" && currentCard?.state !== "verifying") {
      return { reason: "검증 단계가 아닙니다. (V 단계 게이트)" };
    }
    return null;
  }, [canChat, stage, currentCard]);

  const handleCardClick = (card: CardTileData) => {
    if (card.state === "verified" || card.state === "extended") {
      setCurrentCard(card.id);
      openSlideIn({
        tab: "code",
        files: DEMO_CHANGED_FILES,
        replaceFiles: true,
      });
      return;
    }
    setCurrentCard(card.id);
    setDetailOpen(true);
  };

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setCurrentCard(null);
    }
  };

  const handleInstructionChange = (cardId: number, instruction: string) => {
    setInstruction(cardId, instruction);
  };

  const handleTransition = (
    cardId: number,
    transition: CardTransitionKind,
    _options?: { approveForce?: boolean },
  ) => {
    const nextState = TRANSITION_TO_STATE[transition];
    transitionCard(cardId, nextState);
  };

  const handleVerify = useCallback(async (cardId: number) => {
    setVerifyStates((s) => ({ ...s, [cardId]: "running" }));
    setVerifyErrors((s) => ({ ...s, [cardId]: null }));
    await new Promise((r) => setTimeout(r, 450));
    const mock: VerifyLogView = {
      intent_match: true,
      test_result: "skipped",
      details:
        "[데모] 지시와 변경된 파일이 일치하는 것으로 보입니다. 실제 LLM 호출은 Tauri 런타임에서만 이루어집니다.",
      model: "mock-claude-3-5-sonnet",
      ran_at: Date.now(),
    };
    setVerifyLogs((s) => ({ ...s, [cardId]: mock }));
    setVerifyStates((s) => ({ ...s, [cardId]: "idle" }));
  }, []);

  const handleOpenCodeForCard = (_cardId: number) => {
    openSlideIn({
      tab: "code",
      files: DEMO_CHANGED_FILES,
      replaceFiles: true,
    });
  };

  const cardStateLabel = currentCard ? getCardStateMeta(currentCard.state).label : null;
  const currentVerifyLog = currentCard ? (verifyLogs[currentCard.id] ?? null) : null;
  const currentVerifyState: "idle" | "running" | "error" = currentCard
    ? (verifyStates[currentCard.id] ?? "idle")
    : "idle";
  const currentVerifyError = currentCard ? (verifyErrors[currentCard.id] ?? null) : null;

  return (
    <div className="relative h-screen w-screen grid grid-cols-[280px_1fr] grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg">
      <Sidebar className="row-start-1 col-start-1 min-h-0" />
      <ChatArea
        className="row-start-1 col-start-2 min-h-0 min-w-0"
        cardTitle={currentCard ? currentCard.title : null}
        cardStateLabel={cardStateLabel}
        stageBanner={stageBanner}
        onOpenSlidePanel={() => openSlideIn({ tab: "code" })}
        inputBlocked={inputBlocked}
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
        onAccept={(nextCards) => addCards(nextCards)}
        positionStart={cards.length + 1}
      />
      <CardDetailPanel
        open={detailOpen}
        card={currentCard}
        toolCallCount={currentCard ? simulateToolCallCount(currentCard) : 0}
        verifyLog={currentVerifyLog}
        verifyState={currentVerifyState}
        verifyError={currentVerifyError}
        onOpenChange={handleDetailOpenChange}
        onInstructionChange={handleInstructionChange}
        onTransition={handleTransition}
        onVerify={handleVerify}
        onOpenCode={handleOpenCodeForCard}
      />
      <input type="hidden" data-testid="current-stage" value={stage} />
      <input type="hidden" data-testid="current-card-id" value={currentCardId ?? ""} />
    </div>
  );
}

function simulateToolCallCount(card: CardTileData): number {
  if (card.state === "decomposed") return 0;
  if (card.state === "instructed") return 1;
  return 2;
}

export default MainShell;
