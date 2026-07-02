import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useT } from "../../i18n";

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

interface StartResponse {
  auth_url: string;
  state: string;
  provider_config_id: number;
  redirect_uri: string;
}

interface StatusResponse {
  connected: boolean;
  provider_config_id: number | null;
  account_id: string | null;
  pending: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (status: StatusResponse) => void;
  baseAuthUrl?: string;
}

export function CodexOAuthDialog({ open, onOpenChange, onConnected, baseAuthUrl }: Props) {
  const t = useT();
  const [phase, setPhase] = useState<"idle" | "waiting" | "done" | "error">("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [csrfState, setCsrfState] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [returnedState, setReturnedState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setAuthUrl(null);
      setCsrfState(null);
      setCode("");
      setReturnedState("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "waiting") return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const api = await loadTauri();
        if (!api || cancelled) return;
        const status = await api.invoke<StatusResponse>("codex_oauth_status");
        if (!cancelled && status.connected) {
          setPhase("done");
          onConnected?.(status);
          window.clearInterval(interval);
        }
      } catch {
        // Keep the manual fallback visible while the callback listener waits.
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open, phase, onConnected]);

  const startFlow = async () => {
    setError(null);
    setBusy(true);
    try {
      const api = await loadTauri();
      if (!api) {
        const stateValue = "browser-mock-state";
        setAuthUrl(
          `https://auth.openai.com/oauth/authorize?response_type=code&client_id=browser-mock&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=${stateValue}`,
        );
        setCsrfState(stateValue);
        setReturnedState(stateValue);
        setPhase("waiting");
        return;
      }
      const resp = await api.invoke<StartResponse>("codex_oauth_start", {
        baseAuthUrl: baseAuthUrl ?? null,
      });
      setAuthUrl(resp.auth_url);
      setCsrfState(resp.state);
      setReturnedState(resp.state);
      setPhase("waiting");
    } catch (err) {
      setError(String(err));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const completeFlow = async () => {
    setError(null);
    setBusy(true);
    try {
      const api = await loadTauri();
      if (!api) {
        setPhase("done");
        onConnected?.({
          connected: true,
          provider_config_id: -1,
          account_id: "acct_mock",
          pending: false,
        });
        return;
      }
      const status = await api.invoke<StatusResponse>("codex_oauth_complete", {
        code: code.trim(),
        receivedState: returnedState.trim(),
      });
      setPhase("done");
      onConnected?.(status);
    } catch (err) {
      setError(String(err));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const openInBrowser = async () => {
    if (!authUrl) return;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(authUrl);
    } catch {
      window.open(authUrl, "_blank");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="codex-oauth-dialog" data-phase={phase}>
        <DialogHeader>
          <DialogTitle>{t("codex_oauth.title")}</DialogTitle>
          <DialogDescription>{t("codex_oauth.description")}</DialogDescription>
        </DialogHeader>

        {phase === "idle" ? (
          <div className="flex flex-col gap-3" data-testid="codex-phase-idle">
            <p className="text-sm text-fg-muted">{t("codex_oauth.idle_instructions")}</p>
            <Button onClick={startFlow} disabled={busy} data-testid="codex-start">
              {busy ? t("codex_oauth.start_busy") : t("codex_oauth.start")}
            </Button>
          </div>
        ) : null}

        {phase === "waiting" && authUrl ? (
          <div className="flex flex-col gap-3" data-testid="codex-phase-waiting">
            <p className="text-xs text-fg-muted">{t("codex_oauth.waiting_instructions")}</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openInBrowser}
                data-testid="codex-open-browser"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("codex_oauth.open_browser")}
              </Button>
              <code
                className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-bg-panel2 px-2 py-1 text-xs"
                data-testid="codex-auth-url"
              >
                {authUrl}
              </code>
            </div>
            <div className="flex flex-col gap-2 border-t pt-3">
              <label className="text-xs font-medium">
                {t("codex_oauth.code_label")}
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("codex_oauth.code_placeholder")}
                  data-testid="codex-code-input"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="text-xs font-medium">
                {t("codex_oauth.state_label")}
                <Input
                  value={returnedState}
                  onChange={(e) => setReturnedState(e.target.value)}
                  placeholder={t("codex_oauth.state_placeholder")}
                  data-testid="codex-state-input"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <p
                className="text-[10px] text-fg-muted"
                data-testid="codex-state-expected"
                data-expected={csrfState ?? ""}
              >
                {t("codex_oauth.expected_state")} <code>{csrfState ?? ""}</code>
              </p>
              <Button
                onClick={completeFlow}
                disabled={busy || !code.trim() || !returnedState.trim()}
                data-testid="codex-complete"
              >
                {busy ? t("codex_oauth.complete_busy") : t("codex_oauth.complete")}
              </Button>
            </div>
          </div>
        ) : null}

        {phase === "done" ? (
          <div
            className="flex flex-col gap-2 rounded-md border bg-success/10 p-3 text-sm"
            data-testid="codex-phase-done"
          >
            <div className="font-medium text-success">{t("codex_oauth.done_title")}</div>
            <div className="text-fg-muted">{t("codex_oauth.done_body")}</div>
          </div>
        ) : null}

        {phase === "error" && error ? (
          <div
            className="flex flex-col gap-2 rounded-md border border-danger bg-danger/10 p-3 text-sm"
            data-testid="codex-phase-error"
          >
            <div className="font-medium text-danger">{t("codex_oauth.error_title")}</div>
            <code className="text-[11px]" data-testid="codex-error-message">
              {error}
            </code>
            <Button size="sm" variant="outline" onClick={() => setPhase("idle")}>
              {t("codex_oauth.retry")}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default CodexOAuthDialog;
