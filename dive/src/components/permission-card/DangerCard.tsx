import { useState } from "react";
import { AlertOctagon, Check, Pencil, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ArgsEditor } from "./ArgsEditor";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import type { PermissionCardProps } from "./types";

export function DangerCard({ card, onApprove, onDeny }: PermissionCardProps) {
  const [editing, setEditing] = useState(false);
  const [modifiedArgs, setModifiedArgs] = useState<unknown | null>(card.args);
  const [denyingWithReason, setDenyingWithReason] = useState(false);
  const [denyReason, setDenyReason] = useState("");

  const canApprove = !editing || modifiedArgs !== null;
  const argsJson = JSON.stringify(card.args, null, 2);

  return (
    <div
      className="w-full overflow-hidden rounded-md border-2 border-danger/60 bg-danger/10"
      data-testid="permission-card"
      data-risk="danger"
      data-tool-call-id={card.toolCallId}
    >
      <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/20 px-3 py-2">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">{card.toolName}</span>
            <Badge variant="danger">위험</Badge>
            <McpProvenanceBadge name={card.toolName} />
          </div>
          <p className="text-xs text-danger">
            이 도구는 되돌리기 어려운 변경을 일으킬 수 있습니다. 인자를 확인한 뒤 승인하세요.
          </p>
        </div>
      </div>

      <div className="px-3 py-2">
        <p className="text-xs text-fg-muted">실행 인자</p>
        <pre
          className="mt-1 max-h-40 overflow-auto rounded-md border bg-bg-panel2 p-2 font-mono text-xs text-fg"
          data-testid="danger-args"
        >
          {argsJson}
        </pre>
      </div>

      {editing ? (
        <div className="border-t px-3 py-2">
          <ArgsEditor initial={card.args} onChange={(parsed) => setModifiedArgs(parsed)} />
        </div>
      ) : null}

      {denyingWithReason ? (
        <div className="border-t px-3 py-2">
          <label className="text-xs text-fg-muted">거부 사유 (선택)</label>
          <textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            rows={2}
            aria-label="거부 사유"
            data-testid="deny-reason"
            className="mt-1 w-full resize-y rounded-md border bg-bg-panel2 px-3 py-2 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
        </div>
      ) : null}

      <footer className="flex items-center justify-between gap-2 border-t bg-bg-panel2/30 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="card-edit"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil />
          {editing ? "수정 취소" : "수정"}
        </Button>
        <div className="flex gap-1">
          {denyingWithReason ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="card-deny-confirm"
              onClick={() => onDeny(card.toolCallId, denyReason.trim() || undefined)}
            >
              <X />
              거부 확정
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                data-testid="card-deny-with-reason"
                onClick={() => setDenyingWithReason(true)}
              >
                사유 남기기
              </Button>
              <Button
                size="sm"
                variant="danger"
                data-testid="card-deny"
                onClick={() => onDeny(card.toolCallId)}
              >
                <X />
                거부
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
            승인
          </Button>
        </div>
      </footer>
    </div>
  );
}
