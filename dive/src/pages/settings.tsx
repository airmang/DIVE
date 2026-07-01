import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useTheme } from "../hooks/useTheme";
import { useProjectSessionStore, type ProviderSummary } from "../stores/project-session";
import { CodexOAuthDialog } from "../components/codex/CodexOAuthDialog";
import { LOCALE_LABEL, SUPPORTED_LOCALES, useLocaleStore, useT, type Locale } from "../i18n";
import { LearningHint } from "../components/ui/learning-hint";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { ProviderModelSelector } from "../components/settings/ProviderModelSelector";
import type { ScaffoldMode } from "../features/provocation";

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
const REVIEW_CARD_MODES: ScaffoldMode[] = ["guided", "work"];

const DEFAULT_PROVIDER_HOSTS: Record<string, string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  openrouter: "openrouter.ai",
  opencode_zen: "opencode.ai",
};

const PROVIDER_KINDS: Array<{
  kind: string;
  label: string;
  hintKey: string;
  ga: boolean;
  warning?: { textKey: string; href: string; linkLabelKey: string };
}> = [
  {
    kind: "anthropic",
    label: "Anthropic",
    hintKey: "onboarding.provider_anthropic_hint",
    ga: true,
  },
  { kind: "openai", label: "OpenAI", hintKey: "onboarding.provider_openai_hint", ga: true },
  {
    kind: "openrouter",
    label: "OpenRouter",
    hintKey: "onboarding.provider_openrouter_hint",
    ga: true,
  },
  {
    kind: "opencode_zen",
    label: "opencode zen",
    hintKey: "onboarding.provider_opencode_zen_hint",
    ga: false,
    warning: {
      textKey: "runtime.capability.reasons.provider_not_pi_capable",
      href: "https://opencode.ai/docs/zen/",
      linkLabelKey: "onboarding.details",
    },
  },
  {
    kind: "codex",
    label: "Codex (ChatGPT OAuth)",
    hintKey: "settings.provider_codex_hint",
    ga: true,
  },
  ...(import.meta.env.DEV
    ? [
        {
          kind: "mock",
          label: "Mock (개발 전용)",
          hintKey: "settings.provider_mock_hint",
          ga: false,
        },
      ]
    : []),
];

const DevMcpSettingsSection = import.meta.env.DEV ? lazy(() => import("./settings-mcp-dev")) : null;

function usesNonDefaultProviderHost(provider: ProviderSummary | undefined) {
  if (!provider?.base_url) return false;
  try {
    const host = new URL(provider.base_url).hostname;
    return host !== DEFAULT_PROVIDER_HOSTS[provider.kind];
  } catch {
    return true;
  }
}

