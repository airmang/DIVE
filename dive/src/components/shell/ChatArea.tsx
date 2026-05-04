import { AlertCircle, Code, Eye } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ChatInput } from "../chat/ChatInput";
import { MessageList } from "../chat/MessageList";
import type { ChatMessage } from "../chat/types";

export type ChatStageBannerTone = "info" | "warn" | "success";

export interface ChatStageBanner {
  tone: ChatStageBannerTone;
  message: string;
}

interface ChatAreaProps {
  className?: string;
  messages?: ChatMessage[];
  cardTitle?: string | null;
  cardStateLabel?: string | null;
  stageBanner?: ChatStageBanner | null;
  onSendMessage?: (text: string) => void;
  onOpenSlidePanel?: () => void;
  onRetryError?: (id: string) => void;
  onApproveToolCall?: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDenyToolCall?: (toolCallId: string, reason?: string) => void;
  modelLabel?: string;
  inputDisabled?: boolean;
  inputBlocked?: { reason: string } | null;
  emptyState?: {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
  };
}

export function ChatArea({
  className,
  messages,
  cardTitle,
  cardStateLabel,
  stageBanner,
  onSendMessage,
  onOpenSlidePanel,
  onRetryError,
  onApproveToolCall,
  onDenyToolCall,
  modelLabel,
  inputDisabled,
  inputBlocked,
  emptyState,
}: ChatAreaProps) {
  const hasConversation = messages !== undefined && messages.length > 0;

  const handleOpenSlidePanel = () => {
    if (onOpenSlidePanel) onOpenSlidePanel();
    else console.log("open slide-in panel (task 2-5)");
  };

  return (
    <section className={cn("flex h-full flex-col bg-bg", className)} aria-label="채팅 영역">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold text-fg">대화</h1>
          <span className="text-xs text-fg-muted" data-testid="chat-card-title">
            {cardTitle ?? "세션 없음"}
          </span>
          {cardStateLabel ? (
            <span
              className="rounded-full bg-bg-panel2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
              data-testid="chat-card-state"
            >
              {cardStateLabel}
            </span>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenSlidePanel}
          aria-label="코드와 미리보기 패널 열기"
        >
          <Code />
          <span>코드</span>
          <span className="text-fg-subtle">/</span>
          <Eye />
          <span>미리보기</span>
        </Button>
      </header>

      {stageBanner ? (
        <div
          role="status"
          data-testid="chat-stage-banner"
          data-tone={stageBanner.tone}
          className={cn(
            "flex items-center gap-2 border-b px-6 py-2 text-xs",
            stageBanner.tone === "warn" && "bg-warn/10 text-warn",
            stageBanner.tone === "success" && "bg-success/10 text-success",
            stageBanner.tone === "info" && "bg-info/10 text-info",
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-fg">{stageBanner.message}</span>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden">
        {hasConversation ? (
          <MessageList
            messages={messages}
            onRetryError={onRetryError}
            onApproveToolCall={onApproveToolCall}
            onDenyToolCall={onDenyToolCall}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-xl font-semibold text-fg">
              {emptyState?.title ?? "세션을 시작해 대화를 시작하세요"}
            </p>
            <p className="text-sm text-fg-muted">
              {emptyState?.description ?? (
                <>
                  사이드바에서 <span className="font-medium text-fg">+ 새 세션</span>을 눌러 시작
                </>
              )}
            </p>
            {emptyState?.actionLabel && emptyState.onAction ? (
              <Button
                variant="primary"
                size="sm"
                onClick={emptyState.onAction}
                data-testid="chat-empty-cta"
              >
                {emptyState.actionLabel}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t p-4">
        {inputBlocked ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
            role="status"
            data-testid="chat-input-blocked"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 text-fg">{inputBlocked.reason}</span>
          </div>
        ) : null}
        {onSendMessage ? (
          <ChatInput
            onSend={onSendMessage}
            disabled={inputDisabled || !!inputBlocked}
            modelLabel={modelLabel}
          />
        ) : (
          <ChatInput
            onSend={() => {}}
            disabled={inputDisabled || !!inputBlocked}
            modelLabel={modelLabel}
          />
        )}
      </footer>
    </section>
  );
}

export default ChatArea;
