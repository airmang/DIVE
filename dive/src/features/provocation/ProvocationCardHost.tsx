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
 *
 * The exposure pins the log scope (context + mode) it was shown under, so a
 * parent that swaps card and context in one commit (StepDetailSlideIn moving
 * from step A to step B) still logs card A's close under step A's session.
 */
interface CardExposure {
  card: ProvocationCardData;
  exposureId: string;
  shownAt: number;
  responded: boolean;
  scope: LogScope;
}

interface LogScope {
  context?: Partial<ProvocationContext>;
  mode: SupervisorSourceUiMode;
}

/** Text the student reads as the card's question; a change is a new exposure. */
function shownQuestion(card: ProvocationCardData): string {
  return card.prompt?.trim() ?? "";
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
  const pendingUnmountRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleCards = useMemo(
    () => sortProvocationCards(cards).filter((card) => !dismissed.has(card.id)),
    [cards, dismissed],
  );
  const primary = selectPrimaryProvocationCard(visibleCards);

  // Ends the open exposure. Emits `card_unanswered` only when nothing was
  // answered, and clears the exposure first so no path can emit twice.
  const closeExposure = useCallback((reason: ProvocationUnansweredReason) => {
    const exposure = exposureRef.current;
    exposureRef.current = null;
    if (!exposure || exposure.responded) return;
    logQuietly({
      eventType: "provocation.card_unanswered",
      card: exposure.card,
      ...exposure.scope,
      exposureId: exposure.exposureId,
      visibleMs: Math.max(0, Date.now() - exposure.shownAt),
      unansweredReason: reason,
    });
  }, []);

  // `context`/`mode` matter only when an exposure opens (they are pinned on
  // it); a context-only change re-runs this effect but keeps the exposure.
  useEffect(() => {
    const current = exposureRef.current;
    if (
      current &&
      primary &&
      current.card.id === primary.id &&
      shownQuestion(current.card) === shownQuestion(primary)
    ) {
      current.card = primary;
      return;
    }
    // A different card, or the same card id now asking a different question,
    // replaces the open exposure; no card at all removes it.
    if (current) closeExposure(primary ? "replaced" : "removed");
    if (!primary) return;
    const exposure: CardExposure = {
      card: primary,
      exposureId: newExposureId(),
      shownAt: Date.now(),
      responded: false,
      scope: { context, mode },
    };
    exposureRef.current = exposure;
    logQuietly({
      eventType: "provocation.card_shown",
      card: primary,
      ...exposure.scope,
      exposureId: exposure.exposureId,
    });
  }, [closeExposure, context, mode, primary]);

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

  // Marks the open exposure answered and returns its logging fields. The
  // exposure's pinned project/session keep every event of one exposure in the
  // same session; the rest of the context stays current so a response still
  // records the verification state at the moment the student answered.
  const respond = (): Pick<
    ProvocationLogInput,
    "context" | "mode" | "exposureId" | "responseLatencyMs"
  > => {
    const exposure = exposureRef.current;
    if (!exposure || exposure.card.id !== primary.id) {
      return { context, mode, exposureId: undefined, responseLatencyMs: null };
    }
    exposure.responded = true;
    return {
      context: {
        ...context,
        projectId: exposure.scope.context?.projectId,
        sessionId: exposure.scope.context?.sessionId,
      },
      mode: exposure.scope.mode,
      exposureId: exposure.exposureId,
      responseLatencyMs: Math.max(0, Date.now() - exposure.shownAt),
    };
  };

  const dismiss = () => {
    const response = respond();
    setDismissed((prev) => new Set(prev).add(primary.id));
    onHandled?.(primary);
    logQuietly({ eventType: "provocation.dismissed", card: primary, ...response });
  };

  const markIrrelevant = () => {
    const response = respond();
    setDismissed((prev) => new Set(prev).add(primary.id));
    onHandled?.(primary);
    logQuietly({ eventType: "provocation.marked_irrelevant", card: primary, ...response });
  };

  const act = (action: ProvocationAction, reason?: string) => {
    logQuietly({
      eventType:
        action.kind === "continue_with_risk"
          ? "provocation.continued_with_risk"
          : "provocation.action_clicked",
      card: primary,
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
