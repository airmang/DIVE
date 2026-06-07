import { Check, ShieldCheck, X } from "lucide-react";
import { useT } from "../../i18n";
import { Button } from "../ui/button";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import { explainTool } from "./explain";
import { PermissionSummary } from "./PermissionSummary";
import { RawDetails } from "./RawDetails";
import type { PermissionCardProps } from "./types";

export function SafeCard({ card, onApprove, onDeny }: PermissionCardProps) {
  const t = useT();
  const explanation = explainTool(card.toolName, card.risk, card.args, t);

  return (
    <div
      className="w-full overflow-hidden rounded-md border border-info/40 bg-info/5"
      data-testid="permission-card"
      data-risk="safe"
      data-tool-call-id={card.toolCallId}
    >
      <div className="flex items-start gap-2 border-b border-info/30 bg-info/10 px-3 py-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">{t("permission_card.safe.title")}</span>
            <McpProvenanceBadge name={card.toolName} />
          </div>
          <p className="text-xs text-fg-muted">{t("permission_card.safe.description")}</p>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        <PermissionSummary toolName={card.toolName} risk={card.risk} explanation={explanation} />
        <RawDetails value={{ preview: card.paramsPreview, args: card.args }} />
      </div>

      <footer className="flex items-center justify-end gap-2 border-t bg-bg-panel2/30 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="card-deny"
          onClick={() => onDeny(card.toolCallId)}
        >
          <X />
          {t("permission_card.actions.deny")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="card-approve"
          onClick={() => onApprove(card.toolCallId)}
        >
          <Check />
          {t("permission_card.safe.approve")}
        </Button>
      </footer>
    </div>
  );
}
