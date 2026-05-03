import { useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "./ChatArea";
import { WorkmapStrip } from "./WorkmapStrip";
import { SlideInPanel } from "../slide-in/SlideInPanel";
import { AiAssistDialog } from "../workmap/AiAssistDialog";
import { useSlideInStore } from "../../stores/slideIn";
import { selectCanChat, useWorkmapStore } from "../../stores/workmap";
import type { CardTileData } from "../workmap/types";
import type { ChangedFile } from "../slide-in/types";

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

export function MainShell() {
  const [workmapCollapsed, setWorkmapCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const cards = useWorkmapStore((s) => s.cards);
  const addCards = useWorkmapStore((s) => s.addCards);
  const canChat = useWorkmapStore(selectCanChat);

  const openSlideIn = useSlideInStore((s) => s.open);

  const inputBlocked = useMemo(
    () =>
      canChat
        ? null
        : {
            reason: "먼저 워크맵에 카드를 추가하세요. (D 단계 게이트)",
          },
    [canChat],
  );

  const handleCardClick = (card: CardTileData) => {
    if (card.state === "verified" || card.state === "extended") {
      openSlideIn({
        tab: "code",
        files: DEMO_CHANGED_FILES,
        replaceFiles: true,
      });
    }
  };

  return (
    <div className="relative h-screen w-screen grid grid-cols-[280px_1fr] grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg">
      <Sidebar className="row-start-1 col-start-1 min-h-0" />
      <ChatArea
        className="row-start-1 col-start-2 min-h-0 min-w-0"
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
    </div>
  );
}

export default MainShell;
