import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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

  const startFlow = async () => {
    setError(null);
    setBusy(true);
    try {
      const api = await loadTauri();
      if (!api) {
        const stateValue = "browser-mock-state";
        setAuthUrl(
          `https://auth.openai.com/oauth/authorize?response_type=code&client_id=browser-mock&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback&state=${stateValue}`,
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
          <DialogTitle>ChatGPT 구독 연결 (Codex OAuth)</DialogTitle>
          <DialogDescription>
            ChatGPT Plus/Pro/Team/Enterprise 구독을 통해 DIVE가 모델을 호출합니다. PKCE 기반이며 API
            키 없이 동작합니다.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" ? (
          <div className="flex flex-col gap-3" data-testid="codex-phase-idle">
            <p className="text-sm text-fg-muted">
              [시작] 버튼을 누르면 브라우저에서 ChatGPT 로그인 페이지가 열립니다. 인증 후 리다이렉트
              URL(`http://localhost:1455/callback?...`)에 포함된 `code`와 `state`를 여기에 붙여
              넣으세요.
            </p>
            <Button onClick={startFlow} disabled={busy} data-testid="codex-start">
              {busy ? "준비 중…" : "ChatGPT로 로그인 시작"}
            </Button>
          </div>
        ) : null}

        {phase === "waiting" && authUrl ? (
          <div className="flex flex-col gap-3" data-testid="codex-phase-waiting">
            <p className="text-xs text-fg-muted">
              아래 버튼으로 인증 페이지를 여세요. 로그인 후 브라우저가 이동하는 URL에서 `code=` 와
              `state=` 값을 찾아 아래에 입력합니다. state는 CSRF 보호용으로 반드시 시작 시 생성된
              값과 일치해야 합니다.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openInBrowser}
                data-testid="codex-open-browser"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                브라우저에서 열기
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
                code
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="리다이렉트 URL의 ?code=… 값"
                  data-testid="codex-code-input"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="text-xs font-medium">
                state
                <Input
                  value={returnedState}
                  onChange={(e) => setReturnedState(e.target.value)}
                  placeholder="리다이렉트 URL의 &state=… 값"
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
                기대 state: <code>{csrfState ?? ""}</code>
              </p>
              <Button
                onClick={completeFlow}
                disabled={busy || !code.trim() || !returnedState.trim()}
                data-testid="codex-complete"
              >
                {busy ? "토큰 교환 중…" : "연결 완료"}
              </Button>
            </div>
          </div>
        ) : null}

        {phase === "done" ? (
          <div
            className="flex flex-col gap-2 rounded-md border bg-success/10 p-3 text-sm"
            data-testid="codex-phase-done"
          >
            <div className="font-medium text-success">연결 완료</div>
            <div className="text-fg-muted">
              토큰이 OS Keyring에 저장되었습니다. 채팅에서 Codex 프로바이더를 선택할 수 있습니다.
            </div>
          </div>
        ) : null}

        {phase === "error" && error ? (
          <div
            className="flex flex-col gap-2 rounded-md border border-danger bg-danger/10 p-3 text-sm"
            data-testid="codex-phase-error"
          >
            <div className="font-medium text-danger">오류</div>
            <code className="text-[11px]" data-testid="codex-error-message">
              {error}
            </code>
            <Button size="sm" variant="outline" onClick={() => setPhase("idle")}>
              다시 시도
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default CodexOAuthDialog;
