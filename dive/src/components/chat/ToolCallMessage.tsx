import { memo } from "react";
import { Wrench } from "lucide-react";
import type { ToolCallMessageData } from "./types";
import { Badge } from "../ui/badge";

const STATUS_LABEL: Record<ToolCallMessageData["status"], string> = {
  pending: "대기",
  approved: "승인",
  denied: "거부",
};

const STATUS_VARIANT: Record<ToolCallMessageData["status"], "warn" | "success" | "danger"> = {
  pending: "warn",
  approved: "success",
  denied: "danger",
};

interface Props {
  message: ToolCallMessageData;
}

function ToolCallMessageImpl({ message }: Props) {
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
      </div>
    </article>
  );
}

export const ToolCallMessage = memo(ToolCallMessageImpl);
