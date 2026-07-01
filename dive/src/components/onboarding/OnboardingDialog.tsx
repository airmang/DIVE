import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CodexOAuthDialog } from "../codex/CodexOAuthDialog";
import { useProjectSessionStore } from "../../stores/project-session";
import { useT } from "../../i18n";
import { classifyError } from "../../lib/error-classify";

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}

const PROVIDER_LINKS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
  opencode_zen: "https://opencode.ai/docs/zen/",
};

const PROVIDER_CHOICES: Array<{
  kind: string;
  label: string;
  hintKey: string;
  available?: boolean;
  unavailableKey?: string;
}> = [
  { kind: "anthropic", label: "Anthropic", hintKey: "onboarding.provider_anthropic_hint" },
  { kind: "openai", label: "OpenAI", hintKey: "onboarding.provider_openai_hint" },
  { kind: "openrouter", label: "OpenRouter", hintKey: "onboarding.provider_openrouter_hint" },
  {
    kind: "opencode_zen",
    label: "opencode zen",
    hintKey: "onboarding.provider_opencode_zen_hint",
    available: false,
    // S-045 (P2-21): beginner-facing reason, not the internal "Pi 런타임" jargon.
    unavailableKey: "onboarding.provider_unavailable_beginner",
  },
  { kind: "codex", label: "Codex", hintKey: "onboarding.provider_codex_hint" },
];

interface OnboardingErrorState {
  headline: string;
  hints?: string[];
  raw?: string;
  showKeyLink?: boolean;
}

// S-046 (P1-05/P2-20): render the classified recovery hints as plain-Korean
// bullets and keep the raw English provider tail behind a collapsed toggle, so
// the primary onboarding error message is never a bare English string.
function onboardingError(err: unknown, t: ReturnType<typeof useT>): OnboardingErrorState {
  const classified = classifyError(err);
  const headline =
    classified.kind === "unknown" ? t("onboarding.connect_failed_generic") : t(classified.titleKey);
  const hints = t(classified.hintsKey)
    .split("|")
    .map((hint) => hint.trim())
    .filter((hint) => hint.length > 0);
  return { headline, hints, raw: classified.rawMessage, showKeyLink: true };
}

