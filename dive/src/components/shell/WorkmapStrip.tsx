import { ChevronDown, ChevronUp, Plus, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { WorkmapCardList } from "../workmap/WorkmapCardList";
import type { CardTileData } from "../workmap/types";
import { useT } from "../../i18n";

interface WorkmapStripProps {
  className?: string;
  collapsed: boolean;
  onToggle: () => void;
  cards?: CardTileData[];
  canAddCard?: boolean;
  onAddCard?: () => void;
  onCardClick?: (card: CardTileData) => void;
  onRequestAiAssist?: () => void;
}

const EXPANDED_HEIGHT = 220;
const COLLAPSED_HEIGHT = 80;

export function WorkmapStrip({
  className,
  collapsed,
  onToggle,
  cards = [],
  canAddCard = false,
  onAddCard,
  onCardClick,
  onRequestAiAssist,
}: WorkmapStripProps) {
  const t = useT();
  const height = collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT;
  const mode = collapsed ? "collapsed" : "expanded";

  const total = cards.length;
  const completed = cards.filter((c) => c.stagesCompleted.e).length;
  const progressPercent =
    total > 0
      ? Math.round(
          (cards.reduce((sum, c) => {
            const s = c.stagesCompleted;
            const weight = s.e ? 1 : s.v ? 0.75 : s.i ? 0.5 : s.d ? 0.25 : 0;
            return sum + weight;
          }, 0) /
            total) *
            100,
        )
      : 0;

  const handleHeaderAdd = () => {
    if (!canAddCard) return;
    onAddCard?.();
  };

  return (
    <section
      data-testid="workmap-strip"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="워크맵"
      className={cn(
        "flex flex-col overflow-hidden border-t bg-bg-panel",
        "transition-[height] duration-200 ease-out motion-reduce:transition-none",
        className,
      )}
      style={{ height }}
    >
      <header className="flex h-10 shrink-0 items-center gap-3 px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-fg">워크맵</h2>
          <span className="text-xs text-fg-muted" data-testid="workmap-progress-label">
            {completed}/{total} · {progressPercent}%
          </span>
        </div>

        <div
          className="relative h-1.5 max-w-md flex-1 overflow-hidden rounded-full bg-bg-panel2"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="워크맵 진행률"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleHeaderAdd}
            disabled={!canAddCard}
            aria-label={canAddCard ? "카드 추가" : "카드 추가 (D 단계에서만 가능)"}
          >
            <Plus />
            카드 추가
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            aria-label={collapsed ? "워크맵 펼치기" : "워크맵 접기"}
            aria-expanded={!collapsed}
            aria-controls="workmap-body"
            data-testid="workmap-toggle"
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </header>

      {cards.length > 0 ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-1.5",
            collapsed && "hidden",
          )}
          data-testid="workmap-minimap"
          aria-label={t("workmap.minimap_label")}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
            DIVE
          </span>
          <div
            className="grid flex-1 gap-1"
            style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}
          >
            {cards.map((card) => {
              const doneStages = [
                card.stagesCompleted.d,
                card.stagesCompleted.i,
                card.stagesCompleted.v,
                card.stagesCompleted.e,
              ].filter(Boolean).length;
              return (
                <button
                  key={card.id}
                  type="button"
                  className="group flex min-w-0 flex-col gap-0.5 rounded px-1 py-0.5 text-left hover:bg-bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onCardClick?.(card)}
                  title={`${card.position}. ${card.title}`}
                  data-testid="workmap-minimap-card"
                  data-state={card.state}
                >
                  <span className="h-1 overflow-hidden rounded-full bg-bg-panel2">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-200"
                      style={{ width: `${(doneStages / 4) * 100}%` }}
                    />
                  </span>
                  <span className="truncate text-[10px] text-fg-muted group-hover:text-fg">
                    {card.position}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        id="workmap-body"
        aria-hidden={collapsed}
        className={cn(
          "relative flex-1 overflow-hidden px-4 pb-3",
          collapsed && "pointer-events-none invisible",
        )}
      >
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-fg-muted">
              아직 카드가 없습니다. D 단계에서 작업을 분해해 카드를 만드세요.
            </p>
            {onRequestAiAssist ? (
              <Button
                size="sm"
                variant="primary"
                onClick={onRequestAiAssist}
                data-testid="workmap-ai-assist"
              >
                <Sparkles />
                AI 도움 받기
              </Button>
            ) : null}
          </div>
        ) : (
          <WorkmapCardList
            cards={cards}
            mode={mode}
            canAddCard={canAddCard}
            onAddCard={onAddCard}
            onCardClick={onCardClick}
          />
        )}
      </div>
    </section>
  );
}

export default WorkmapStrip;
