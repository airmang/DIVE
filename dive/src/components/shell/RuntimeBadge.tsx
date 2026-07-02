import { AlertTriangle, Cpu, ShieldCheck } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import type { RuntimeSelection } from "../../hooks/useChatSession";

interface RuntimeBadgeProps {
  className?: string;
  selection?: RuntimeSelection | null;
}

/**
 * Names DIVE's execution model in the cockpit: the agent runs in a *supervised*
 * runtime where every tool action needs the learner's approval. This is the core
 * teaching frame — the student supervises an autonomous runtime — so it lives
 * persistently in the chat header, with the full explanation in the tooltip.
 */
export function RuntimeBadge({ className, selection = null }: RuntimeBadgeProps) {
  const t = useT();
  const isUnavailable = selection?.state === "unavailable";
  const runtimeLabel = selection
    ? isUnavailable
      ? t("runtime.capability.unavailable_label")
      : t("runtime.capability.ready_label")
    : null;
  const capabilityMessage = selection?.message || selection?.reason || "";
  const tooltip = !selection
    ? t("runtime.supervised_tooltip")
    : isUnavailable
      ? t("runtime.capability.unavailable_tooltip", {
          message: capabilityMessage,
          provider: selection.provider,
          model: selection.model,
        })
      : t("runtime.selected_tooltip", {
          runtime: runtimeLabel ?? t("runtime.capability.ready_label"),
          provider: selection.provider,
          model: selection.model,
          reason: selection.reason,
        });
  const StatusIcon = isUnavailable ? AlertTriangle : Cpu;
  return (
    <span
      tabIndex={0}
      role="note"
      title={tooltip}
      aria-label={tooltip}
      data-testid="runtime-badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wide",
        isUnavailable
          ? "border-warn/50 bg-warn/10 text-warn"
          : "border-accent/40 bg-accent-subtle text-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden />
      {t("runtime.supervised_label")}
      {runtimeLabel ? (
        <>
          <span className={cn(isUnavailable ? "text-warn/70" : "text-accent/60")} aria-hidden>
            ·
          </span>
          <StatusIcon className="h-3 w-3" aria-hidden />
          <span data-testid="runtime-selected-label">{runtimeLabel}</span>
        </>
      ) : null}
    </span>
  );
}

export default RuntimeBadge;
