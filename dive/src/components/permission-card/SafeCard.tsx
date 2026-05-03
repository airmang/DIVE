import { Check, ShieldCheck, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { PermissionCardProps } from "./types";

export function SafeCard({ card, onApprove, onDeny }: PermissionCardProps) {
  return (
    <div
      className="flex w-full items-center justify-between gap-3 rounded-md border border-info/40 bg-info/5 px-3 py-2"
      data-testid="permission-card"
      data-risk="safe"
      data-tool-call-id={card.toolCallId}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">{card.toolName}</span>
            <Badge variant="info">안전</Badge>
          </div>
          <p className="truncate font-mono text-xs text-fg-muted">{card.paramsPreview}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="primary"
          data-testid="card-approve"
          onClick={() => onApprove(card.toolCallId)}
        >
          <Check />
          승인
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="card-deny"
          onClick={() => onDeny(card.toolCallId)}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
