import { useState } from "react";
import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { Button } from "../ui/button";
import { ArgsEditor } from "./ArgsEditor";
import { CommandExplainer } from "./CommandExplainer";
import { explainTool } from "./explain";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import { PatchPreviewPanel } from "./PatchPreviewPanel";
import { PermissionSummary } from "./PermissionSummary";
import { RawDetails } from "./RawDetails";
import type { PermissionCardProps } from "./types";

export function WarnCard({ card, onApprove, onDeny }: PermissionCardProps) {
  const [editing, setEditing] = useState(false);
  const [denyingWithReason, setDenyingWithReason] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [modifiedArgs, setModifiedArgs] = useState<unknown | null>(card.args);
  const explanation = explainTool(card.toolName, card.risk, card.args);

  const canApprove = !editing || modifiedArgs !== null;

  return (
    <div
      className="w-full overflow-hidden rounded-md border border-warn/40 bg-warn/5"
      data-testid="permission-card"
      data-risk="warn"
      data-tool-call-id={card.toolCallId}
    >
      <div className="flex items-start gap-2 border-b border-warn/30 bg-warn/10 px-3 py-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">Review before DIVE changes anything</span>
            <McpProvenanceBadge name={card.toolName} />
          </div>
          <p className="text-xs text-fg-muted">
            Nothing is applied until you choose Allow. Deny is always safe.
          </p>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        <PermissionSummary toolName={card.toolName} risk={card.risk} explanation={explanation} />
        <CommandExplainer explanation={explanation} />
        <PatchPreviewPanel diff={card.diffPreview} expected={explanation.patchPreviewExpected} />
        <RawDetails label="Show details" value={{ preview: card.paramsPreview, args: card.args }} />
      </div>

      {editing ? (
        <div className="border-t px-3 py-2">
          <ArgsEditor initial={card.args} onChange={(parsed) => setModifiedArgs(parsed)} />
        </div>
      ) : null}

      {denyingWithReason ? (
        <div className="border-t px-3 py-2">
          <label className="text-xs text-fg-muted">Why deny? (optional)</label>
          <textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            rows={2}
            aria-label="Deny reason"
            data-testid="deny-reason"
            className="mt-1 w-full resize-y rounded-md border bg-bg-panel2 px-3 py-2 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-bg-panel2/30 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="card-edit"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil />
          {editing ? "Stop editing request" : "Edit request"}
        </Button>
        <div className="flex flex-wrap gap-1">
          {denyingWithReason ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="card-deny-confirm"
              onClick={() => onDeny(card.toolCallId, denyReason.trim() || undefined)}
            >
              <X />
              Confirm deny
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                data-testid="card-deny-with-reason"
                onClick={() => setDenyingWithReason(true)}
              >
                Add reason
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="card-deny"
                onClick={() => onDeny(card.toolCallId)}
              >
                <X />
                Deny
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!canApprove}
            data-testid="card-approve"
            onClick={() =>
              onApprove(card.toolCallId, editing ? (modifiedArgs ?? undefined) : undefined)
            }
          >
            <Check />
            Allow this change
          </Button>
        </div>
      </footer>
    </div>
  );
}