export function OnboardingDialog({ open, onOpenChange, onConnected }: Props) {
  const t = useT();
  const connectProvider = useProjectSessionStore((s) => s.connectProvider);
  const loadAll = useProjectSessionStore((s) => s.loadAll);
  const [kind, setKind] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<OnboardingErrorState | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const selectedProvider = PROVIDER_CHOICES.find((provider) => provider.kind === kind);
  const providerUnavailable = selectedProvider?.available === false;
  const isCodex = kind === "codex";

  const handleCodexConnected = (connected: boolean) => {
    void (async () => {
      try {
        if (!hasTauriRuntime() && connected) {
          await connectProvider("codex", "mock-codex-oauth");
        } else {
          await loadAll();
        }
      } catch (err) {
        console.warn("onboarding codex connect refresh failed:", err);
      } finally {
        setCodexOpen(false);
        onOpenChange(false);
        onConnected?.();
      }
    })();
  };

  const handleConnect = async () => {
    if (providerUnavailable) {
      setError({
        headline: t(
          selectedProvider?.unavailableKey ?? "runtime.capability.reasons.runtime_unavailable",
        ),
      });
      return;
    }
    if (!apiKey.trim()) {
      setError({ headline: t("onboarding.api_key_required") });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await connectProvider(kind, apiKey.trim());
      onOpenChange(false);
      onConnected?.();
    } catch (err) {
      setError(onboardingError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="onboarding-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("onboarding.title")}</DialogTitle>
          <DialogDescription>{t("onboarding.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="onb-kind">
              {t("onboarding.provider_label")}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="onb-provider-list">
              {PROVIDER_CHOICES.map((p) => (
                <button
                  key={p.kind}
                  type="button"
                  disabled={p.available === false}
                  onClick={() => {
                    if (p.available === false) return;
                    setKind(p.kind);
                  }}
                  data-testid={`onb-kind-${p.kind}`}
                  data-selected={kind === p.kind}
                  data-unavailable={p.available === false ? "true" : "false"}
                  className={
                    kind === p.kind
                      ? "rounded-md border-2 border-accent bg-accent-subtle px-3 py-2 text-left"
                      : p.available === false
                        ? "cursor-not-allowed rounded-md border px-3 py-2 text-left opacity-60"
                        : "rounded-md border px-3 py-2 text-left hover:bg-bg-panel2"
                  }
                >
                  <div className="text-sm font-medium text-fg">{p.label}</div>
                  <div className="text-xs text-fg-muted">
                    {p.available === false && p.unavailableKey ? t(p.unavailableKey) : t(p.hintKey)}
                  </div>
                </button>
              ))}
            </div>
            {PROVIDER_LINKS[kind] && !providerUnavailable ? (
              <a
                href={PROVIDER_LINKS[kind]}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-accent underline underline-offset-2"
                data-testid="onb-key-link"
              >
                {t("onboarding.key_link")}
              </a>
            ) : null}
            {kind === "opencode_zen" ? (
              <p className="text-[11px] text-warn" data-testid="onb-opencode-warning">
                {t("onboarding.opencode_warning")} (
                <a
                  href="https://opencode.ai/docs/zen/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {t("onboarding.details")}
                </a>
                )
              </p>
            ) : null}
          </div>
          {isCodex ? (
            <div className="flex flex-col gap-2" data-testid="onb-codex-block">
              <p className="text-xs text-fg-muted">{t("onboarding.codex_note")}</p>
              <Button
                variant="outline"
                onClick={() => setCodexOpen(true)}
                data-testid="onb-codex-signin"
              >
                {t("onboarding.codex_signin")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted" htmlFor="onb-api-key">
                {t("onboarding.api_key_label")}
              </label>
              <Input
                id="onb-api-key"
                data-testid="onb-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
              {/* S-045 (P1-04): plain-Korean gloss + local-storage reassurance + default nudge. */}
              <p className="text-xs text-fg-muted" data-testid="onb-api-key-help">
                {t("onboarding.api_key_help")}
              </p>
            </div>
          )}
          {error ? (
            <div className="text-xs text-danger" role="alert" data-testid="onb-error">
              <p className="font-medium">{error.headline}</p>
              {error.hints && error.hints.length > 0 ? (
                <ul
                  className="mt-1 list-inside list-disc space-y-0.5 text-fg-muted"
                  data-testid="onb-error-hints"
                >
                  {error.hints.map((hint, index) => (
                    <li key={index}>{hint}</li>
                  ))}
                </ul>
              ) : null}
              {error.showKeyLink && PROVIDER_LINKS[kind] && !providerUnavailable ? (
                <a
                  href={PROVIDER_LINKS[kind]}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-accent underline underline-offset-2"
                  data-testid="onb-error-key-link"
                >
                  {t("onboarding.key_link")}
                </a>
              ) : null}
              {error.raw ? (
                <details className="mt-1" data-testid="onb-error-detail">
                  <summary className="cursor-pointer text-fg-muted">
                    {t("onboarding.details")}
                  </summary>
                  <p className="mt-1 break-words font-mono text-[10px] text-fg-muted">
                    {error.raw}
                  </p>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} data-testid="onb-skip" disabled={submitting}>
            {t("onboarding.skip")}
          </Button>
          {isCodex ? null : (
            <Button
              onClick={handleConnect}
              data-testid="onb-connect"
              disabled={submitting || providerUnavailable}
            >
              {submitting ? t("onboarding.connecting") : t("onboarding.connect")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      <CodexOAuthDialog
        open={codexOpen}
        onOpenChange={setCodexOpen}
        onConnected={(status) => handleCodexConnected(status.connected)}
      />
    </Dialog>
  );
}

export default OnboardingDialog;
