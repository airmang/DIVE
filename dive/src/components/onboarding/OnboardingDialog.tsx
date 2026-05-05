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
import { useProjectSessionStore } from "../../stores/project-session";
import { useT } from "../../i18n";
import { classifyError } from "../../lib/error-classify";

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

const PROVIDER_CHOICES: Array<{ kind: string; label: string; hintKey: string }> = [
  { kind: "anthropic", label: "Anthropic", hintKey: "onboarding.provider_anthropic_hint" },
  { kind: "openai", label: "OpenAI", hintKey: "onboarding.provider_openai_hint" },
  { kind: "openrouter", label: "OpenRouter", hintKey: "onboarding.provider_openrouter_hint" },
  {
    kind: "opencode_zen",
    label: "opencode zen",
    hintKey: "onboarding.provider_opencode_zen_hint",
  },
];

function onboardingErrorMessage(err: unknown, t: ReturnType<typeof useT>) {
  const classified = classifyError(err);
  return t(classified.bodyKey, { message: classified.rawMessage });
}

export function OnboardingDialog({ open, onOpenChange, onConnected }: Props) {
  const t = useT();
  const connectProvider = useProjectSessionStore((s) => s.connectProvider);
  const [kind, setKind] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError(t("onboarding.api_key_required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await connectProvider(kind, apiKey.trim());
      onOpenChange(false);
      onConnected?.();
    } catch (err) {
      setError(onboardingErrorMessage(err, t));
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="onb-provider-list">
              {PROVIDER_CHOICES.map((p) => (
                <button
                  key={p.kind}
                  type="button"
                  onClick={() => setKind(p.kind)}
                  data-testid={`onb-kind-${p.kind}`}
                  data-selected={kind === p.kind}
                  className={
                    kind === p.kind
                      ? "rounded-md border-2 border-accent bg-accent-subtle px-3 py-2 text-left"
                      : "rounded-md border px-3 py-2 text-left hover:bg-bg-panel2"
                  }
                >
                  <div className="text-sm font-medium text-fg">{p.label}</div>
                  <div className="text-[10px] text-fg-muted">{t(p.hintKey)}</div>
                </button>
              ))}
            </div>
            <a
              href={PROVIDER_LINKS[kind]}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-accent underline underline-offset-2"
              data-testid="onb-key-link"
            >
              {t("onboarding.key_link")}
            </a>
            {kind === "opencode_zen" ? (
              <p className="text-[10px] text-warn" data-testid="onb-opencode-warning">
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
          </div>
          {error ? (
            <p className="text-xs text-danger" role="alert" data-testid="onb-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} data-testid="onb-skip" disabled={submitting}>
            {t("onboarding.skip")}
          </Button>
          <Button onClick={handleConnect} data-testid="onb-connect" disabled={submitting}>
            {submitting ? t("onboarding.connecting") : t("onboarding.connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OnboardingDialog;
