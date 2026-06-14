import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useSlideInStore } from "../../stores/slideIn";
import type { SlideInTab } from "./types";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { CodeTab } from "./CodeTab";
import { PreviewTab } from "./PreviewTab";
import { TerminalTab } from "./TerminalTab";
import { LearningHint } from "../ui/learning-hint";
import { useT } from "../../i18n";

const TABS: { id: SlideInTab; labelKey: string }[] = [
  { id: "code", labelKey: "slide_in.tabs.code" },
  { id: "preview", labelKey: "slide_in.tabs.preview" },
  { id: "terminal", labelKey: "slide_in.tabs.terminal" },
];

export function SlideInPanel() {
  const t = useT();
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
        "fixed right-0 top-0 z-[60] flex h-full w-[520px] flex-col border-l bg-bg shadow-xl",
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
          {t("slide_in.panel_title")}
        </h2>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("slide_in.close_aria")}
          onClick={close}
          data-testid="slide-in-close"
        >
          <X />
        </Button>
      </header>
      <LearningHint className="border-b bg-bg-panel px-4 py-2 text-xs">
        {t("slide_in.hint")}
      </LearningHint>

      <nav
        className="flex border-b bg-bg-panel"
        role="tablist"
        aria-label={t("slide_in.tablist_aria")}
      >
        {TABS.map((tab, idx) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={idx === 0 ? firstTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`slide-in-panel-${tab.id}`}
              data-testid="slide-in-tab"
              data-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative px-4 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {t(tab.labelKey)}
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
