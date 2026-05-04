import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useTheme } from "../hooks/useTheme";
import { useProjectSessionStore, type ProviderSummary } from "../stores/project-session";
import { CodexOAuthDialog } from "../components/codex/CodexOAuthDialog";

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

interface PolicyDto {
  rules: Record<string, string>;
  default?: string | null;
}

const SAFE_TOOLS = ["read_file", "list_dir", "search_files"];
const WARN_TOOLS = ["write_file", "edit_file"];

const PROVIDER_KINDS: Array<{ kind: string; label: string; hint: string; ga: boolean }> = [
  { kind: "anthropic", label: "Anthropic", hint: "claude-sonnet-4.5", ga: true },
  { kind: "openai", label: "OpenAI", hint: "gpt-4o / o1", ga: true },
  { kind: "openrouter", label: "OpenRouter", hint: "여러 모델 통합", ga: true },
  { kind: "codex", label: "Codex (ChatGPT OAuth)", hint: "ChatGPT Plus/Pro 구독", ga: true },
  { kind: "mock", label: "Mock (개발)", hint: "테스트·데모", ga: false },
];

export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const loaded = useProjectSessionStore((s) => s.loaded);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const providers = useProjectSessionStore((s) => s.providers);
  const connectProvider = useProjectSessionStore((s) => s.connectProvider);
  const disconnectProvider = useProjectSessionStore((s) => s.disconnectProvider);

  const [policy, setPolicy] = useState<PolicyDto>({ rules: {}, default: null });
  const [resetNextSession, setResetNextSession] = useState(true);
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [codexDialogOpen, setCodexDialogOpen] = useState(false);
  const [codexConnected, setCodexConnected] = useState(false);
  const [codexAccountId, setCodexAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void loadAll();
  }, [loaded, loadAll]);

  useEffect(() => {
    (async () => {
      const api = await loadTauri();
      if (api) {
        try {
          const p = await api.invoke<PolicyDto>("provider_policy_get");
          setPolicy(p);
        } catch (err) {
          console.warn("provider_policy_get failed:", err);
        }
        try {
          const st = await api.invoke<{
            connected: boolean;
            account_id: string | null;
          }>("codex_oauth_status");
          setCodexConnected(st.connected);
          setCodexAccountId(st.account_id);
          return;
        } catch (err) {
          console.warn("codex_oauth_status failed:", err);
        }
      }
      try {
        const raw = window.localStorage.getItem("dive:auto-approve-policy");
        if (raw) setPolicy(JSON.parse(raw) as PolicyDto);
        const raw2 = window.localStorage.getItem("dive:reset-next-session");
        if (raw2) setResetNextSession(raw2 === "true");
        const codexMock = window.localStorage.getItem("dive:codex-connected");
        if (codexMock === "true") {
          setCodexConnected(true);
          setCodexAccountId("acct_mock");
        }
      } catch (err) {
        console.warn("settings: corrupted policy json", err);
      }
    })();
  }, []);

  const persistPolicy = async (next: PolicyDto) => {
    setPolicy(next);
    window.localStorage.setItem("dive:auto-approve-policy", JSON.stringify(next));
    const api = await loadTauri();
    if (api) {
      try {
        await api.invoke<void>("provider_policy_set", { policy: next });
      } catch (err) {
        console.warn("provider_policy_set failed:", err);
      }
    }
  };

  const toggleToolPolicy = async (tool: string) => {
    const current = policy.rules[tool];
    const next: PolicyDto = {
      rules: { ...policy.rules },
      default: policy.default,
    };
    if (current === "always") delete next.rules[tool];
    else next.rules[tool] = "always";
    await persistPolicy(next);
  };

  const handleConnect = async (kind: string) => {
    if (kind === "codex") {
      setCodexDialogOpen(true);
      return;
    }
    if (!apiKeyInput.trim()) return;
    setConnecting(true);
    try {
      await connectProvider(kind, apiKeyInput.trim());
      setApiKeyInput("");
      setExpandedKind(null);
    } finally {
      setConnecting(false);
    }
  };

  const handleCodexDisconnect = async () => {
    if (!window.confirm("ChatGPT 연결을 해제할까요?")) return;
    const api = await loadTauri();
    if (api) {
      try {
        await api.invoke<void>("codex_oauth_logout");
      } catch (err) {
        console.warn("codex_oauth_logout failed:", err);
      }
    } else {
      window.localStorage.removeItem("dive:codex-connected");
    }
    setCodexConnected(false);
    setCodexAccountId(null);
  };

  const handleDisconnect = async (row: ProviderSummary) => {
    if (row.kind === "codex") {
      await handleCodexDisconnect();
      return;
    }
    if (!window.confirm(`${row.kind} 연결을 해제할까요?`)) return;
    await disconnectProvider(row.id);
  };

  const backToShell = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div
      className="min-h-screen w-screen overflow-y-auto bg-bg px-8 py-6 text-fg"
      data-testid="settings-page"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={backToShell} data-testid="settings-back">
            <ArrowLeft className="h-4 w-4" />
            뒤로
          </Button>
          <h1 className="text-2xl font-bold">설정</h1>
          <div />
        </div>

        <section className="flex flex-col gap-3" data-testid="settings-section-providers">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">프로바이더</h2>
            <span className="text-xs text-fg-muted">
              API 키는 OS 자격 증명 저장소(Keyring)에 보관됩니다.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="provider-cards">
            {PROVIDER_KINDS.map((p) => {
              const isCodex = p.kind === "codex";
              const connected = isCodex
                ? codexConnected
                  ? { id: -1, kind: "codex", is_connected: true }
                  : undefined
                : providers.find((x) => x.kind === p.kind && x.is_connected);
              const expanded = expandedKind === p.kind;
              return (
                <Card
                  key={p.kind}
                  className="flex flex-col gap-2 p-4"
                  data-testid="provider-card"
                  data-provider-kind={p.kind}
                  data-connected={connected ? "true" : "false"}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{p.label}</span>
                        <span
                          className={
                            connected
                              ? "inline-block h-2 w-2 rounded-full bg-success"
                              : "inline-block h-2 w-2 rounded-full bg-bg-panel2"
                          }
                          data-testid="provider-dot"
                          data-connected={connected ? "true" : "false"}
                          aria-label={connected ? "연결됨" : "미연결"}
                        />
                      </div>
                      <div className="text-[11px] text-fg-muted">{p.hint}</div>
                      {isCodex && codexConnected && codexAccountId ? (
                        <div
                          className="mt-1 text-[10px] text-fg-muted"
                          data-testid="codex-account-id"
                        >
                          계정: <code>{codexAccountId}</code>
                        </div>
                      ) : null}
                    </div>
                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void (isCodex
                            ? handleCodexDisconnect()
                            : handleDisconnect(connected as ProviderSummary))
                        }
                        data-testid="provider-disconnect"
                        data-provider-kind={p.kind}
                      >
                        해제
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!p.ga}
                        onClick={() =>
                          isCodex
                            ? setCodexDialogOpen(true)
                            : setExpandedKind(expanded ? null : p.kind)
                        }
                        data-testid="provider-connect-btn"
                        data-provider-kind={p.kind}
                      >
                        {p.ga ? (isCodex ? "ChatGPT 연결" : "연결하기") : "준비 중"}
                      </Button>
                    )}
                  </div>
                  {!isCodex && expanded && p.ga ? (
                    <div className="flex flex-col gap-2 border-t pt-2">
                      <Input
                        type="password"
                        placeholder="sk-..."
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        data-testid="provider-key-input"
                        data-provider-kind={p.kind}
                      />
                      <Button
                        size="sm"
                        onClick={() => void handleConnect(p.kind)}
                        disabled={connecting || !apiKeyInput.trim()}
                        data-testid="provider-submit"
                        data-provider-kind={p.kind}
                      >
                        {connecting ? "연결 중…" : "저장 + 연결"}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-policy">
          <h2 className="text-lg font-semibold">자동 승인 정책</h2>
          <p className="text-xs text-fg-muted">
            안전(Safe) 도구에 한해 자동 승인을 허용할 수 있습니다. 주의(Warn)·위험(Danger) 도구는
            항상 수동 승인이 필요합니다.
          </p>
          <div className="flex flex-col gap-2" data-testid="policy-tool-list">
            {SAFE_TOOLS.map((tool) => {
              const on = policy.rules[tool] === "always";
              return (
                <label
                  key={tool}
                  className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2"
                  data-testid="policy-row"
                  data-tool={tool}
                >
                  <div>
                    <div className="text-sm font-medium">{tool}</div>
                    <div className="text-[10px] text-fg-muted">Safe · 자동 승인 가능</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => void toggleToolPolicy(tool)}
                    data-testid="policy-toggle"
                    data-tool={tool}
                    className="h-4 w-4"
                  />
                </label>
              );
            })}
            {WARN_TOOLS.map((tool) => (
              <div
                key={tool}
                className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2 opacity-60"
                data-testid="policy-row-locked"
                data-tool={tool}
              >
                <div>
                  <div className="text-sm font-medium">{tool}</div>
                  <div className="text-[10px] text-fg-muted">Warn · 항상 수동 승인</div>
                </div>
                <input type="checkbox" disabled className="h-4 w-4" />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={resetNextSession}
              onChange={(e) => {
                setResetNextSession(e.target.checked);
                window.localStorage.setItem("dive:reset-next-session", String(e.target.checked));
              }}
              data-testid="policy-reset-next"
              className="h-3.5 w-3.5"
            />
            다음 차시에 자동 승인 정책 초기화 (권장)
          </label>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-theme">
          <h2 className="text-lg font-semibold">테마</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleTheme}
            className="w-fit"
            data-testid="settings-theme-toggle"
            data-theme={theme}
          >
            {theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          </Button>
        </section>
      </div>
      <CodexOAuthDialog
        open={codexDialogOpen}
        onOpenChange={setCodexDialogOpen}
        onConnected={(status) => {
          setCodexConnected(status.connected);
          setCodexAccountId(status.account_id);
          if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
            window.localStorage.setItem("dive:codex-connected", String(status.connected));
          }
        }}
      />
    </div>
  );
}

export default SettingsPage;
