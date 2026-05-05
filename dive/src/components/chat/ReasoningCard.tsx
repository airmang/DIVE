import { memo } from "react";
import { BrainCircuit } from "lucide-react";
import type { ReasoningMessageData } from "./types";

interface Props {
  message: ReasoningMessageData;
}

function ReasoningCardImpl({ message }: Props) {
  return (
    <article
      className="max-w-[80%] self-start rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg"
      data-testid="chat-message"
      data-message-kind="reasoning"
      data-message-id={message.id}
      data-tool-call-id={message.toolCallId}
    >
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-accent">
        <BrainCircuit className="size-3.5" />
        <span>AI 의도</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-fg-muted">{message.text}</p>
    </article>
  );
}

export const ReasoningCard = memo(ReasoningCardImpl);
