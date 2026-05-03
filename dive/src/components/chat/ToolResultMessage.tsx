import { memo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ToolResultMessageData } from "./types";

interface Props {
  message: ToolResultMessageData;
}

function ToolResultMessageImpl({ message }: Props) {
  const Icon = message.success ? CheckCircle2 : XCircle;
  const tone = message.success ? "text-success" : "text-danger";
  const border = message.success ? "border-success/40" : "border-danger/40";

  return (
    <article
      className="flex items-start justify-center"
      data-testid="chat-message"
      data-kind="tool_result"
      data-message-id={message.id}
      data-success={message.success ? "true" : "false"}
    >
      <div className={`w-full max-w-[80%] rounded-lg border bg-bg-panel2 px-4 py-2 ${border}`}>
        <header className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon className={`h-4 w-4 ${tone}`} aria-hidden />
          <span>{message.toolName}</span>
          <span className={`text-xs ${tone}`}>{message.success ? "성공" : "실패"}</span>
        </header>
        <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg-muted">
          {message.summary}
        </p>
      </div>
    </article>
  );
}

export const ToolResultMessage = memo(ToolResultMessageImpl);
