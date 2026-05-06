import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import { RecoveryPanel, type RecoveryPanelProps } from "./RecoveryPanel";

interface RecoverySlideInProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recovery: RecoveryPanelProps;
}

export function RecoverySlideIn({ open, onOpenChange, recovery }: RecoverySlideInProps) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  return (
    <>
      <div
        aria-hidden
        onClick={() => onOpenChange(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        data-testid="recovery-slide-in-backdrop"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("topbar.recovery_slide_title")}
        data-testid="recovery-slide-in"
        data-open={open ? "true" : "false"}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[420px] max-w-full flex-col border-l bg-bg-panel text-fg shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-base font-bold">{t("topbar.recovery_slide_title")}</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("topbar.recovery_slide_close_aria")}
            data-testid="recovery-slide-in-close"
            className="rounded p-1 hover:bg-bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RecoveryPanel {...recovery} />
        </div>
      </aside>
    </>
  );
}
