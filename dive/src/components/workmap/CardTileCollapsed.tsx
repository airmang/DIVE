import { cn } from "../../lib/utils";
import { getCardStateMeta } from "./card-state-meta";
import { CardStateBadge } from "./CardStateBadge";
import { useT } from "../../i18n";
import type { CardTileData } from "./types";

interface CardTileCollapsedProps {
  card: CardTileData;
  disabled?: boolean;
  onClick?: (card: CardTileData) => void;
}

export function CardTileCollapsed({ card, disabled, onClick }: CardTileCollapsedProps) {
  const t = useT();
  const meta = getCardStateMeta(card.state);

  return (
    <button
      type="button"
      onClick={() => onClick?.(card)}
      disabled={disabled}
      aria-label={`${card.title} — ${t(meta.labelKey)}`}
      data-testid="card-tile"
      data-card-id={card.id}
      data-card-state={card.state}
      data-mode="collapsed"
      className={cn(
        "relative grid h-9 w-[200px] shrink-0 items-center gap-2 overflow-hidden rounded-md",
        "grid-cols-[3px_20px_1fr] border bg-bg-panel2 pl-0 pr-2 text-left transition-colors",
        "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      style={{ scrollSnapAlign: "start" }}
    >
      <span aria-hidden data-testid="card-color-bar" className={cn("h-full", meta.barClass)} />
      <CardStateBadge state={card.state} mode="collapsed" className="ml-1" />
      <span className="truncate text-xs text-fg">{card.title}</span>
    </button>
  );
}

export default CardTileCollapsed;
