import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useTheme } from "../hooks/useTheme";
import { useProjectSessionStore, type ProviderSummary } from "../stores/project-session";
import { CodexOAuthDialog } from "../components/codex/CodexOAuthDialog";
import { LOCALE_LABEL, SUPPORTED_LOCALES, useLocaleStore, type Locale } from "../i18n";
import { LearningHint } from "../components/ui/learning-hint";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { ProviderModelSelector } from "../components/settings/ProviderModelSelector";

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

interface ResearchSettingsDto {
  disable_gates: boolean;
  controls_enabled: boolean;
}

const SAFE_TOOLS = ["read_file", "list_dir", "search_files"];
const WARN_TOOLS = ["write_file", "edit_file"];

const PROVIDER_KINDS: Array<{
  kind: string;
  label: string;
  hint: string;
  ga: boolean;
  warning?: { text: string; href: string; linkLabel: string };
}> = [
  { kind: "anthropic", label: "Anthropic", hint: "Claude 계열", ga: true },
  { kind: "openai", label: "OpenAI", hint: "GPT 계열", ga: true },
  { kind: "openrouter", label: "OpenRouter", hint: "여러 제공사 통합", ga: true },
  {
    kind: "opencode_zen",
    label: "opencode zen",
    hint: "무료 베타",
    ga: true,
    warning: {
      text: "베타 서비스 · 일부 무료 모델은 데이터 훈련에 사용될 수 있습니다",
      href: "https://opencode.ai/docs/zen/",
      linkLabel: "자세히",
    },
  },
  { kind: "codex", label: "Codex (ChatGPT OAuth)", hint: "ChatGPT Plus/Pro 구독", ga: true },
  { kind: "mock", label: "Mock (개발 전용)", hint: "테스트용", ga: false },
];

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