export function SettingsPage() {
  const t = useT();
  const internalResearchEnabled = import.meta.env.DEV;
  const { theme, toggleTheme } = useTheme();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const tutorialEnabled = useUiPreferencesStore((s) => s.tutorialEnabled);
  const setTutorialEnabled = useUiPreferencesStore((s) => s.setTutorialEnabled);
  const enableProvocationCards = useUiPreferencesStore((s) => s.enableProvocationCards);
  const setEnableProvocationCards = useUiPreferencesStore((s) => s.setEnableProvocationCards);
  const provocationScaffoldMode = useUiPreferencesStore((s) => s.provocationScaffoldMode);
  const setProvocationScaffoldMode = useUiPreferencesStore((s) => s.setProvocationScaffoldMode);
  const loaded = useProjectSessionStore((s) => s.loaded);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const providers = useProjectSessionStore((s) => s.providers);
  const connectProvider = useProjectSessionStore((s) => s.connectProvider);
  const selectProvider = useProjectSessionStore((s) => s.selectProvider);
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
  const [selectingProviderId, setSelectingProviderId] = useState<number | null>(null);
  const [codexDialogOpen, setCodexDialogOpen] = useState(false);

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
      } catch (err) {
        console.warn("settings: corrupted policy json", err);
      }
    })();
  }, [internalResearchEnabled]);

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
    if (!window.confirm(t("settings.disconnect_codex_confirm"))) return;
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
    if (!window.confirm(t("settings.disconnect_confirm", { kind: row.kind }))) return;
    await disconnectProvider(row.id);
  };

  const handleSelectProvider = async (row: ProviderSummary) => {
    setSelectingProviderId(row.id);
    try {
      await selectProvider(row.id);
      await loadAll();
    } finally {
      setSelectingProviderId(null);
    }
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
            {t("common.back")}
          </Button>
          <h1 className="text-2xl font-bold">{t("common.settings")}</h1>
          <div />
        </div>

        <section className="flex flex-col gap-3" data-testid="settings-section-general">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              1 · {t("settings.general_eyebrow")}
            </p>
            <h2 className="text-lg font-semibold">{t("settings.general_title")}</h2>
            <p className="text-xs text-fg-muted">{t("settings.general_description")}</p>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">{t("settings.language_title")}</div>
              <div className="text-[11px] text-fg-muted">{t("settings.language_description")}</div>
            </div>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="rounded-md border bg-bg px-2 py-1 text-sm"
              data-testid="settings-locale-select"
              aria-label={t("settings.language_aria")}
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
              <div className="text-sm font-medium">{t("settings.theme_title")}</div>
              <div className="text-[11px] text-fg-muted">
                {theme === "dark" ? t("settings.theme_dark") : t("settings.theme_light")}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              data-testid="settings-theme-toggle"
              data-theme={theme}
            >
              {theme === "dark" ? t("settings.theme_to_light") : t("settings.theme_to_dark")}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-bg-panel px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">{t("settings.guided_help_title")}</div>
              <div className="text-[11px] text-fg-muted">
                {t("settings.guided_help_description")}
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={tutorialEnabled}
                onChange={(e) => setTutorialEnabled(e.target.checked)}
                data-testid="settings-tutorial-toggle"
                className="h-4 w-4"
                aria-label={t("settings.guided_help_title")}
              />
            </label>
          </div>

          <div className="flex flex-col gap-3 rounded-md border bg-bg-panel px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t("settings.review_cards_title")}</div>
                <div className="text-[11px] text-fg-muted">
                  {t("settings.review_cards_description")}
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={enableProvocationCards}
                  onChange={(e) => setEnableProvocationCards(e.target.checked)}
                  data-testid="settings-review-cards-toggle"
                  className="h-4 w-4"
                  aria-label={t("settings.review_cards_title")}
                />
              </label>
            </div>

            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              role="radiogroup"
              aria-label={t("settings.review_card_mode_title")}
              data-testid="settings-review-card-mode"
            >
              {REVIEW_CARD_MODES.map((mode) => {
                const selected = provocationScaffoldMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={[
                      "rounded-md border px-3 py-2 text-left text-xs transition",
                      selected
                        ? "border-accent bg-accent/10 text-fg"
                        : "border-border bg-bg text-fg-muted hover:text-fg",
                    ].join(" ")}
                    onClick={() => setProvocationScaffoldMode(mode)}
                    data-testid={`settings-review-card-mode-${mode}`}
                    data-selected={selected ? "true" : "false"}
                  >
                    <span className="block text-sm font-semibold">
                      {t(`settings.review_card_mode_${mode}`)}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug">
                      {t(`settings.review_card_mode_${mode}_description`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-providers">
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              2 · {t("settings.ai_connection_eyebrow")}
            </p>
            <h2 className="mt-1 text-xl font-bold text-fg">{t("settings.ai_connection_title")}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t("settings.ai_connection_description")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="provider-cards">
            {PROVIDER_KINDS.map((p) => {
              const isCodex = p.kind === "codex";
              const connected =
                providers.find((x) => x.kind === p.kind && x.is_connected && x.is_active) ??
                providers.find((x) => x.kind === p.kind && x.is_connected);
              const codexAccountId = isCodex ? connected?.account_id : null;
              const expanded = expandedKind === p.kind;
              const isActive = connected?.is_active === true;
              return (
                <Card
                  key={p.kind}
                  className="flex flex-col gap-2 p-4"
                  data-testid="provider-card"
                  data-provider-kind={p.kind}
                  data-connected={connected ? "true" : "false"}
                  data-active={isActive ? "true" : "false"}
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
                          aria-label={
                            connected
                              ? t("settings.provider_connected_aria")
                              : t("settings.provider_disconnected_aria")
                          }
                        />
                        {isActive ? (
                          <span
                            className="rounded-sm bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-fg"
                            data-testid="provider-active-badge"
                          >
                            {t("settings.active_provider")}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-fg-muted">{t(p.hintKey)}</div>
                      {usesNonDefaultProviderHost(connected) ? (
                        <div className="mt-1 text-[11px] text-warn" data-testid="base-url-warning">
                          {t("settings.base_url_warning")}
                        </div>
                      ) : null}
                      {p.warning ? (
                        <div className="mt-1 text-[11px] text-warn" data-testid="provider-warning">
                          {t(p.warning.textKey)} (
                          <a
                            href={p.warning.href}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                          >
                            {t(p.warning.linkLabelKey)}
                          </a>
                          )
                        </div>
                      ) : null}
                      {isCodex && connected && codexAccountId ? (
                        <div
                          className="mt-1 text-[10px] text-fg-muted"
                          data-testid="codex-account-id"
                        >
                          {t("settings.account_label")}: <code>{codexAccountId}</code>
                        </div>
                      ) : null}
                    </div>
                    {connected ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {!isActive ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void handleSelectProvider(connected)}
                            disabled={selectingProviderId === connected.id}
                            data-testid="provider-select"
                            data-provider-kind={p.kind}
                          >
                            {selectingProviderId === connected.id
                              ? t("settings.selecting_provider")
                              : t("settings.use_provider")}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void (isCodex ? handleCodexDisconnect() : handleDisconnect(connected))
                          }
                          data-testid="provider-disconnect"
                          data-provider-kind={p.kind}
                        >
                          {t("settings.disconnect")}
                        </Button>
                      </div>
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
                        {p.ga
                          ? isCodex
                            ? t("settings.connect_chatgpt")
                            : t("settings.connect")
                          : t("settings.coming_soon")}
                      </Button>
                    )}
                  </div>
                  {!isCodex && expanded && p.ga ? (
                    <div className="flex flex-col gap-2 border-t pt-2">
                      <Input
                        type="password"
                        placeholder={t("settings.api_key_placeholder")}
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
                        {connecting ? t("settings.connecting") : t("settings.save_and_connect")}
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

        <section className="flex flex-col gap-3" data-testid="settings-section-safety">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              3 · {t("settings.safety_eyebrow")}
            </p>
            <h2 className="text-lg font-semibold">{t("settings.safety_title")}</h2>
            <p className="text-xs text-fg-muted">{t("settings.safety_description")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-bg-panel px-3 py-3 text-xs">
              <div className="text-sm font-semibold text-fg">
                {t("settings.safety_control_title")}
              </div>
              <p className="mt-1 text-fg-muted">{t("settings.safety_control_description")}</p>
            </div>
            <div className="rounded-md border bg-bg-panel px-3 py-3 text-xs">
              <div className="text-sm font-semibold text-fg">
                {t("settings.safety_blocked_title")}
              </div>
              <p className="mt-1 text-fg-muted">{t("settings.safety_blocked_description")}</p>
            </div>
            <div className="rounded-md border bg-bg-panel px-3 py-3 text-xs">
              <div className="text-sm font-semibold text-fg">{t("settings.safety_undo_title")}</div>
              <p className="mt-1 text-fg-muted">{t("settings.safety_undo_description")}</p>
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
                {t("settings.reset_approvals_title")}
              </span>
              <span className="block text-fg-muted">
                {t("settings.reset_approvals_description")}
              </span>
            </span>
          </label>
        </section>

        <section className="flex flex-col gap-3" data-testid="settings-section-advanced">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">
              4 · {t("settings.advanced_eyebrow")}
            </p>
            <h2 className="text-lg font-semibold">{t("settings.advanced_title")}</h2>
            <p className="text-xs text-fg-muted">{t("settings.advanced_description")}</p>
          </div>

          <details
            className="rounded-md border bg-bg-panel px-3 py-3"
            data-testid="settings-section-policy"
          >
            <summary className="cursor-pointer text-sm font-semibold text-fg">
              {t("settings.auto_approval_title")}
            </summary>
            <p className="mt-2 text-xs text-fg-muted">{t("settings.auto_approval_description")}</p>
            <LearningHint className="mt-2 text-xs">{t("settings.auto_approval_hint")}</LearningHint>
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
                        {t("settings.safe_read_auto_allowed")}
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
                    <div className="text-[10px] text-fg-muted">
                      {t("settings.file_changes_always_manual")}
                    </div>
                  </div>
                  <input type="checkbox" disabled className="h-4 w-4" />
                </div>
              ))}
            </div>
          </details>

          {DevMcpSettingsSection ? (
            <Suspense fallback={null}>
              <DevMcpSettingsSection />
            </Suspense>
          ) : null}

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
