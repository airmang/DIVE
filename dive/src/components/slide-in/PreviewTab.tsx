import { useEffect, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";

const PREVIEW_CANDIDATES = ["http://127.0.0.1:5173", "http://localhost:5173"];

type TauriApi = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

type PreviewStartResult = {
  url: string;
  package_manager: string;
  install_ran: boolean;
  reused: boolean;
  command: string[];
  logs: string[];
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function PreviewTab() {
  const previewUrl = useSlideInStore((s) => s.previewUrl);
  const setPreviewUrl = useSlideInStore((s) => s.setPreviewUrl);
  const pushTerminalLine = useSlideInStore((s) => s.pushTerminalLine);
  const [input, setInput] = useState(previewUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setInput(previewUrl ?? "");
  }, [previewUrl]);

  const loadUrl = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("URL을 입력하세요.");
      return;
    }
    if (!isSafeUrl(trimmed)) {
      setError("http / https URL만 허용됩니다.");
      return;
    }
    setError(null);
    setStatus(null);
    setPreviewUrl(trimmed);
  };

  const loadCandidate = (url: string) => {
    setInput(url);
    setError(null);
    setStatus(null);
    setPreviewUrl(url);
  };

  const autoConnect = async () => {
    setError(null);
    setStatus("프로젝트를 확인하는 중...");
    setConnecting(true);
    try {
      const api = await loadTauri();
      if (!api) {
        throw new Error("설치 앱에서 프로젝트를 선택한 뒤 사용할 수 있습니다.");
      }
      const result = await api.invoke<PreviewStartResult>("preview_start", {
        options: { force_install: false },
      });
      setPreviewUrl(result.url);
      setInput(result.url);
      const action = result.reused
        ? "실행 중인 미리보기에 연결했습니다."
        : result.install_ran
          ? "의존성 설치 후 미리보기를 열었습니다."
          : "미리보기를 실행했습니다.";
      setStatus(`${action} (${result.url})`);
      pushTerminalLine({
        kind: "info",
        text: `[preview] ${result.package_manager} · ${result.command.join(" ")} · ${result.url}`,
      });
      for (const line of result.logs) {
        pushTerminalLine({ kind: "stdout", text: line });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus(null);
      pushTerminalLine({ kind: "stderr", text: `[preview] ${message}` });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="preview-tab">
      <header className="flex items-center gap-2 border-b bg-bg-panel2 p-2">
        <input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="http://localhost:5173"
          aria-label="미리보기 URL"
          data-testid="preview-url-input"
          className="flex-1 rounded-md border bg-bg px-3 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          onKeyDown={(e) => {
            if (e.key === "Enter") loadUrl();
          }}
        />
        <Button size="sm" variant="outline" onClick={loadUrl} data-testid="preview-load">
          열기
        </Button>
        <Button
          size="sm"
          onClick={autoConnect}
          disabled={connecting}
          data-testid="preview-auto-connect"
        >
          {connecting ? (
            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          결과 확인
        </Button>
      </header>
      {error ? (
        <p
          className="border-b border-danger/40 bg-danger/10 px-3 py-1 text-xs text-danger"
          data-testid="preview-error"
        >
          {error}
        </p>
      ) : null}
      {!error && status ? (
        <p className="border-b bg-success/10 px-3 py-1 text-xs text-success" data-testid="preview-status">
          {status}
        </p>
      ) : null}
      <div className="flex-1 overflow-hidden bg-bg-panel2">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="미리보기"
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-bg"
            data-testid="preview-iframe"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center p-6 text-center"
            data-testid="preview-empty"
          >
            <div className="max-w-sm">
              <p className="text-sm font-semibold text-fg">결과를 볼 로컬 주소를 선택하세요.</p>
              <p className="mt-2 text-sm text-fg-muted">
                웹 프로젝트 서버가 실행 중이면 아래 기본 주소로 바로 확인할 수 있습니다.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {PREVIEW_CANDIDATES.map((url) => (
                  <Button
                    key={url}
                    size="sm"
                    variant="outline"
                    onClick={() => loadCandidate(url)}
                    data-testid="preview-candidate"
                  >
                    {url}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
