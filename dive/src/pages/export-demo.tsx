import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";

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

interface ExportOptions {
  includeMessages: boolean;
  includeToolCalls: boolean;
  includeVerifyLogs: boolean;
  includeCheckpoints: boolean;
  includeEvents: boolean;
  hashUserText: boolean;
  hashFilePaths: boolean;
  hashIds: boolean;
}

const SESSIONS = [
  { id: 1, title: "2026-05-04 A반 1차시", card_count: 4 },
  { id: 2, title: "2026-05-04 A반 2차시", card_count: 6 },
  { id: 3, title: "2026-05-05 B반 1차시", card_count: 3 },
];

const SAMPLE_RECORDS = {
  masked: [
    {
      kind: "session_meta",
      session_id: "id:session:7a3c1e9b2d4f5a6c",
      title: "h:7a3c1e9b2d4f5a6c",
      status: "active",
    },
    {
      kind: "card",
      id: "id:card:b2d4f5a67a3c1e9b",
      title: "h:b2d4f5a67a3c1e9b",
      state: "verified",
      instruction: "h:c1e9b7a3b2d4f5a6",
      changed_files: [{ path: "p:9b2d4f5a67a3c1e9" }],
    },
    {
      kind: "message",
      id: "id:message:4f5a67a3c1e9b2d4",
      role: "user",
      content: "h:4f5a67a3c1e9b2d4",
    },
    {
      kind: "message",
      id: "id:message:67a3c1e9b2d4f5a6",
      role: "assistant",
      content: "의도에 맞춰 LoginForm 컴포넌트를 추가하겠습니다.",
    },
    {
      kind: "tool_call",
      id: "id:tool_call:a67a3c1e9b2d4f5a",
      name: "read_file",
      input: { path: "p:a67a3c1e9b2d4f5a" },
      approved: true,
    },
    {
      kind: "checkpoint",
      id: "id:checkpoint:67a3c1e9b2d4f5a6",
      kind_label: "auto",
      label: "h:67a3c1e9b2d4f5a6",
    },
    ...[
      "session_start",
      "stage_enter",
      "card_create",
      "card_update",
      "tool_approve",
      "tool_reject",
      "tool_complete",
      "checkpoint_create",
      "checkpoint_restore",
      "verify_start",
      "verify_complete",
      "error_occurred",
      "stage_exit",
      "card_delete",
      "session_end",
    ].map((type, index) => ({
      kind: "event",
      id: `id:event:${String(index + 1).padStart(16, "0")}`,
      type,
      payload: { source: type === "error_occurred" ? "provider" : undefined },
    })),
  ],
  plain: [
    {
      kind: "session_meta",
      session_id: 1,
      title: "2026-05-04 A반 1차시",
      status: "active",
    },
    {
      kind: "card",
      id: 1,
      title: "로그인 폼 추가",
      state: "verified",
      instruction: "LoginForm 컴포넌트에 이메일/비밀번호 input 추가",
      changed_files: [{ path: "src/LoginForm.tsx" }],
    },
    {
      kind: "message",
      id: 1,
      role: "user",
      content: "로그인 폼 만들어줘",
    },
    {
      kind: "message",
      id: 2,
      role: "assistant",
      content: "의도에 맞춰 LoginForm 컴포넌트를 추가하겠습니다.",
    },
    {
      kind: "tool_call",
      id: 1,
      name: "read_file",
      input: { path: "src/App.tsx" },
      approved: true,
    },
    {
      kind: "checkpoint",
      id: 1,
      kind_label: "auto",
      label: "[V 통과] 로그인 폼 추가",
    },
    ...[
      "session_start",
      "stage_enter",
      "card_create",
      "card_update",
      "tool_approve",
      "tool_reject",
      "tool_complete",
      "checkpoint_create",
      "checkpoint_restore",
      "verify_start",
      "verify_complete",
      "error_occurred",
      "stage_exit",
      "card_delete",
      "session_end",
    ].map((type, index) => ({
      kind: "event",
      id: index + 1,
      type,
      payload: { source: type === "error_occurred" ? "provider" : undefined },
    })),
  ],
};

async function tryIpcExport(sessionId: number, options: ExportOptions): Promise<string | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<string>("export_session", {
      sessionId,
      options: {
        include_messages: options.includeMessages,
        include_tool_calls: options.includeToolCalls,
        include_verify_logs: options.includeVerifyLogs,
        include_checkpoints: options.includeCheckpoints,
        include_events: options.includeEvents,
        hash_user_text: options.hashUserText,
        hash_file_paths: options.hashFilePaths,
        hash_ids: options.hashIds,
      },
    });
  } catch {
    return null;
  }
}

