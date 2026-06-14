import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";
import { useProvocationCardsEnabled, useProvocationScaffoldMode } from "../../stores/ui-preferences";
import { useChatComposerStore } from "../../stores/chatComposer";
import {
  ProvocationCardHost,
  generateProvocationCards,
  type ProvocationCard,
  useProvocationActionResolver,
} from "../../features/provocation";

function terminalActionCard(card: ProvocationCard): ProvocationCard {
  if (card.type !== "regeneration_loop") return card;
  return {
    ...card,
    actions: card.actions.map((action) =>
      action.kind === "rollback_last_change"
        ? {
            ...action,
            disabledReason: "복구 경로 없음",
            todoId: "S-009-terminal-rollback",
          }
        : action,
    ),
  };
}

export function TerminalTab() {
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
    }).map(terminalActionCard);
  }, [lines, provocationEnabled, provocationMode]);

  const handleProvocationAction = useProvocationActionResolver({
    pushComposerSeed,
    onCreateReproSteps: () => {
      pushComposerSeed(
        "터미널의 반복 오류를 기준으로 재현 단계, 가장 작은 확인 명령, 마지막 변경에서 볼 부분을 정리해줘.",
      );
      setActionStatus("채팅 입력창에 재현 단계 정리 요청을 채웠습니다.");
    },
    onSplitScope: () => {
      pushComposerSeed("터미널 오류를 더 작은 범위 하나로 줄여서 다시 요청할 문장을 만들어줘.");
      setActionStatus("채팅 입력창에 범위 축소 요청을 채웠습니다.");
    },
    onRetryWithAi: () => {
      pushComposerSeed(
        "복구 지점, 재현 단계, 범위 축소 여부를 먼저 확인한 뒤 터미널의 같은 실패를 피해서 다시 고쳐줘.",
      );
      setActionStatus("채팅 입력창에 recovery-first 재시도 요청을 채웠습니다.");
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
        <span className="text-fg-muted">터미널 — {lines.length}줄</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={clear}
          disabled={lines.length === 0}
          data-testid="terminal-clear"
        >
          지우기
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
          <p className="text-xs text-fg-muted">출력이 없습니다.</p>
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
