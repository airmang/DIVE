import { Code, Eye } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ChatInput } from "../chat/ChatInput";
import { MessageList } from "../chat/MessageList";
import type { ChatMessage } from "../chat/types";

interface ChatAreaProps {
  className?: string;
  messages?: ChatMessage[];
  cardTitle?: string | null;
  onSendMessage?: (text: string) => void;
  onOpenSlidePanel?: () => void;
  onRetryError?: (id: string) => void;
  onApproveToolCall?: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDenyToolCall?: (toolCallId: string, reason?: string) => void;
  modelLabel?: string;
  inputDisabled?: boolean;
}

export function ChatArea({
  className,
  messages,
  cardTitle,
  onSendMessage,
  onOpenSlidePanel,
  onRetryError,
  onApproveToolCall,
  onDenyToolCall,
  modelLabel,
  inputDisabled,
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
            <p className="text-xl font-semibold text-fg">세션을 시작해 대화를 시작하세요</p>
            <p className="text-sm text-fg-muted">
              사이드바에서 <span className="font-medium text-fg">+ 새 세션</span>을 눌러 시작
            </p>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t p-4">
        {onSendMessage ? (
          <ChatInput onSend={onSendMessage} disabled={inputDisabled} modelLabel={modelLabel} />
        ) : (
          <ChatInput onSend={() => {}} disabled modelLabel={modelLabel} />
        )}
      </footer>
    </section>
  );
}

export default ChatArea;
