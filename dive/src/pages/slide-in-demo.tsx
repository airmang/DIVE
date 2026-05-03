import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";
import { SlideInPanel } from "../components/slide-in/SlideInPanel";
import { useSlideInStore } from "../stores/slideIn";
import type { ChangedFile } from "../components/slide-in/types";

const DEMO_FILES: ChangedFile[] = [
  {
    path: "src/App.tsx",
    diff: {
      path: "src/App.tsx",
      before: "function App() {\n  return <div>old</div>;\n}\n",
      after: "function App() {\n  return <div>new improved</div>;\n}\n",
    },
  },
  {
    path: "src/main.tsx",
    diff: {
      path: "src/main.tsx",
      before: 'import "./styles/globals.css";\n',
      after: 'import "./styles/globals.css";\nimport "./styles/extra.css";\n',
    },
  },
  {
    path: "README.md",
    diff: {
      path: "README.md",
      before: "# Hello\n\nOld body\nLine 2\n",
      after: "# Hello\n\nNew body\nLine 2\nLine 3 added\n",
    },
  },
];

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

export default function SlideInDemoPage() {
  const open = useSlideInStore((s) => s.open);
  const pushTerminalLine = useSlideInStore((s) => s.pushTerminalLine);
  const isOpen = useSlideInStore((s) => s.isOpen);

  useEffect(() => {
    open({
      tab: "code",
      files: DEMO_FILES,
      previewUrl: null,
      replaceFiles: true,
    });
  }, [open]);

  const addDemoLines = () => {
    pushTerminalLine({ kind: "info", text: "npm run build" });
    pushTerminalLine({ kind: "stdout", text: "✓ 1695 modules transformed." });
    pushTerminalLine({ kind: "stdout", text: "dist/index.html  1.12 kB" });
    pushTerminalLine({ kind: "stderr", text: "[plugin:vite:css] warning: unused @apply" });
    pushTerminalLine({ kind: "info", text: "✓ built in 1.21s" });
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b bg-bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">슬라이드 인 패널 데모</h1>
            <p className="text-xs text-fg-muted">
              DIVE_SPEC.md §5.4, §5.6 · 드라이 데모 (mock 파일 + 미리보기 + 터미널)
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-6 py-8">
        <section className="rounded-lg border bg-bg-panel p-4" data-testid="demo-controls">
          <h2 className="text-lg font-semibold text-fg">컨트롤</h2>
          <p className="mt-1 text-xs text-fg-muted">
            우측 패널이 자동으로 열립니다. ESC 또는 X 버튼으로 닫을 수 있습니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                open({
                  tab: "code",
                  files: DEMO_FILES,
                  replaceFiles: true,
                })
              }
              data-testid="open-code-btn"
            >
              코드 탭 열기
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => open({ tab: "preview" })}
              data-testid="open-preview-btn"
            >
              미리보기 탭 열기
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                open({ tab: "terminal" });
                addDemoLines();
              }}
              data-testid="open-terminal-btn"
            >
              터미널 탭 + 샘플 출력
            </Button>
            <span
              className="self-center text-xs text-fg-muted"
              data-testid="demo-status"
              data-open={isOpen ? "true" : "false"}
            >
              상태: {isOpen ? "열림" : "닫힘"}
            </span>
          </div>
        </section>

        <section className="rounded-lg border bg-bg-panel p-4">
          <h2 className="text-lg font-semibold text-fg">주요 인터랙션</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-fg-muted">
            <li>우측 슬라이드 인 — 280ms transition</li>
            <li>ESC 또는 X 버튼 닫기</li>
            <li>코드 탭: 좌측 파일 리스트 클릭 → 우측 diff 갱신</li>
            <li>미리보기 탭: http/https URL 입력</li>
            <li>터미널 탭: stdout / stderr / info 색상 구분, 자동 하단 스크롤</li>
          </ul>
        </section>

        <footer className="pt-6 text-xs text-fg-subtle">
          슬라이드 인 패널 — 작업 2-5. DIVE 게이트 D + 통합은 2-6에서.
        </footer>
      </main>

      <SlideInPanel />
    </div>
  );
}
