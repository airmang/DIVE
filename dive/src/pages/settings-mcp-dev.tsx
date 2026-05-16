import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { LearningHint } from "../components/ui/learning-hint";

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

interface McpServerSummary {
  id: number;
  label: string;
  transport: string;
  command: string | null;
  url: string | null;
  default_risk: string;
  enabled: boolean;
}

interface McpDraft {
  label: string;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  url: string;
  defaultRisk: "safe" | "caution" | "danger";
}

function defaultMcpDraft(): McpDraft {
  return {
    label: "",
    transport: "stdio",
    command: "",
    argsText: "",
    url: "",
    defaultRisk: "caution",
  };
}

export default function DevMcpSettingsSection() {
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(defaultMcpDraft());
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const api = await loadTauri();
      if (api) {
        try {
          const servers = await api.invoke<McpServerSummary[]>("mcp_server_list");
          setMcpServers(servers);
        } catch (err) {
          console.warn("mcp_server_list failed:", err);
        }
        return;
      }
      const mcpMock = window.localStorage.getItem("dive:mcp-servers");
      if (mcpMock) setMcpServers(JSON.parse(mcpMock) as McpServerSummary[]);
    })().catch((err) => console.warn("mcp dev settings load failed:", err));
  }, []);

  const handleMcpAdd = async () => {
    if (!mcpDraft.label.trim()) return;
    setMcpBusy(true);
    setMcpTestResult(null);
    try {
      const argsArr = mcpDraft.argsText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const payload = {
        label: mcpDraft.label.trim(),
        transport: mcpDraft.transport,
        command: mcpDraft.transport === "stdio" ? mcpDraft.command.trim() || null : null,
        args: mcpDraft.transport === "stdio" && argsArr.length > 0 ? argsArr : null,
        env: null,
        url: mcpDraft.transport === "http" ? mcpDraft.url.trim() || null : null,
        headers: null,
        default_risk: mcpDraft.defaultRisk,
        enabled: true,
      };
      const api = await loadTauri();
      if (api) {
        await api.invoke<number>("mcp_server_add", { server: payload });
        const servers = await api.invoke<McpServerSummary[]>("mcp_server_list");
        setMcpServers(servers);
      } else {
        const nextId = mcpServers.length > 0 ? Math.max(...mcpServers.map((s) => s.id)) + 1 : 1;
        const next: McpServerSummary[] = [
          ...mcpServers,
          {
            id: nextId,
            label: payload.label,
            transport: payload.transport,
            command: payload.command,
            url: payload.url,
            default_risk: payload.default_risk,
            enabled: true,
          },
        ];
        setMcpServers(next);
        window.localStorage.setItem("dive:mcp-servers", JSON.stringify(next));
      }
      setMcpDraft(defaultMcpDraft());
    } finally {
      setMcpBusy(false);
    }
  };

  const handleMcpRemove = async (id: number) => {
    const api = await loadTauri();
    if (api) {
      await api.invoke<void>("mcp_server_remove", { id });
      const servers = await api.invoke<McpServerSummary[]>("mcp_server_list");
      setMcpServers(servers);
    } else {
      const next = mcpServers.filter((s) => s.id !== id);
      setMcpServers(next);
      window.localStorage.setItem("dive:mcp-servers", JSON.stringify(next));
    }
  };

  const handleMcpTestConnect = async (id: number) => {
    setMcpTestResult(null);
    const api = await loadTauri();
    if (api) {
      try {
        const r = await api.invoke<{
          initialize: { server_name: string | null; protocol_version: string };
          tools: Array<{ name: string; risk_hint: string | null }>;
        }>("mcp_server_test_connect", { id });
        setMcpTestResult(
          `연결 성공: ${r.initialize.server_name ?? "?"} · 도구 ${r.tools.length}개`,
        );
      } catch (err) {
        setMcpTestResult(`실패: ${String(err)}`);
      }
    } else {
      setMcpTestResult("mock: 연결 성공(시뮬레이션) · 도구 2개");
    }
  };

  return (
    <details className="rounded-md border bg-bg-panel px-3 py-3" data-testid="settings-section-mcp">
      <summary className="cursor-pointer text-sm font-semibold text-fg">개발 전용 MCP 서버</summary>
      <LearningHint className="mt-2 text-xs">
        v1 제품 UI에서는 숨겨진 개발용 표면입니다. 실제 사용자 기능은 Phase 11 이후에 검증합니다.
      </LearningHint>
      <div className="mt-3 flex flex-col gap-2" data-testid="mcp-server-list">
        {mcpServers.length === 0 ? (
          <div
            className="rounded-md border border-dashed bg-bg px-3 py-6 text-center text-xs text-fg-muted"
            data-testid="mcp-empty"
          >
            추가된 MCP 서버가 없습니다.
          </div>
        ) : (
          mcpServers.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md border bg-bg px-3 py-2"
              data-testid="mcp-server-row"
              data-mcp-label={s.label}
            >
              <div>
                <div className="text-sm font-medium">
                  <code>{s.label}</code>
                </div>
                <div className="text-[10px] text-fg-muted">
                  {s.transport === "stdio"
                    ? `stdio · ${s.command ?? "-"}`
                    : `http · ${s.url ?? "-"}`}{" "}
                  · default risk: {s.default_risk}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleMcpTestConnect(s.id)}
                  data-testid="mcp-test-connect"
                  data-mcp-label={s.label}
                >
                  테스트
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleMcpRemove(s.id)}
                  data-testid="mcp-remove"
                  data-mcp-label={s.label}
                >
                  제거
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      {mcpTestResult ? (
        <div
          className="mt-3 rounded-md border bg-bg px-3 py-2 text-xs"
          data-testid="mcp-test-result"
        >
          {mcpTestResult}
        </div>
      ) : null}
      <div
        className="mt-3 flex flex-col gap-2 rounded-md border border-dashed bg-bg p-3"
        data-testid="mcp-form"
      >
        <div className="text-xs font-medium">MCP 서버 추가</div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Label, e.g. filesystem"
            value={mcpDraft.label}
            onChange={(e) => setMcpDraft({ ...mcpDraft, label: e.target.value })}
            data-testid="mcp-label"
          />
          <select
            value={mcpDraft.transport}
            onChange={(e) =>
              setMcpDraft({
                ...mcpDraft,
                transport: e.target.value as "stdio" | "http",
              })
            }
            className="rounded-md border bg-bg px-2 py-1 text-sm"
            data-testid="mcp-transport"
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </div>
        {mcpDraft.transport === "stdio" ? (
          <>
            <Input
              placeholder="command, e.g. npx"
              value={mcpDraft.command}
              onChange={(e) => setMcpDraft({ ...mcpDraft, command: e.target.value })}
              data-testid="mcp-command"
            />
            <textarea
              placeholder="args, one per line"
              value={mcpDraft.argsText}
              onChange={(e) => setMcpDraft({ ...mcpDraft, argsText: e.target.value })}
              className="min-h-[60px] rounded-md border bg-bg px-2 py-1 text-sm"
              data-testid="mcp-args"
              spellCheck={false}
            />
          </>
        ) : (
          <Input
            placeholder="URL, e.g. https://example.com/rpc"
            value={mcpDraft.url}
            onChange={(e) => setMcpDraft({ ...mcpDraft, url: e.target.value })}
            data-testid="mcp-url"
          />
        )}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-fg-muted">기본 위험도:</span>
          <select
            value={mcpDraft.defaultRisk}
            onChange={(e) =>
              setMcpDraft({
                ...mcpDraft,
                defaultRisk: e.target.value as McpDraft["defaultRisk"],
              })
            }
            className="rounded-md border bg-bg px-2 py-1 text-sm"
            data-testid="mcp-default-risk"
          >
            <option value="safe">safe</option>
            <option value="caution">caution</option>
            <option value="danger">danger</option>
          </select>
          <Button
            size="sm"
            onClick={() => void handleMcpAdd()}
            disabled={mcpBusy || !mcpDraft.label.trim()}
            data-testid="mcp-add-submit"
          >
            {mcpBusy ? "추가 중..." : "추가"}
          </Button>
        </div>
      </div>
    </details>
  );
}
