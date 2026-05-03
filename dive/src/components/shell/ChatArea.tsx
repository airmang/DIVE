import { Code, Eye, Send, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ChatAreaProps {
  className?: string;
}

export function ChatArea({ className }: ChatAreaProps) {
  const handleOpenSlidePanel = () => {
    console.log("open slide-in panel (task 2-5)");
  };

  return (
    <section className={cn("flex h-full flex-col bg-bg", className)} aria-label="채팅 영역">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold text-fg">대화</h1>
          <span className="text-xs text-fg-muted">카드 선택 안 됨</span>
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

      <div className="flex-1 overflow-y-auto">
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-xl font-semibold text-fg">세션을 시작해 대화를 시작하세요</p>
          <p className="text-sm text-fg-muted">
            사이드바에서 <span className="font-medium text-fg">+ 새 세션</span>을 눌러 시작
          </p>
        </div>
      </div>

      <footer className="shrink-0 border-t p-4">
        <div className="flex flex-col gap-2">
          <Input
            disabled
            placeholder="메시지를 입력하세요..."
            aria-label="메시지 입력 (준비 중)"
            className="h-10"
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled aria-label="모델 선택 (준비 중)">
              claude-sonnet-4.5 <span aria-hidden>▾</span>
            </Button>
            <Button variant="ghost" size="sm" disabled aria-label="프롬프트 도우미 (준비 중)">
              <Sparkles />
              프롬프트 도우미
            </Button>
            <div className="flex-1" />
            <Button variant="primary" size="sm" disabled aria-label="메시지 전송 (준비 중)">
              <Send />
              전송
            </Button>
          </div>
        </div>
      </footer>
    </section>
  );
}

export default ChatArea;
