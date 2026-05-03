import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useSlideInStore } from "../../stores/slideIn";
import type { SlideInTab } from "./types";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { CodeTab } from "./CodeTab";
import { PreviewTab } from "./PreviewTab";
import { TerminalTab } from "./TerminalTab";

const TABS: { id: SlideInTab; label: string }[] = [
  { id: "code", label: "코드" },
  { id: "preview", label: "미리보기" },
  { id: "terminal", label: "터미널" },
];

export function SlideInPanel() {
  const isOpen = useSlideInStore((s) => s.isOpen);
  const activeTab = useSlideInStore((s) => s.activeTab);
  const setActiveTab = useSlideInStore((s) => s.setActiveTab);
  const close = useSlideInStore((s) => s.close);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => firstTabRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  return (
    <aside
      ref={panelRef}
      className={cn(
        "fixed right-0 top-0 z-40 flex h-full w-[520px] flex-col border-l bg-bg shadow-xl",
        "transition-transform duration-slide ease-out motion-reduce:duration-0",
        isOpen ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
      role="dialog"
      aria-modal="false"
      aria-labelledby="slide-in-title"
      data-testid="slide-in-panel"
      data-open={isOpen ? "true" : "false"}
    >
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h2 id="slide-in-title" className="text-sm font-semibold text-fg">
          코드 / 미리보기 / 터미널
        </h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label="패널 닫기"
          onClick={close}
          data-testid="slide-in-close"
        >
          <X />
        </Button>
      </header>

      <nav className="flex border-b bg-bg-panel" role="tablist" aria-label="슬라이드 인 탭">
        {TABS.map((t, idx) => {
          const selected = activeTab === t.id;
          return (
            <button
              key={t.id}
              ref={idx === 0 ? firstTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`slide-in-panel-${t.id}`}
              data-testid="slide-in-tab"
              data-tab={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "relative px-4 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div
        className="flex-1 min-h-0 overflow-hidden"
        id={`slide-in-panel-${activeTab}`}
        role="tabpanel"
      >
        {activeTab === "code" ? <CodeTab /> : null}
        {activeTab === "preview" ? <PreviewTab /> : null}
        {activeTab === "terminal" ? <TerminalTab /> : null}
      </div>
    </aside>
  );
}

export default SlideInPanel;
