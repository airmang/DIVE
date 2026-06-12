import { memo } from "react";
import type { ReactNode } from "react";
import type { AssistantMessageData } from "./types";

interface Props {
  message: AssistantMessageData;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < text.length) {
    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        nodes.push(
          <strong key={nodes.length} className="font-semibold text-fg">
            {text.slice(index + 2, end)}
          </strong>,
        );
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        nodes.push(
          <code
            key={nodes.length}
            className="rounded-sm bg-bg-panel2 px-1 py-0.5 font-mono text-[0.85em] text-fg"
          >
            {text.slice(index + 1, end)}
          </code>,
        );
        index = end + 1;
        continue;
      }
    }

    const nextBold = text.indexOf("**", index + 1);
    const nextCode = text.indexOf("`", index + 1);
    const candidates = [nextBold, nextCode].filter((value) => value > index);
    const next = candidates.length > 0 ? Math.min(...candidates) : text.length;
    nodes.push(text.slice(index, next));
    index = next;
  }

  return nodes;
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
        <div className="whitespace-pre-wrap break-words text-sm leading-6">
          <span data-testid="assistant-content">{renderInlineMarkdown(message.content)}</span>
          {message.streaming ? (
            <span
              className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent align-middle motion-reduce:animate-none"
              aria-hidden
              data-testid="streaming-cursor"
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}

export const AssistantMessage = memo(AssistantMessageImpl);
