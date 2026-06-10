import { memo } from "react";
import type { AssistantMessageData } from "./types";

interface Props {
  message: AssistantMessageData;
}

function AssistantMessageImpl({ message }: Props) {
  return (
    <article
      className="flex flex-col items-start gap-1"
      data-testid="chat-message"
      data-kind="assistant"
      data-message-id={message.id}
      data-streaming={message.streaming ? "true" : "false"}
      aria-busy={message.streaming ? "true" : "false"}
    >
      <div className="max-w-full rounded-lg bg-bg-panel px-4 py-2 text-fg sm:max-w-[80%]">
        <p className="whitespace-pre-wrap break-words text-sm">
          <span data-testid="assistant-content">{message.content}</span>
          {message.streaming ? (
            <span
              className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle motion-reduce:animate-none"
              aria-hidden
              data-testid="streaming-cursor"
            />
          ) : null}
        </p>
      </div>
    </article>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);
