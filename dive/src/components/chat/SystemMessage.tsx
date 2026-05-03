import { memo } from "react";
import type { SystemMessageData } from "./types";

interface Props {
  message: SystemMessageData;
}

function SystemMessageImpl({ message }: Props) {
  return (
    <div
      className="flex items-center justify-center py-1"
      data-testid="chat-message"
      data-kind="system"
      data-message-id={message.id}
    >
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-border" aria-hidden />
        <p className="text-center text-xs text-fg-muted">{message.content}</p>
        <div className="h-px flex-1 bg-border" aria-hidden />
      </div>
    </div>
  );
}

export const SystemMessage = memo(SystemMessageImpl);
