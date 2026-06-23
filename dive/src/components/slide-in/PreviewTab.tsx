import { useEffect, useState } from "react";
import { FileCode, LoaderCircle, Play } from "lucide-react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";
import { useT } from "../../i18n";

const PREVIEW_CANDIDATES = ["http://127.0.0.1:5173", "http://localhost:5173"];
const STATIC_PREVIEW_CANDIDATES = ["index.html"];

type TauriApi = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  convertFileSrc(path: string): string;
};

type PreviewOpenKind = "static_file" | "local_url" | "dev_server" | "auto";

type PreviewOpenResponse = {
  requestId: string;
  status: "ready" | "unavailable" | "failed";
  kind: PreviewOpenKind;
  previewUrl?: string | null;
  assetFilePath?: string | null;
  targetLabel: string;
  reasonCode?: string | null;
  message: string;
  logs: string[];
  commandSummary?: string | null;
  resolvedAt: number;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return {
    invoke: core.invoke as TauriApi["invoke"],
    convertFileSrc: core.convertFileSrc,
  };
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

export function PreviewTab() {
  const t = useT();
  const previewUrl = useSlideInStore((s) => s.previewUrl);
  const previewSession = useSlideInStore((s) => s.previewSession);
  const previewRequestContext = useSlideInStore((s) => s.previewRequestContext);
  const setPreviewUrl = useSlideInStore((s) => s.setPreviewUrl);
  const setPreviewSession = useSlideInStore((s) => s.setPreviewSession);
  const pushTerminalLine = useSlideInStore((s) => s.pushTerminalLine);
  const [input, setInput] = useState(previewUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setInput(previewUrl ?? "");
  }, [previewUrl]);

  const applyPreviewResponse = (api: TauriApi, result: PreviewOpenResponse) => {
    const displayUrl =
      result.previewUrl ?? (result.assetFilePath ? api.convertFileSrc(result.assetFilePath) : null);
    setPreviewSession({
      requestId: result.requestId,
      status: result.status,
      previewUrl: displayUrl,
      assetFilePath: result.assetFilePath ?? null,
      targetLabel: result.targetLabel,
      commandSummary: result.commandSummary ?? null,
      errorReason: result.reasonCode ?? null,
      updatedAt: result.resolvedAt,
    });
    if (result.status === "ready" && displayUrl) {
      setPreviewUrl(displayUrl);
      setInput(result.kind === "local_url" ? result.targetLabel : displayUrl);
      setStatus(`${result.message} (${result.targetLabel})`);
      setError(null);
    } else {
      setError(result.message);
      setStatus(null);
    }
    if (result.commandSummary) {
      pushTerminalLine({ kind: "info", text: `[preview] ${result.commandSummary}` });
    }
    for (const line of result.logs) {
      pushTerminalLine({ kind: "stdout", text: line });
    }
    if (result.status !== "ready") {
      pushTerminalLine({ kind: "stderr", text: `[preview] ${result.message}` });
    }
  };

  const openPreview = async (kind: PreviewOpenKind, target = "") => {
    const api = await loadTauri();
    if (!api) {
      throw new Error(t("slide_in.preview.desktop_project_required"));
    }
    const result = await api.invoke<PreviewOpenResponse>("preview_open", {
      request: {
        sessionId: previewRequestContext?.sessionId ?? null,
        cardId: previewRequestContext?.cardId ?? null,
        kind,
        target,
        source: previewRequestContext?.source ?? "student_action",
      },
    });
    applyPreviewResponse(api, result);
  };

  const loadUrl = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError(t("slide_in.preview.url_required"));
      return;
    }
    if (!isLoopbackUrl(trimmed)) {
      setError(t("slide_in.preview.url_invalid"));
      return;
    }
    setError(null);
    setStatus(null);
    setConnecting(true);
    try {
      await openPreview("local_url", trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pushTerminalLine({ kind: "stderr", text: `[preview] ${message}` });
    } finally {
      setConnecting(false);
    }
  };

  const loadCandidate = async (url: string) => {
    setInput(url);
    setError(null);
    setStatus(null);
    setConnecting(true);
    try {
      await openPreview("local_url", url);
    } finally {
      setConnecting(false);
    }
  };

  const loadStaticCandidate = async (target: string) => {
    setInput(target);
    setError(null);
    setStatus(null);
    setConnecting(true);
    try {
      await openPreview("static_file", target);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pushTerminalLine({ kind: "stderr", text: `[preview] ${message}` });
    } finally {
      setConnecting(false);
    }
  };

  const autoConnect = async () => {
    setError(null);
    setStatus(t("slide_in.preview.checking_project"));
    setConnecting(true);
    try {
      await openPreview("dev_server");
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
          aria-label={t("slide_in.preview.url_aria")}
          data-testid="preview-url-input"
          className="flex-1 rounded-md border bg-bg px-3 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadUrl();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadUrl()}
          data-testid="preview-load"
        >
          {t("slide_in.preview.open")}
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
          {t("slide_in.preview.auto_connect")}
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
        <p
          className="border-b bg-success/10 px-3 py-1 text-xs text-success"
          data-testid="preview-status"
        >
          {status}
        </p>
      ) : null}
      <div className="flex-1 overflow-hidden bg-bg-panel2">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title={t("slide_in.preview.iframe_title")}
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
              <p className="text-sm font-semibold text-fg">{t("slide_in.preview.empty_title")}</p>
              <p className="mt-2 text-sm text-fg-muted">
                {previewSession?.status === "unavailable" || previewSession?.status === "failed"
                  ? previewSession.errorReason || t(`slide_in.preview.${previewSession.status}`)
                  : t("slide_in.preview.empty_description")}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {STATIC_PREVIEW_CANDIDATES.map((target) => (
                  <Button
                    key={target}
                    size="sm"
                    variant="outline"
                    onClick={() => void loadStaticCandidate(target)}
                    data-testid="preview-static-candidate"
                  >
                    <FileCode />
                    {target}
                  </Button>
                ))}
                {PREVIEW_CANDIDATES.map((url) => (
                  <Button
                    key={url}
                    size="sm"
                    variant="outline"
                    onClick={() => void loadCandidate(url)}
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