export function SettingsPage() {
  const internalResearchEnabled = import.meta.env.DEV;
  const { theme, toggleTheme } = useTheme();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const tutorialEnabled = useUiPreferencesStore((s) => s.tutorialEnabled);
  const setTutorialEnabled = useUiPreferencesStore((s) => s.setTutorialEnabled);
  const loaded = useProjectSessionStore((s) => s.loaded);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const providers = useProjectSessionStore((s) => s.providers);
  const connectProvider = useProjectSessionStore((s) => s.connectProvider);
  const disconnectProvider = useProjectSessionStore((s) => s.disconnectProvider);

  const [policy, setPolicy] = useState<PolicyDto>({ rules: {}, default: null });
  const [researchSettings, setResearchSettings] = useState<ResearchSettingsDto>({
    disable_gates: false,
    controls_enabled: false,
  });
  const [resetNextSession, setResetNextSession] = useState(true);
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [codexDialogOpen, setCodexDialogOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(defaultMcpDraft());
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) {
      void loadAll().catch((err) => {
        console.warn("settings loadAll failed:", err);
      });
    }
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
        if (internalResearchEnabled) {
          try {
            const research = await api.invoke<ResearchSettingsDto>("research_settings_get");
            const localDisable = research.controls_enabled
              ? window.localStorage.getItem("dive:research-disable-gates")
              : null;
            const next =
              localDisable === null
                ? research
                : { ...research, disable_gates: localDisable === "true" };
            setResearchSettings(next);
            if (research.controls_enabled && localDisable !== null) {
              await api.invoke<void>("research_settings_set", { settings: next });
            } else if (!research.controls_enabled) {
              window.localStorage.removeItem("dive:research-disable-gates");
            }
          } catch (err) {
            console.warn("research_settings_get failed:", err);
          }
        } else {
          window.localStorage.removeItem("dive:research-disable-gates");
          setResearchSettings({ disable_gates: false, controls_enabled: false });
        }
        try {
          const servers = await api.invoke<McpServerSummary[]>("mcp_server_list");
          setMcpServers(servers);
        } catch (err) {
          console.warn("mcp_server_list failed:", err);
        }
        return;
      }
      try {
        const raw = window.localStorage.getItem("dive:auto-approve-policy");
        if (raw) setPolicy(JSON.parse(raw) as PolicyDto);
        const raw2 = window.localStorage.getItem("dive:reset-next-session");
        if (raw2) setResetNextSession(raw2 === "true");
        const controlsEnabled = internalResearchEnabled;
        const researchDisable = controlsEnabled
          ? window.localStorage.getItem("dive:research-disable-gates")
          : null;
        setResearchSettings({
          controls_enabled: controlsEnabled,
          disable_gates: controlsEnabled && researchDisable === "true",
        });
        if (!controlsEnabled) window.localStorage.removeItem("dive:research-disable-gates");
        const mcpMock = window.localStorage.getItem("dive:mcp-servers");
        if (mcpMock) setMcpServers(JSON.parse(mcpMock) as McpServerSummary[]);
      } catch (err) {
        console.warn("settings: corrupted policy json", err);
      }
    })();
  }, [internalResearchEnabled]);

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
      setMcpTestResult(`mock: 연결 성공(시뮬레이션) · 도구 2개`);
    }
  };

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

  const persistResearchSettings = async (next: ResearchSettingsDto) => {
    if (!next.controls_enabled) {
      const disabled = { disable_gates: false, controls_enabled: false };
      setResearchSettings(disabled);
      window.localStorage.removeItem("dive:research-disable-gates");
      return;
    }
    setResearchSettings(next);
    window.localStorage.setItem("dive:research-disable-gates", String(next.disable_gates));
    const api = await loadTauri();
    if (api) {
      try {
        await api.invoke<void>("research_settings_set", { settings: next });
      } catch (err) {
        console.warn("research_settings_set failed:", err);
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
      const row = providers.find((provider) => provider.kind === "codex" && provider.is_connected);
      if (row) await disconnectProvider(row.id);
    }
    await loadAll().catch((err) =>
      console.warn("settings loadAll after codex logout failed:", err),
    );
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
    url.searchParams.delete("route");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const openDiagnosticsSurvey = () => {
    if (!internalResearchEnabled) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("route");
    url.searchParams.set("internal", "diagnostics-survey");
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
            Back
          </Button>
          <h1 className="text-2xl font-bold">Settings</h1>
          <div />
        </div>

        <section className="flex flex-col gap-3" data-testid="settings-section-ai-connection">
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              1 · AI Connection
            </p>
            <h2 className="mt-1 text-xl font-bold text-fg">Connect DIVE to an AI assistant</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Pick the AI connection DIVE uses for planning, coding, and checks. API keys are stored
              in the OS keychain.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="provider-cards">
            {PROVIDER_KINDS.map((p) => {
              const isCodex = p.kind === "codex";
              const connected = providers.find((x) => x.kind === p.kind && x.is_connected);
              const codexAccountId = isCodex ? connected?.account_id : null;
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
                          aria-label={connected ? "AI connection active" : "AI connection missing"}
                        />
                      </div>
                      <div className="text-[11px] text-fg-muted">{p.hint}</div>
                      {p.warning ? (
                        <div className="mt-1 text-[10px] text-warn" data-testid="provider-warning">
                          {p.warning.text} (
                          <a
                            href={p.warning.href}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                          >
                            {p.warning.linkLabel}
                          </a>
                          )
                        </div>
                      ) : null}
                      {isCodex && connected && codexAccountId ? (
                        <div
                          className="mt-1 text-[10px] text-fg-muted"
                          data-testid="codex-account-id"
                        >
                          Account: <code>{codexAccountId}</code>
                        </div>
                      ) : null}
                    </div>
                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void (isCodex ? handleCodexDisconnect() : handleDisconnect(connected))
                        }
                        data-testid="provider-disconnect"
                        data-provider-kind={p.kind}
                      >
                        Disconnect
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
                        {p.ga ? (isCodex ? "Connect ChatGPT" : "Connect") : "Coming soon"}
                      </Button>
                    )}
                  </div>
                  {!isCodex && expanded && p.ga ? (
                    <div className="flex flex-col gap-2 border-t pt-2">
                      <Input
                        type="password"
                        placeholder="Paste API key"
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
                        {connecting ? "Connecting…" : "Save and connect"}
                      </Button>
                    </div>
                  ) : null}
                  {connected ? (
                    <div className="border-t pt-2">
                      <ProviderModelSelector
                        providerId={connected.id}
                        providerKind={p.kind}
                        selectedModel={connected.selected_model ?? null}
                      />
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-app">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              2 · App Settings
            </p>
            <h2 className="text-lg font-semibold">App Settings</h2>
            <p className="text-xs text-fg-muted">Change how DIVE looks and guides you.</p>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Language</div>
              <div className="text-[11px] text-fg-muted">Choose the app interface language.</div>
            </div>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="rounded-md border bg-bg px-2 py-1 text-sm"
              data-testid="settings-locale-select"
              aria-label="Choose language"
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABEL[code]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="text-[11px] text-fg-muted">
                {theme === "dark" ? "Dark theme" : "Light theme"}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              data-testid="settings-theme-toggle"
              data-theme={theme}
            >
              {theme === "dark" ? "Switch to light" : "Switch to dark"}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Guided help</div>
              <div className="text-[11px] text-fg-muted">
                Show step-by-step explanations while you learn DIVE.
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={tutorialEnabled}
                onChange={(e) => setTutorialEnabled(e.target.checked)}
                data-testid="settings-tutorial-toggle"
                className="h-4 w-4"
              />
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-safety">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              3 · Safety
            </p>
            <h2 className="text-lg font-semibold">Safety</h2>
            <p className="text-xs text-fg-muted">
              DIVE asks before changing files, running commands, or undoing work.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-bg-panel px-3 py-3 text-xs">
              <div className="text-sm font-semibold text-fg">You stay in control</div>
              <p className="mt-1 text-fg-muted">
                File edits and commands wait for an approval card before they run.
              </p>
            </div>
            <div className="rounded-md border bg-bg-panel px-3 py-3 text-xs">
              <div className="text-sm font-semibold text-fg">Unsafe patterns are blocked</div>
              <p className="mt-1 text-fg-muted">
                Some dangerous commands cannot run even if someone clicks approve.
              </p>
            </div>
            <div className="rounded-md border bg-bg-panel px-3 py-3 text-xs">
              <div className="text-sm font-semibold text-fg">Undo is available</div>
              <p className="mt-1 text-fg-muted">
                Use Recovery & Undo in the main app to return to a saved checkpoint.
              </p>
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-md border bg-bg-panel px-3 py-2.5 text-xs">
            <input
              type="checkbox"
              checked={resetNextSession}
              onChange={(e) => {
                setResetNextSession(e.target.checked);
                window.localStorage.setItem("dive:reset-next-session", String(e.target.checked));
              }}
              data-testid="policy-reset-next"
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              <span className="block text-sm font-medium text-fg">
                Reset approval shortcuts next session
              </span>
              <span className="block text-fg-muted">
                Recommended: forget advanced auto-approval shortcuts when a new session starts.
              </span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-advanced">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              4 · Advanced
            </p>
            <h2 className="text-lg font-semibold">Advanced</h2>
            <p className="text-xs text-fg-muted">
              Optional tools for experienced users. You can ignore this section at first.
            </p>
          </div>

          <details
            className="rounded-md border bg-bg-panel px-3 py-3"
            data-testid="settings-section-policy"
          >
            <summary className="cursor-pointer text-sm font-semibold text-fg">
              Automatic safe-read approvals
            </summary>
            <p className="mt-2 text-xs text-fg-muted">
              Advanced shortcut: only safe read tools can be auto-approved. File edits and commands
              still require manual approval.
            </p>
            <LearningHint className="mt-2 text-xs">
              Warning and danger tools always stay manual.
            </LearningHint>
            <div className="mt-3 flex flex-col gap-2" data-testid="policy-tool-list">
              {SAFE_TOOLS.map((tool) => {
                const on = policy.rules[tool] === "always";
                return (
                  <label
                    key={tool}
                    className="flex items-center justify-between rounded-md border bg-bg px-3 py-2"
                    data-testid="policy-row"
                    data-tool={tool}
                  >
                    <div>
                      <div className="text-sm font-medium">{tool}</div>
                      <div className="text-[10px] text-fg-muted">
                        Safe read · auto-approval allowed
                      </div>
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
                  className="flex items-center justify-between rounded-md border bg-bg px-3 py-2 opacity-60"
                  data-testid="policy-row-locked"
                  data-tool={tool}
                >
                  <div>
                    <div className="text-sm font-medium">{tool}</div>
                    <div className="text-[10px] text-fg-muted">Changes files · always manual</div>
                  </div>
                  <input type="checkbox" disabled className="h-4 w-4" />
                </div>
              ))}
            </div>
          </details>

          <details
            className="rounded-md border bg-bg-panel px-3 py-3"
            data-testid="settings-section-mcp"
          >
            <summary className="cursor-pointer text-sm font-semibold text-fg">
              MCP servers for extra tools
            </summary>
            <LearningHint className="mt-2 text-xs">
              Model Context Protocol servers add advanced tools. Tool calls still route through
              permission cards.
            </LearningHint>
            <div className="mt-3 flex flex-col gap-2" data-testid="mcp-server-list">
              {mcpServers.length === 0 ? (
                <div
                  className="rounded-md border border-dashed bg-bg px-3 py-6 text-center text-xs text-fg-muted"
                  data-testid="mcp-empty"
                >
                  No MCP servers added.
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
                        Test
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleMcpRemove(s.id)}
                        data-testid="mcp-remove"
                        data-mcp-label={s.label}
                      >
                        Remove
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
              <div className="text-xs font-medium">Add MCP server</div>
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
                <span className="text-[11px] text-fg-muted">Default risk:</span>
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
                  {mcpBusy ? "Adding…" : "Add"}
                </Button>
              </div>
            </div>
          </details>

          {internalResearchEnabled && researchSettings.controls_enabled ? (
            <details
              className="rounded-md border border-warn/50 bg-bg-panel px-3 py-3"
              data-testid="settings-section-diagnostics"
            >
              <summary className="cursor-pointer text-sm font-semibold text-warn">
                Internal diagnostics
              </summary>
              <div className="mt-3 flex items-start justify-between gap-4 rounded-md border border-warn/40 bg-bg px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">Internal gate diagnostics</div>
                  <div className="mt-1 text-[11px] text-fg-muted">
                    Use only for internal diagnostic sessions. When enabled, DIVE bypasses chat
                    gates and records <code>gate_bypassed</code> in EventLog.
                  </div>
                  <LearningHint className="mt-2 text-xs">
                    Default is OFF. This option is available only in internal/dev builds.
                  </LearningHint>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={openDiagnosticsSurvey}
                    data-testid="settings-open-diagnostics-survey"
                  >
                    Open diagnostics survey
                  </Button>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={researchSettings.disable_gates}
                    onChange={(e) =>
                      void persistResearchSettings({
                        ...researchSettings,
                        disable_gates: e.target.checked,
                      })
                    }
                    data-testid="settings-research-disable-gates"
                    className="h-4 w-4"
                  />
                  Bypass gates
                </label>
              </div>
            </details>
          ) : null}
        </section>
      </div>
      <CodexOAuthDialog
        open={codexDialogOpen}
        onOpenChange={setCodexDialogOpen}
        onConnected={(status) => {
          void (async () => {
            const api = await loadTauri();
            if (!api && status.connected) {
              await connectProvider("codex", "mock-codex-oauth");
              return;
            }
            await loadAll();
          })().catch((err) => {
            console.warn("settings loadAll after codex oauth failed:", err);
          });
        }}
      />
    </div>
  );
}

export default SettingsPage;
