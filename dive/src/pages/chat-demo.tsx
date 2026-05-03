import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { useMockChatStream } from "../hooks/useMockChatStream";
import { Button } from "../components/ui/button";
import { ChatArea } from "../components/shell/ChatArea";
import {
  AssistantMessage,
  ChatInput,
  ErrorMessage,
  MessageList,
  SystemMessage,
  ToolCallMessage,
  ToolResultMessage,
  UserMessage,
} from "../components/chat";
import type { ChatMessage } from "../components/chat";

function makeStaticSixMessages(): ChatMessage[] {
  const now = Date.now();
  return [
    {
      id: "demo-system-1",
      kind: "system",
      createdAt: now,
      content: "새 세션이 시작되었습니다.",
    },
    {
      id: "demo-user-1",
      kind: "user",
      createdAt: now + 1,
      content: "할 일 앱을 만들어 줘. 입력하면 아래 목록에 추가되게.",
    },
    {
      id: "demo-assistant-1",
      kind: "assistant",
      createdAt: now + 2,
      content:
        "좋습니다. 먼저 입력 컴포넌트와 목록 컴포넌트를 나눠 만들고 상태는 useState로 관리하겠습니다.",
      streaming: false,
    },
    {
      id: "demo-tool-call-1",
      kind: "tool_call",
      createdAt: now + 3,
      toolName: "list_dir",
      paramsPreview: 'path: "./src"',
      status: "pending",
    },
    {
      id: "demo-tool-result-1",
      kind: "tool_result",
      createdAt: now + 4,
      toolName: "list_dir",
      success: true,
      summary: "4개 파일: App.tsx, main.tsx, components/, styles/",
    },
    {
      id: "demo-error-1",
      kind: "error",
      createdAt: now + 5,
      message: "네트워크가 불안정합니다. 잠시 후 다시 시도해 주세요.",
      retryable: true,
    },
  ];
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "라이트 모드로" : "다크 모드로";
  return (
    <Button variant="outline" size="sm" onClick={toggleTheme} aria-label={label}>
      {theme === "dark" ? <Sun /> : <Moon />}
      {label}
    </Button>
  );
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <div className="rounded-lg border bg-bg-panel p-4">{children}</div>
    </section>
  );
}

export default function ChatDemoPage() {
  const sixMessages = useMemo(() => makeStaticSixMessages(), []);
  const stream = useMockChatStream();

  const [integratedStream, setIntegratedStream] = useState(true);
  const integrated = useMockChatStream({
    initialMessages: [
      {
        id: "integrated-seed-1",
        kind: "system",
        createdAt: Date.now(),
        content: "MainShell 통합 데모 — 아래 입력란에 메시지를 보내보세요.",
      },
    ],
  });

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b bg-bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">채팅 영역 데모</h1>
            <p className="text-xs text-fg-muted">
              DIVE_SPEC.md §5.3 · 드라이 데모 (mock 스트리밍, 실제 Provider 호출은 2-3에서)
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-6 py-8">
        <Section title="1. 6종 메시지 컴포넌트 정적 렌더" testId="demo-section-six">
          <div className="flex flex-col gap-4" data-testid="static-six-container">
            <SystemMessage message={sixMessages[0] as never} />
            <UserMessage message={sixMessages[1] as never} />
            <AssistantMessage message={sixMessages[2] as never} />
            <ToolCallMessage message={sixMessages[3] as never} />
            <ToolResultMessage message={sixMessages[4] as never} />
            <ErrorMessage message={sixMessages[5] as never} onRetry={() => console.log("retry")} />
          </div>
        </Section>

        <Section title="2. 실제 대화 흐름 — MessageList + ChatInput" testId="demo-section-stream">
          <div className="flex flex-col gap-3" data-testid="stream-container">
            <div className="flex items-center gap-3 text-xs text-fg-muted">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => stream.reset()}
                disabled={stream.messages.length === 0}
              >
                초기화
              </Button>
              <span>
                메시지 {stream.messages.length}개 · {stream.isStreaming ? "스트리밍 중" : "대기"}
              </span>
            </div>
            <div className="h-[420px] overflow-hidden rounded-md border bg-bg">
              <MessageList messages={stream.messages} />
            </div>
            <ChatInput
              onSend={stream.sendUserMessage}
              disabled={stream.isStreaming}
              modelLabel="mock-model-v1"
            />
          </div>
        </Section>

        <Section title="3. MainShell 통합 (ChatArea 실사용)" testId="demo-section-integrated">
          <div className="flex items-center gap-3 pb-3 text-xs text-fg-muted">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={integratedStream}
                onChange={(e) => setIntegratedStream(e.target.checked)}
                data-testid="demo-toggle-integrated"
              />
              mock 대화 활성화
            </label>
          </div>
          <div className="h-[560px] overflow-hidden rounded-md border bg-bg">
            <ChatArea
              className="h-full"
              messages={integratedStream ? integrated.messages : undefined}
              cardTitle={integratedStream ? "예시 카드 · 할 일 앱 스켈레톤" : null}
              onSendMessage={integratedStream ? integrated.sendUserMessage : undefined}
              inputDisabled={integratedStream ? integrated.isStreaming : false}
              modelLabel="mock-model-v1"
            />
          </div>
        </Section>

        <footer className="pt-6 text-xs text-fg-subtle">
          채팅 영역 — 작업 2-2. 실제 LLM 호출은 2-3, 권한 카드는 2-4, 슬라이드 인은 2-5.
        </footer>
      </main>
    </div>
  );
}
