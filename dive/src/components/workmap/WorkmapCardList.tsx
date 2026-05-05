import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { LearningHint } from "../ui/learning-hint";
import { CardTile } from "./CardTile";
import type { CardTileData, CardTileMode, WorkmapCardListProps } from "./types";

const CARD_WIDTH = 200;
const GAP_PX = 12;
const SCROLL_STEP = CARD_WIDTH + GAP_PX;

function useScrollBounds(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setCanScrollLeft(!atStart);
    setCanScrollRight(!atEnd && el.scrollWidth > el.clientWidth);
  }, [ref]);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { canScrollLeft, canScrollRight, update };
}

function sortCards(cards: CardTileData[]): CardTileData[] {
  return [...cards].sort((a, b) => a.position - b.position);
}

function addCardButtonSizeClasses(mode: CardTileMode): string {
  return mode === "expanded" ? "h-[130px] w-[200px]" : "h-9 w-[200px]";
}

export function WorkmapCardList({
  cards,
  mode,
  canAddCard = false,
  onAddCard,
  onCardClick,
}: WorkmapCardListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sorted = sortCards(cards);

  const { canScrollLeft, canScrollRight } = useScrollBounds(scrollRef, [
    sorted.length,
    mode,
    canAddCard,
  ]);

  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const handleAddClick = () => {
    if (!canAddCard) return;
    onAddCard?.();
  };

  const addDisabledTitle = canAddCard
    ? undefined
    : "단계를 추가하려면 프로젝트와 세션을 먼저 준비하세요";

  return (
    <div className="relative flex h-full w-full items-center" data-testid="workmap-card-list">
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-6",
          "bg-gradient-to-r from-bg-panel to-transparent transition-opacity",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-6",
          "bg-gradient-to-l from-bg-panel to-transparent transition-opacity",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />

      <button
        type="button"
        onClick={() => scrollBy(-SCROLL_STEP)}
        disabled={!canScrollLeft}
        aria-label="이전 단계로 스크롤"
        data-testid="workmap-scroll-prev"
        className={cn(
          "absolute left-1 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center",
          "rounded-full border bg-bg-panel text-fg transition-opacity",
          "hover:bg-bg-panel2 focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:pointer-events-none disabled:opacity-0",
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => scrollBy(SCROLL_STEP)}
        disabled={!canScrollRight}
        aria-label="다음 단계로 스크롤"
        data-testid="workmap-scroll-next"
        className={cn(
          "absolute right-1 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center",
          "rounded-full border bg-bg-panel text-fg transition-opacity",
          "hover:bg-bg-panel2 focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:pointer-events-none disabled:opacity-0",
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <div
        ref={scrollRef}
        data-testid="workmap-scroll-container"
        className={cn(
          "flex h-full w-full items-center gap-3 overflow-x-auto overflow-y-hidden px-1 pb-1",
          "motion-safe:scroll-smooth",
        )}
        style={{ scrollSnapType: "x proximity" }}
      >
        {sorted.map((card) => (
          <CardTile key={card.id} card={card} mode={mode} onClick={onCardClick} />
        ))}

        <button
          type="button"
          onClick={handleAddClick}
          disabled={!canAddCard}
          aria-label="단계 추가"
          title={addDisabledTitle}
          data-testid="workmap-add-card"
          data-enabled={canAddCard ? "true" : "false"}
          className={cn(
            "flex shrink-0 items-center justify-center gap-2 rounded-md border-2 border-dashed",
            "border-border text-fg-muted transition-colors",
            "hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-fg-muted",
            addCardButtonSizeClasses(mode),
          )}
          style={{ scrollSnapAlign: "start" }}
        >
          <Plus className={mode === "expanded" ? "h-5 w-5" : "h-4 w-4"} />
          <span className={mode === "expanded" ? "text-sm" : "text-xs"}>단계 추가</span>
        </button>
        {!canAddCard ? (
          <LearningHint inline className="shrink-0 text-[10px]">
            단계를 추가하려면 프로젝트와 세션을 먼저 준비하세요
          </LearningHint>
        ) : null}
      </div>
    </div>
  );
}

export default WorkmapCardList;
