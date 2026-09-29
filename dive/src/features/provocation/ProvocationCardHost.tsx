import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import {
  logProvocationEvent,
  type ProvocationLogInput,
  type ProvocationUnansweredReason,
} from "./logging";
import { selectPrimaryProvocationCard, sortProvocationCards } from "./priority";
import { ProvocationCard } from "./ProvocationCard";
import type {
  ProvocationAction,
  ProvocationCard as ProvocationCardData,
  ProvocationContext,
  SupervisorSourceUiMode,
} from "./types";

/**
 * One contiguous visibility period of the primary card in this host. Spec 015
 * FR-004 / SC-002: every exposure logs `card_shown` once and then exactly one
 * terminal event — the first response, or `card_unanswered` when the card
 * leaves view without one. Later responses on the same exposure are still
 * logged (with their latency) but never trigger `card_unanswered`.
 */
interface CardExposure {
  card: ProvocationCardData;
  exposureId: string;
  shownAt: number;
  responded: boolean;
}

function newExposureId(): string {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logQuietly(input: ProvocationLogInput) {
  void logProvocationEvent(input).catch((err) => console.warn("provocation log failed:", err));
}

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
  const exposureRef = useRef<CardExposure | null>(null);
  const logScopeRef = useRef({ context, mode });
  const pendingUnmountRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleCards = useMemo(
    () => sortProvocationCards(cards).filter((card) => !dismissed.has(card.id)),
    [cards, dismissed],
  );
  const primary = selectPrimaryProvocationCard(visibleCards);

  useEffect(() => {
    logScopeRef.current = { context, mode };
  }, [context, mode]);

  // Ends the open exposure. Emits `card_unanswered` only when nothing was
  // answered, and clears the exposure first so no path can emit twice.
  const closeExposure = useCallback((reason: ProvocationUnansweredReason) => {
    const exposure = exposureRef.current;
    exposureRef.current = null;
    if (!exposure || exposure.responded) return;
    logQuietly({
      eventType: "provocation.card_unanswered",
      card: exposure.card,
      ...logScopeRef.current,
      exposureId: exposure.exposureId,
      visibleMs: Math.max(0, Date.now() - exposure.shownAt),
      unansweredReason: reason,
    });
  }, []);

  useEffect(() => {
    const current = exposureRef.current;
    if (current && current.card.id === primary?.id) {
      current.card = primary;
      return;
    }
    if (current) closeExposure("superseded");
    if (!primary) return;
    const exposure: CardExposure = {
      card: primary,
      exposureId: newExposureId(),
      shownAt: Date.now(),
      responded: false,
    };
    exposureRef.current = exposure;
    logQuietly({
      eventType: "provocation.card_shown",
      card: primary,
      ...logScopeRef.current,
      exposureId: exposure.exposureId,
    });
  }, [closeExposure, primary]);

  // Unmount closes the exposure one tick later: React StrictMode (dev)
  // unmounts and immediately remounts every effect, and the remount cancels
  // the pending close, so a remount never double-counts an exposure.
  useEffect(() => {
    if (pendingUnmountRef.current !== null) {
      clearTimeout(pendingUnmountRef.current);
      pendingUnmountRef.current = null;
    }
    return () => {
      pendingUnmountRef.current = setTimeout(() => {
        pendingUnmountRef.current = null;
        closeExposure("unmounted");
      }, 0);
    };
  }, [closeExposure]);

  // Best-effort for app close / reload: the webview may be torn down before
  // the IPC write lands.
  useEffect(() => {
    const onPageHide = () => closeExposure("page_hidden");
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [closeExposure]);

  if (!primary) return null;

  // Marks the open exposure answered and returns its logging fields.
  const respond = (): Pick<ProvocationLogInput, "exposureId" | "responseLatencyMs"> => {
    const exposure = exposureRef.current;
    if (!exposure || exposure.card.id !== primary.id) {
      return { exposureId: undefined, responseLatencyMs: null };
    }
    exposure.responded = true;
    return {
      exposureId: exposure.exposureId,
      responseLatencyMs: Math.max(0, Date.now() - exposure.shownAt),
    };
  };

  const dismiss = () => {
    const exposure = respond();
    setDismissed((prev) => new Set(prev).add(primary.id));
    onHandled?.(primary);
    logQuietly({
      eventType: "provocation.dismissed",
      card: primary,
      context,
      mode,
      ...exposure,
    });
  };

  const markIrrelevant = () => {
    const exposure = respond();
    setDismissed((prev) => new Set(prev).add(primary.id));
    onHandled?.(primary);
    logQuietly({
      eventType: "provocation.marked_irrelevant",
      card: primary,
      context,
      mode,
      ...exposure,
    });
  };

  const act = (action: ProvocationAction, reason?: string) => {
    logQuietly({
      eventType:
        action.kind === "continue_with_risk"
          ? "provocation.continued_with_risk"
          : "provocation.action_clicked",
      card: primary,
      context,
      mode,
      action,
      reason,
      ...respond(),
    });
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
