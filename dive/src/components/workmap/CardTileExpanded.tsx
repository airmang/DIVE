import { cn } from "../../lib/utils";
import { getCardStateMeta } from "./card-state-meta";
import { CardStateBadge } from "./CardStateBadge";
import { useT } from "../../i18n";
import type { CardTileData } from "./types";

interface CardTileExpandedProps {
  card: CardTileData;
  disabled?: boolean;
  onClick?: (card: CardTileData) => void;
}

export function CardTileExpanded({ card, disabled, onClick }: CardTileExpandedProps) {
  const t = useT();
  const meta = getCardStateMeta(card.state);
  const summary = card.summary ?? t(meta.defaultSummaryKey);

  return (
    <button
      type="button"
      onClick={() => onClick?.(card)}
      disabled={disabled}
      aria-label={`${card.title} — ${t(meta.labelKey)}`}
      data-testid="card-tile"
      data-card-id={card.id}
      data-card-state={card.state}
      data-mode="expanded"
      className={cn(
        "group relative flex h-[130px] w-[200px] shrink-0 flex-col overflow-hidden rounded-md",
        "border bg-bg-panel2 text-left transition-colors",
        "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
      style={{ scrollSnapAlign: "start" }}
    >
      <span
        aria-hidden
        data-testid="card-color-bar"
        className={cn("absolute left-0 top-0 bottom-0 w-1", meta.barClass)}
      />

      <div className="flex items-center gap-2 px-3 pl-4 pr-3 pt-3">
        <CardStateBadge state={card.state} mode="expanded" />
        <span className="truncate text-sm font-bold text-fg">{card.title}</span>
      </div>

      <p className="mt-auto truncate px-3 pb-3 pl-4 text-xs text-fg-muted">{summary}</p>
    </button>
  );
}

export default CardTileExpanded;
