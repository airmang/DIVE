import { useState } from "react";
import { Button } from "../components/ui/button";
import { PermissionCard } from "../components/permission-card";
import { ToolCallMessage } from "../components/chat/ToolCallMessage";
import { McpProvenanceBadge } from "../components/mcp/McpProvenanceBadge";

export default function McpDemoPage() {
  const [lastAction, setLastAction] = useState<string>("");

  const approve = (id: string) => setLastAction(`approved:${id}`);
  const deny = (id: string) => setLastAction(`denied:${id}`);

  return (
    <div
      className="min-h-screen w-screen overflow-y-auto bg-bg px-8 py-6 text-fg"
      data-testid="mcp-demo-page"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-bold">MCP 통합 데모 (5-3)</h1>
        <p className="text-xs text-fg-muted">
          MCP 도구 이름 규약{" "}
          <code>
            mcp__{"{server}"}__{"{tool}"}
          </code>
          , 출처 배지, 권한 카드 3종, ToolCallMessage의 차단/승인 상태를 시각적으로 검증합니다. 실제
          LLM 호출 없이 정적 렌더만.
        </p>

        <section className="flex flex-col gap-3" data-testid="section-badge">
          <h2 className="text-lg font-semibold">1. 출처 배지</h2>
          <div className="flex items-center gap-3">
            <span>MCP 도구:</span>
            <code data-testid="tool-name-mcp">mcp__fs__read_file</code>
            <McpProvenanceBadge name="mcp__fs__read_file" />
          </div>
          <div className="flex items-center gap-3">
            <span>일반 도구:</span>
            <code data-testid="tool-name-builtin">read_file</code>
            <McpProvenanceBadge name="read_file" />
            <span className="text-xs text-fg-muted" data-testid="builtin-no-badge">
              (배지 없음)
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-3" data-testid="section-cards">
          <h2 className="text-lg font-semibold">2. 권한 카드 (Safe · Warn · Danger)</h2>
          <PermissionCard
            card={{
              toolCallId: "safe-1",
              toolName: "mcp__fs__read_url",
              paramsPreview: 'url: "https://example.com"',
              risk: "safe",
              diffPreview: null,
              args: { url: "https://example.com" },
            }}
            onApprove={approve}
            onDeny={deny}
          />
          <PermissionCard
            card={{
              toolCallId: "warn-1",
              toolName: "mcp__fs__edit_file",
              paramsPreview: 'path: "/tmp/note.txt"',
              risk: "warn",
              diffPreview: null,
              args: { path: "/tmp/note.txt", content: "updated" },
            }}
            onApprove={approve}
            onDeny={deny}
          />
          <PermissionCard
            card={{
              toolCallId: "danger-1",
              toolName: "mcp__grading__run_sql",
              paramsPreview: "SELECT * FROM students",
              risk: "danger",
              diffPreview: null,
              args: { sql: "SELECT * FROM students" },
            }}
            onApprove={approve}
            onDeny={deny}
          />
          <div
            className="rounded-md border bg-bg-panel px-3 py-1 text-xs"
            data-testid="last-action"
          >
            마지막 동작: {lastAction || "(없음)"}
          </div>
        </section>

        <section className="flex flex-col gap-3" data-testid="section-messages">
          <h2 className="text-lg font-semibold">3. 차단·승인 상태 메시지</h2>
          <ToolCallMessage
            message={{
              kind: "tool_call",
              id: "m1",
              createdAt: 0,
              toolName: "mcp__fs__writer",
              paramsPreview: 'path: "/tmp/a.txt"',
              status: "approved",
            }}
          />
          <ToolCallMessage
            message={{
              kind: "tool_call",
              id: "m2",
              createdAt: 0,
              toolName: "mcp__fs__exec",
              paramsPreview: "rm -rf /",
              status: "blocked",
              blockedReason: { rule: "destructive_rm", pattern: "rm -rf /" },
            }}
          />
        </section>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("demo");
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
