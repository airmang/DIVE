import { memo } from "react";
import { Ban, Wrench } from "lucide-react";
import type { ToolCallMessageData } from "./types";
import { Badge } from "../ui/badge";
import { PermissionCard } from "../permission-card";
import type { PermissionCardData } from "../permission-card";

const STATUS_LABEL: Record<ToolCallMessageData["status"], string> = {
  pending: "대기",
  approved: "승인",
  denied: "거부",
  blocked: "차단",
};

const STATUS_VARIANT: Record<ToolCallMessageData["status"], "warn" | "success" | "danger"> = {
  pending: "warn",
  approved: "success",
  denied: "danger",
  blocked: "danger",
};

interface Props {
  message: ToolCallMessageData;
  onApprove?: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDeny?: (toolCallId: string, reason?: string) => void;
}

function ToolCallMessageImpl({ message, onApprove, onDeny }: Props) {
  const showCard =
    message.status === "pending" &&
    message.risk !== undefined &&
    onApprove !== undefined &&
    onDeny !== undefined;

  if (showCard) {
    const card: PermissionCardData = {
      toolCallId: message.id,
      toolName: message.toolName,
      paramsPreview: message.paramsPreview,
      risk: message.risk!,
      diffPreview: message.diffPreview ?? null,
      args: message.args,
    };
    return (
      <article
        className="flex w-full items-start justify-center"
        data-testid="chat-message"
        data-kind="tool_call"
        data-message-id={message.id}
        data-status={message.status}
      >
        <div className="w-full max-w-[80%]">
          <PermissionCard card={card} onApprove={onApprove} onDeny={onDeny} />
        </div>
      </article>
    );
  }

  if (message.status === "blocked") {
    return (
      <article
        className="flex items-start justify-center"
        data-testid="chat-message"
        data-kind="tool_call"
        data-message-id={message.id}
        data-status="blocked"
      >
        <div
          className="w-full max-w-[80%] overflow-hidden rounded-md border-2 border-danger/70 bg-danger/10"
          data-testid="tool-call-blocked"
        >
          <header className="flex items-center gap-2 border-b border-danger/40 bg-danger/20 px-3 py-2">
            <Ban className="h-4 w-4 text-danger" aria-hidden />
            <span className="text-sm font-semibold text-danger">차단된 명령 — 실행 불가</span>
            <Badge variant="danger" className="ml-auto">
              blocked
            </Badge>
          </header>
          <div className="space-y-1 px-3 py-2 text-xs">
            <p className="flex items-center gap-1 text-fg">
              <span className="font-semibold">도구:</span>
              <span className="font-mono">{message.toolName}</span>
            </p>
            <p className="truncate font-mono text-fg-muted">{message.paramsPreview}</p>
            {message.blockedReason ? (
              <>
                <p className="mt-1 text-danger">
                  <span className="font-semibold">차단 규칙:</span> {message.blockedReason.rule}
                </p>
                <p className="font-mono text-fg-muted">
                  <span className="font-semibold">패턴:</span> {message.blockedReason.pattern}
                </p>
              </>
            ) : null}
            <p className="mt-1 text-fg-muted">
              이 명령은 안전 정책(§9.2)에 의해 사용자 승인과 무관하게 실행이 차단됩니다.
            </p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="flex items-start justify-center"
      data-testid="chat-message"
      data-kind="tool_call"
      data-message-id={message.id}
      data-status={message.status}
    >
      <div className="w-full max-w-[80%] rounded-lg border bg-bg-panel2 px-4 py-2">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <Wrench className="h-4 w-4 text-accent" aria-hidden />
            <span>{message.toolName}</span>
          </div>
          <Badge variant={STATUS_VARIANT[message.status]}>{STATUS_LABEL[message.status]}</Badge>
        </header>
        <p className="mt-1 truncate font-mono text-xs text-fg-muted">{message.paramsPreview}</p>
        {message.deniedReason ? (
          <p className="mt-1 text-xs text-danger">사유: {message.deniedReason}</p>
        ) : null}
      </div>
    </article>
  );
}

export const ToolCallMessage = memo(ToolCallMessageImpl);