function mockPreview(options: ExportOptions): string {
  const source =
    options.hashUserText || options.hashFilePaths || options.hashIds
      ? SAMPLE_RECORDS.masked
      : SAMPLE_RECORDS.plain;
  return source
    .filter((r) => {
      if (r.kind === "message" && !options.includeMessages) return false;
      if (r.kind === "tool_call" && !options.includeToolCalls) return false;
      if (r.kind === "checkpoint" && !options.includeCheckpoints) return false;
      if (r.kind === "event" && !options.includeEvents) return false;
      return true;
    })
    .map((r) => JSON.stringify(r))
    .join("\n");
}

export default function ExportDemoPage() {
  const [sessionId, setSessionId] = useState<number>(1);
  const [options, setOptions] = useState<ExportOptions>({
    includeMessages: true,
    includeToolCalls: true,
    includeVerifyLogs: true,
    includeCheckpoints: true,
    includeEvents: true,
    hashUserText: true,
    hashFilePaths: true,
    hashIds: true,
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<"ipc" | "mock" | null>(null);
  const [loading, setLoading] = useState(false);

  const lineCount = useMemo(
    () => (preview ? preview.split("\n").filter((l) => l.length > 0).length : 0),
    [preview],
  );

  const updateOption = (key: keyof ExportOptions, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const runExport = async () => {
    setLoading(true);
    const ipc = await tryIpcExport(sessionId, options);
    if (ipc) {
      setPreview(ipc);
      setSource("ipc");
    } else {
      setPreview(mockPreview(options));
      setSource("mock");
    }
    setLoading(false);
  };

  const downloadJsonl = () => {
    if (!preview) return;
    const blob = new Blob([preview], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dive-session-${sessionId}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-bg-base text-fg">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Export Demo (task 3-6)</h1>
        <div className="flex items-center gap-2">
          <a href="/" className="text-sm text-fg-muted underline">
            ← 홈으로
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
        <section data-testid="demo-section-intro" className="rounded-md border bg-bg-panel2 p-4">
          <h2 className="text-sm font-semibold">무엇을 확인하는가</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>세션 → 옵션 체크박스 → 미리보기/다운로드 흐름.</li>
            <li>
              해시 마스킹 on/off에 따라 user text와 파일 경로가 <code>h:</code> /<code>p:</code>{" "}
              접두사로 바뀐다.
            </li>
            <li>JSONL 형식(한 줄 = 한 레코드). 다운로드 버튼으로 파일 저장.</li>
          </ul>
        </section>

        <section
          data-testid="demo-section-form"
          className="space-y-3 rounded-md border bg-bg-panel2 p-4"
        >
          <div>
            <label htmlFor="exp-session" className="block text-xs font-semibold text-fg-muted">
              세션 선택
            </label>
            <select
              id="exp-session"
              data-testid="exp-session"
              value={sessionId}
              onChange={(e) => setSessionId(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-bg-panel px-3 py-2 text-sm text-fg"
            >
              {SESSIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} — {s.card_count} 카드
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm" data-testid="exp-options">
            {(
              [
                ["includeMessages", "메시지 포함"],
                ["includeToolCalls", "도구 호출 포함"],
                ["includeVerifyLogs", "검증 로그 포함"],
                ["includeCheckpoints", "체크포인트 포함"],
                ["includeEvents", "이벤트 로그 포함"],
                ["hashUserText", "사용자 텍스트 해시 마스킹"],
                ["hashFilePaths", "파일 경로 해시 마스킹"],
                ["hashIds", "세션/카드/메시지 ID 해시 마스킹"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-md border bg-bg-panel px-2 py-1"
                data-testid={`opt-${key}`}
              >
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => updateOption(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              data-testid="exp-preview"
              disabled={loading}
              onClick={() => {
                void runExport();
              }}
            >
              {loading ? "export 중..." : "미리보기"}
            </Button>
            <Button
              variant="outline"
              data-testid="exp-download"
              disabled={!preview}
              onClick={downloadJsonl}
            >
              JSONL 다운로드
            </Button>
            {source ? (
              <span className="text-[11px] text-fg-muted" data-testid="exp-source">
                source: {source}
              </span>
            ) : null}
          </div>
        </section>

        {preview ? (
          <section
            data-testid="demo-section-preview"
            className="space-y-2 rounded-md border bg-bg-panel2 p-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">미리보기 ({lineCount} 라인)</h2>
              <span className="text-[11px] text-fg-muted" data-testid="exp-line-count">
                {lineCount} records
              </span>
            </div>
            <pre
              className="max-h-96 overflow-auto rounded bg-bg-panel p-3 text-[11px] leading-5"
              data-testid="exp-preview-text"
            >
              {preview}
            </pre>
          </section>
        ) : null}
      </main>
    </div>
  );
}
