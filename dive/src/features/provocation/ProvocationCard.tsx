import { AlertTriangle, CheckCircle2, Eye, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import type {
  ProvocationAction,
  ProvocationCard as ProvocationCardData,
  ScaffoldMode,
} from "./types";

interface ProvocationCardProps {
  card: ProvocationCardData;
  mode: ScaffoldMode;
  onAction?: (action: ProvocationAction, reason?: string) => void;
  onDismiss?: () => void;
  onMarkIrrelevant?: () => void;
}

const TONE_CLASS: Record<ProvocationCardData["severity"], string> = {
  info: "border-info/40 bg-info/5",
  caution: "border-warn/50 bg-warn/10",
  risk: "border-danger/60 bg-danger/10",
};

const ICON_CLASS: Record<ProvocationCardData["severity"], string> = {
  info: "text-info",
  caution: "text-warn",
  risk: "text-danger",
};

export function ProvocationCard({
  card,
  mode,
  onAction,
  onDismiss,
  onMarkIrrelevant,
}: ProvocationCardProps) {
  const [pendingReasonAction, setPendingReasonAction] = useState<ProvocationAction | null>(null);
  const [reason, setReason] = useState("");
  const compact = mode === "expert";
  const explanation = card.modeCopy?.[mode] ?? card.modeCopy?.guided;

  const chooseAction = (action: ProvocationAction) => {
    if (action.disabledReason) return;
    if (action.requiresReason) {
      setPendingReasonAction(action);
      return;
    }
    onAction?.(action);
  };

  const submitReason = () => {
    const action = pendingReasonAction;
    const trimmed = reason.trim();
    if (!action || !trimmed) return;
    onAction?.(action, trimmed);
    setPendingReasonAction(null);
    setReason("");
  };

  return (
    <aside
      className={cn("rounded-md border px-3 py-3 text-sm shadow-sm", TONE_CLASS[card.severity])}
      data-testid="provocation-card"
      data-card-type={card.type}
      data-severity={card.severity}
      data-mode={mode}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_CLASS[card.severity])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-fg">{card.title}</p>
              {card.prompt ? (
                <p className="mt-1 text-xs font-medium text-fg" data-testid="provocation-prompt">
                  {card.prompt}
                </p>
              ) : null}
              {!compact ? <p className="mt-1 text-xs text-fg-muted">{card.message}</p> : null}
            </div>
            <div className="flex shrink-0 gap-1">
              {onMarkIrrelevant ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="관련 없음으로 표시"
                  onClick={onMarkIrrelevant}
                  data-testid="provocation-mark-irrelevant"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              {onDismiss ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="검토 카드 닫기"
                  onClick={onDismiss}
                  data-testid="provocation-dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="provocation-evidence">
            {card.evidence.map((item) => (
              <span
                key={`${item.source}:${item.label}:${item.value ?? ""}`}
                className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border/80 bg-bg/70 px-2 py-0.5 text-[11px] text-fg"
              >
                <Eye className="h-3 w-3 shrink-0 text-fg-muted" aria-hidden />
                <span className="font-semibold">{item.label}</span>
                {item.value ? <span className="truncate text-fg-muted">{item.value}</span> : null}
              </span>
            ))}
          </div>

          {mode === "guided" && explanation ? (
            <p className="mt-2 text-[11px] leading-snug text-fg-muted">{explanation}</p>
          ) : null}

          {pendingReasonAction ? (
            <div className="mt-3 rounded-md border bg-bg/70 p-2">
              <label className="text-[11px] font-medium text-fg">
                계속 진행하는 이유를 한 줄로 남겨주세요.
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className="mt-1 w-full resize-none rounded-md border bg-bg-panel2 px-2 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="provocation-risk-reason"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingReasonAction(null);
                    setReason("");
                  }}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={reason.trim().length === 0}
                  onClick={submitReason}
                  data-testid="provocation-risk-submit"
                >
                  이유 남기고 진행
                </Button>
              </div>
            </div>
          ) : null}

          {!pendingReasonAction ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.actions.map((action) => {
                const disabled = Boolean(action.disabledReason);
                return (
                  <Button
                    key={action.id}
                    type="button"
                    variant={action.kind === "continue_with_risk" ? "outline" : "ghost"}
                    size="sm"
                    disabled={disabled}
                    title={action.disabledReason}
                    onClick={() => chooseAction(action)}
                    data-testid="provocation-action"
                    data-action-kind={action.kind}
                    data-disabled-reason={action.disabledReason}
                  >
                    <span>{action.label}</span>
                    {action.disabledReason ? (
                      <span className="ml-1 text-[10px] text-fg-subtle">
                        {action.disabledReason}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export default ProvocationCard;
