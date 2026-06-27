import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import { logProvocationEvent } from "./logging";
import {
  selectPrimaryProvocationCard,
  shouldShowProvocationCardInMode,
  sortProvocationCards,
} from "./priority";
import { ProvocationCard } from "./ProvocationCard";
import type {
  ProvocationAction,
  ProvocationCard as ProvocationCardData,
  ProvocationContext,
  SupervisorSourceUiMode,
} from "./types";

interface ProvocationCardHostProps {
  cards: ProvocationCardData[];
  context?: Partial<ProvocationContext>;
  mode: SupervisorSourceUiMode;
  className?: string;
  onAction?: (action: ProvocationAction, card: ProvocationCardData, reason?: string) => void;
  onHandled?: (card: ProvocationCardData) => void;
}

export function ProvocationCardHost({
  cards,
  context,
  mode,
  className,
  onAction,
  onHandled,
}: ProvocationCardHostProps) {
  const t = useT();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const shownRef = useRef<Set<string>>(new Set());
  const visibleCards = useMemo(
    () =>
      sortProvocationCards(cards).filter(
        (card) => !dismissed.has(card.id) && shouldShowProvocationCardInMode(card, mode),
      ),
    [cards, dismissed, mode],
  );
  const primary = selectPrimaryProvocationCard(visibleCards);

  useEffect(() => {
    if (!primary || shownRef.current.has(primary.id)) return;
    shownRef.current.add(primary.id);
    void logProvocationEvent({
      eventType: "provocation.card_shown",
      card: primary,
      context,
      mode,
    }).catch((err) => console.warn("provocation log failed:", err));
  }, [context, mode, primary]);

  if (!primary) return null;

  const dismiss = () => {
    setDismissed((prev) => new Set(prev).add(primary.id));
    onHandled?.(primary);
    void logProvocationEvent({
      eventType: "provocation.dismissed",
      card: primary,
      context,
      mode,
    }).catch((err) => console.warn("provocation log failed:", err));
  };

  const markIrrelevant = () => {
    setDismissed((prev) => new Set(prev).add(primary.id));
    onHandled?.(primary);
    void logProvocationEvent({
      eventType: "provocation.marked_irrelevant",
      card: primary,
      context,
      mode,
    }).catch((err) => console.warn("provocation log failed:", err));
  };

  const act = (action: ProvocationAction, reason?: string) => {
    void logProvocationEvent({
      eventType:
        action.kind === "continue_with_risk"
          ? "provocation.continued_with_risk"
          : "provocation.action_clicked",
      card: primary,
      context,
      mode,
      action,
      reason,
    }).catch((err) => console.warn("provocation log failed:", err));
    onAction?.(action, primary, reason);
  };

  const canDismissOrMarkIrrelevant = primary.severity !== "risk";

  return (
    <div className={cn("space-y-2", className)} data-testid="provocation-host">
      <ProvocationCard
        card={primary}
        mode={mode}
        onAction={act}
        {...(canDismissOrMarkIrrelevant
          ? { onDismiss: dismiss, onMarkIrrelevant: markIrrelevant }
          : {})}
      />
      {visibleCards.length > 1 ? (
        <p className="text-[11px] text-fg-muted" data-testid="provocation-secondary-count">
          {t("provocation_action.more_to_review", { count: visibleCards.length - 1 })}
        </p>
      ) : null}
    </div>
  );
}

export default ProvocationCardHost;
