import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  modelLabel?: string;
  onPromptHelper?: () => void;
  className?: string;
}

const MIN_HEIGHT_PX = 40;
const MAX_HEIGHT_PX = 200;

export function ChatInput({
  onSend,
  disabled = false,
  modelLabel = "claude-sonnet-4.5",
  onPromptHelper,
  className,
}: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  const canSend = value.trim().length > 0 && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    onSend(value);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="메시지를 입력하세요..."
        aria-label="메시지 입력"
        rows={1}
        data-testid="chat-input-textarea"
        className={cn(
          "w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg",
          "placeholder:text-fg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        style={{ minHeight: `${MIN_HEIGHT_PX}px`, maxHeight: `${MAX_HEIGHT_PX}px` }}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPromptHelper}
          disabled={disabled || !onPromptHelper}
          aria-label="프롬프트 도우미 (준비 중)"
          data-testid="chat-prompt-helper"
        >
          <Sparkles />
          프롬프트 도우미
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-label="모델 선택 (준비 중)"
          data-testid="chat-model-selector"
        >
          {modelLabel} <span aria-hidden>▾</span>
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="메시지 전송"
          data-testid="chat-send"
        >
          <Send />
          전송
        </Button>
      </div>
    </div>
  );
}

export default ChatInput;
