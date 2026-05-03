import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";
import {
  ArgsEditor,
  DiffViewer,
  PermissionCard,
  type PermissionCardData,
} from "../components/permission-card";

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

const SAFE_CARD: PermissionCardData = {
  toolCallId: "demo-safe-1",
  toolName: "list_dir",
  paramsPreview: 'path: "src"',
  risk: "safe",
  diffPreview: null,
  args: { path: "src" },
};

const WARN_CARD: PermissionCardData = {
  toolCallId: "demo-warn-1",
  toolName: "edit_file",
  paramsPreview: 'path: "src/App.tsx"',
  risk: "warn",
  diffPreview: {
    path: "src/App.tsx",
    before: "function App() {\n  return <div>old</div>;\n}\n",
    after: "function App() {\n  return <div>new improved</div>;\n}\n",
  },
  args: {
    path: "src/App.tsx",
    find: "<div>old</div>",
    replace: "<div>new improved</div>",
  },
};

const DANGER_CARD: PermissionCardData = {
  toolCallId: "demo-danger-1",
  toolName: "bash",
  paramsPreview: 'command: "rm -rf node_modules"',
  risk: "danger",
  diffPreview: null,
  args: {
    command: "rm -rf node_modules",
    cwd: "./",
  },
};

export default function PermissionDemoPage() {
  const [log, setLog] = useState<string[]>([]);
  const [editorValue, setEditorValue] = useState<unknown | null>({ path: "src" });

  const record = (line: string) => setLog((prev) => [line, ...prev].slice(0, 10));

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b bg-bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">권한 카드 + diff 뷰어 데모</h1>
            <p className="text-xs text-fg-muted">
              DIVE_SPEC.md §5.5, §6.4 · 드라이 데모 (mock payload)
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-6 py-8">
        <Section title="1. 안전 카드 (safe)" testId="demo-section-safe">
          <PermissionCard
            card={SAFE_CARD}
            onApprove={(id) => record(`safe ${id} approved`)}
            onDeny={(id, reason) => record(`safe ${id} denied (${reason ?? "no reason"})`)}
          />
        </Section>

        <Section title="2. 주의 카드 (warn) — diff 포함" testId="demo-section-warn">
          <PermissionCard
            card={WARN_CARD}
            onApprove={(id, modified) =>
              record(`warn ${id} approved ${modified ? "(modified)" : ""}`)
            }
            onDeny={(id, reason) => record(`warn ${id} denied (${reason ?? "no reason"})`)}
          />
        </Section>

        <Section title="3. 위험 카드 (danger)" testId="demo-section-danger">
          <PermissionCard
            card={DANGER_CARD}
            onApprove={(id, modified) =>
              record(`danger ${id} approved ${modified ? "(modified)" : ""}`)
            }
            onDeny={(id, reason) => record(`danger ${id} denied (${reason ?? "no reason"})`)}
          />
        </Section>

        <Section title="4. DiffViewer 단독" testId="demo-section-diff">
          <DiffViewer
            diff={{
              path: "README.md",
              before: "# Hello\n\nOld body\nLine 2\n",
              after: "# Hello\n\nNew body\nLine 2\nLine 3 added\n",
            }}
          />
        </Section>

        <Section title="5. ArgsEditor 단독" testId="demo-section-editor">
          <ArgsEditor initial={{ path: "src", deep: true }} onChange={(v) => setEditorValue(v)} />
          <pre className="mt-3 rounded-md border bg-bg-panel2 p-2 text-xs text-fg-muted">
            parsed: {JSON.stringify(editorValue, null, 2)}
          </pre>
        </Section>

        <Section title="로그 (최근 10건)" testId="demo-section-log">
          {log.length === 0 ? (
            <p className="text-xs text-fg-muted">
              카드의 승인/거부 버튼을 누르면 여기에 기록됩니다.
            </p>
          ) : (
            <ul className="space-y-1 font-mono text-xs text-fg-muted" data-testid="demo-log">
              {log.map((l, i) => (
                <li key={`${i}-${l}`}>{l}</li>
              ))}
            </ul>
          )}
        </Section>

        <footer className="pt-6 text-xs text-fg-subtle">
          권한 카드 — 작업 2-4. 슬라이드 인 패널 전체 보기는 2-5에서 연결.
        </footer>
      </main>
    </div>
  );
}
