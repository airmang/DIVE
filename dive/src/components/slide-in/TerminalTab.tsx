import { useEffect, useLayoutEffect, useRef } from "react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";

export function TerminalTab() {
  const lines = useSlideInStore((s) => s.terminalLines);
  const clear = useSlideInStore((s) => s.clearTerminal);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

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
