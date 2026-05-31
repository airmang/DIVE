import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { ChatInput } from "../components/chat/ChatInput";
import { detectAmbiguity, type AmbiguityHit } from "../lib/ambiguity";
import { PROMPT_TEMPLATES, type PromptContext } from "../lib/prompt-templates";

declare global {
  interface Window {
    __test_detect_ambiguity?: (text: string) => AmbiguityHit[];
    __test_prompt_templates?: typeof PROMPT_TEMPLATES;
  }
}

const CONTEXT_LABEL: Record<PromptContext, string> = {
  plan: "계획",
  build: "실행",
  verify: "검증",
};

export default function PromptHelperDemoPage() {
  const [lastSent, setLastSent] = useState<string>("");
  const [context, setContext] = useState<PromptContext>("build");

  useEffect(() => {
    window.__test_detect_ambiguity = detectAmbiguity;
    window.__test_prompt_templates = PROMPT_TEMPLATES;
    return () => {
      delete window.__test_detect_ambiguity;
      delete window.__test_prompt_templates;
    };
  }, []);

  return (
    <div
      className="min-h-screen w-screen overflow-y-auto bg-bg px-8 py-6 text-fg"
      data-testid="prompt-helper-demo-page"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-bold">프롬프트 도우미 데모 (5-4)</h1>
        <p className="text-xs text-fg-muted">
          ChatInput 우측 ✨ 버튼으로 템플릿 패널을 열고, 입력 중 지시 대명사·모호한 표현을 500ms 뒤
          감지해 하이라이트 + 힌트를 표시합니다.
        </p>

        <div
          className="flex items-center gap-3 rounded-md border bg-bg-panel px-3 py-2"
          data-testid="context-picker"
        >
          <span className="text-xs">현재 흐름:</span>
          {(["plan", "build", "verify"] as PromptContext[]).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={context === item ? "primary" : "outline"}
              onClick={() => setContext(item)}
              data-testid="context-set"
              data-context={item}
            >
              {CONTEXT_LABEL[item]}
            </Button>
          ))}
          <div className="flex-1" />
          <span className="text-[11px] text-fg-muted" data-testid="active-context">
            context: <code>{context}</code>
          </span>
        </div>

        <div className="rounded-md border bg-bg-panel p-3">
          <ChatInput
            onSend={setLastSent}
            context={context}
            promptCheckMock={{
              issues: [
                {
                  kind: "pronoun",
                  excerpt: "이거",
                  suggestion: "대상 파일/함수 이름을 명시하세요",
                },
                {
                  kind: "missing_target",
                  excerpt: "바꿔줘",
                  suggestion: "무엇을 어떤 값으로 바꿀지 구체화하세요",
                },
              ],
              refined_text: "src/App.tsx 파일의 title 필드를 '안녕' 으로 설정해 주세요.",
              approximate_tokens: 142,
            }}
          />
        </div>

        <div className="rounded-md border bg-bg-panel px-3 py-2 text-xs" data-testid="last-sent">
          마지막 전송: <code className="whitespace-pre-wrap break-all">{lastSent || "(없음)"}</code>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("demo");
            url.searchParams.delete("route");
            window.history.pushState({}, "", url.toString());
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          data-testid="back"
          className="w-fit"
        >
          뒤로
        </Button>
      </div>
    </div>
  );
}
