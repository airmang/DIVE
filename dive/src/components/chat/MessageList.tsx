import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "./types";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ToolActivity } from "./ToolActivity";
import { SystemMessage } from "./SystemMessage";
import { ErrorMessage } from "./ErrorMessage";

interface Props {
  messages: ChatMessage[];
  onRetryError?: (id: string) => void;
  onEditUser?: (id: string) => void;
  onResendUser?: (id: string) => void;
  onApproveToolCall?: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDenyToolCall?: (toolCallId: string, reason?: string) => void;
  /** Cap DOM nodes to last N. Real virtualization lands in task 4-4. */
  maxRendered?: number;
}

/** Scroll distance from bottom that still counts as "pinned". */
const AUTO_SCROLL_THRESHOLD_PX = 50;

function MessageListImpl({
  messages,
  onRetryError,
  onEditUser,
  onResendUser,
  onApproveToolCall,
  onDenyToolCall,
  maxRendered = 200,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const visible = messages.length > maxRendered ? messages.slice(-maxRendered) : messages;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX);
  }, []);

  useLayoutEffect(() => {
    if (!autoScroll) return;
    sentinelRef.current?.scrollIntoView({ block: "end" });
  }, [messages, autoScroll]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-6 py-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      data-testid="message-list"
      data-auto-scroll={autoScroll ? "true" : "false"}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {(() => {
          // Group reasoning + tool_call + tool_result by call_id into one ToolActivity.
          // reasoning carries toolCallId; tool_result id is `tr-<call_id>`.
          const reasoningByCall = new Map<string, (typeof visible)[number]>();
          const resultByCall = new Map<string, (typeof visible)[number]>();
          for (const m of visible) {
            if (m.kind === "reasoning") reasoningByCall.set(m.toolCallId, m);
            else if (m.kind === "tool_result") resultByCall.set(m.id.replace(/^tr-/, ""), m);
          }

          return visible.map((msg) => {
            switch (msg.kind) {
              case "user":
                return (
                  <UserMessage
                    key={msg.id}
                    message={msg}
                    onEdit={onEditUser}
                    onResend={onResendUser}
                  />
                );
              case "assistant":
                return <AssistantMessage key={msg.id} message={msg} />;
              case "reasoning":
                // Rendered inside its ToolActivity (grouped by toolCallId).
                return null;
              case "tool_call": {
                const reasoning = reasoningByCall.get(msg.id);
                const result = resultByCall.get(msg.id);
                return (
                  <ToolActivity
                    key={msg.id}
                    call={msg}
                    reasoning={reasoning?.kind === "reasoning" ? reasoning : undefined}
                    result={result?.kind === "tool_result" ? result : undefined}
                    onApprove={onApproveToolCall}
                    onDeny={onDenyToolCall}
                  />
                );
              }
              case "tool_result":
                // Rendered inside its ToolActivity (grouped by call_id).
                return null;
              case "system":
                return <SystemMessage key={msg.id} message={msg} />;
              case "error":
                return <ErrorMessage key={msg.id} message={msg} onRetry={onRetryError} />;
            }
          });
        })()}
        <div ref={sentinelRef} aria-hidden />
      </div>
    </div>
  );
}

export const MessageList = memo(MessageListImpl);
