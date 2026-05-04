import { cn } from "../../lib/utils";
import { getCardStateMeta } from "./card-state-meta";
import type { CardState, CardTileMode } from "./types";

interface CardStateBadgeProps {
  state: CardState;
  mode: CardTileMode;
  className?: string;
}

export function CardStateBadge({ state, mode, className }: CardStateBadgeProps) {
  const meta = getCardStateMeta(state);
  const Icon = meta.icon;
  const size = mode === "expanded" ? "w-4 h-4" : "w-3.5 h-3.5";
  const wrap = mode === "expanded" ? "h-6 w-6 rounded-md" : "h-5 w-5 rounded";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        wrap,
        meta.iconBgClass,
        className,
      )}
      aria-hidden
    >
      <Icon
        className={cn(
          size,
          meta.iconFgClass,
          meta.animate && "animate-spin motion-reduce:animate-none",
        )}
      />
    </span>
  );
}

export default CardStateBadge;
