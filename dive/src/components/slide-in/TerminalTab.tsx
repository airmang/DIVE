import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";
import {
  useProvocationCardsEnabled,
  useProvocationScaffoldMode,
} from "../../stores/ui-preferences";
import { useChatComposerStore } from "../../stores/chatComposer";
import {
  ProvocationCardHost,
  type ProvocationCard,
  useProvocationActionResolver,
} from "../../features/provocation";
import { generateProvocationCards } from "../../features/provocation/rules";
import { useT } from "../../i18n";

function terminalActionCard(card: ProvocationCard, rollbackUnavailable: string): ProvocationCard {
  if (card.type !== "regeneration_loop") return card;
  return {
    ...card,
    actions: card.actions.map((action) =>
      action.kind === "rollback_last_change"
        ? {
            ...action,
            disabledReason: rollbackUnavailable,
            todoId: "S-009-terminal-rollback",
          }
        : action,
    ),
  };
}

export function TerminalTab() {
  const t = useT();
  const lines = useSlideInStore((s) => s.terminalLines);
  const clear = useSlideInStore((s) => s.clearTerminal);
  const provocationEnabled = useProvocationCardsEnabled();
  const provocationMode = useProvocationScaffoldMode();
  const pushComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const provocationCards = useMemo(() => {
    if (!provocationEnabled) return [];
    const recentErrors = lines
      .filter((line) => line.kind === "stderr")
      .slice(-12)
      .map((line) => ({
        message: line.text,
        normalizedMessage: line.text.replace(/\d+/g, "#"),
        occurredAt: new Date(line.timestamp).toISOString(),
      }));
    return generateProvocationCards({
      mode: provocationMode,
      stage: "execute",
      recentErrors,
    }).map((card) => terminalActionCard(card, t("slide_in.terminal.rollback_unavailable")));
  }, [lines, provocationEnabled, provocationMode, t]);

  const handleProvocationAction = useProvocationActionResolver({
    pushComposerSeed,
    onCreateReproSteps: () => {
      pushComposerSeed(t("slide_in.terminal.repro_seed"));
      setActionStatus(t("slide_in.terminal.repro_status"));
    },
    onSplitScope: () => {
      pushComposerSeed(t("slide_in.terminal.split_seed"));
      setActionStatus(t("slide_in.terminal.split_status"));
    },
    onRetryWithAi: () => {
      pushComposerSeed(t("slide_in.terminal.retry_seed"));
      setActionStatus(t("slide_in.terminal.retry_status"));
    },
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handle = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      autoScrollRef.current = distance <= 50;
    };
    el.addEventListener("scroll", handle, { passive: true });
    return () => el.removeEventListener("scroll", handle);
  }, []);

  useLayoutEffect(() => {
    if (autoScrollRef.current) {
      sentinelRef.current?.scrollIntoView({ block: "end" });
    }
  }, [lines]);

  return (
    <div className="flex h-full flex-col" data-testid="terminal-tab">
      <header className="flex items-center justify-between border-b bg-bg-panel2 px-3 py-1.5 text-xs">
        <span className="text-fg-muted">
          {t("slide_in.terminal.title", { count: lines.length })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={clear}
          disabled={lines.length === 0}
          data-testid="terminal-clear"
        >
          {t("slide_in.terminal.clear")}
        </Button>
      </header>
      <ProvocationCardHost
        className="border-b bg-bg-panel px-3 py-2"
        cards={provocationCards}
        context={{
          mode: provocationMode,
          stage: "execute",
        }}
        mode={provocationMode}
        onAction={handleProvocationAction}
      />
      {actionStatus ? (
        <p
          className="border-b border-border bg-bg-panel px-3 py-1.5 text-[11px] text-fg-muted"
          data-testid="terminal-provocation-action-status"
        >
          {actionStatus}
        </p>
      ) : null}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-bg px-3 py-2"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        data-testid="terminal-log"
      >
        {lines.length === 0 ? (
          <p className="text-xs text-fg-muted">{t("slide_in.terminal.empty")}</p>
        ) : (
          <pre className="font-mono text-xs leading-5">
            {lines.map((line) => {
              const color =
                line.kind === "stderr"
                  ? "text-danger"
                  : line.kind === "info"
                    ? "text-accent"
                    : "text-fg";
              return (
                <div
                  key={line.id}
                  className={color}
                  data-testid="terminal-line"
                  data-kind={line.kind}
                >
                  {line.text}
                </div>
              );
            })}
          </pre>
        )}
        <div ref={sentinelRef} aria-hidden />
      </div>
    </div>
  );
}
