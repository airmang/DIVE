import { ShieldCheck } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";

interface RuntimeBadgeProps {
  className?: string;
}

/**
 * Names DIVE's execution model in the cockpit: the agent runs in a *supervised*
 * runtime where every tool action needs the learner's approval. This is the core
 * teaching frame — the student supervises an autonomous runtime — so it lives
 * persistently in the chat header, with the full explanation in the tooltip.
 */
export function RuntimeBadge({ className }: RuntimeBadgeProps) {
  const t = useT();
  const tooltip = t("runtime.supervised_tooltip");
  return (
    <span
      tabIndex={0}
      role="note"
      title={tooltip}
      aria-label={tooltip}
      data-testid="runtime-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent-subtle px-2 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wide text-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden />
      {t("runtime.supervised_label")}
    </span>
  );
}

export default RuntimeBadge;
