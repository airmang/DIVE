import { useEffect, useState } from "react";
import {
  ChevronDown,
  FileCode,
  LoaderCircle,
  Monitor,
  Play,
  RotateCcw,
  Smartphone,
  Tablet,
} from "lucide-react";
import { useProjectSessionStore } from "../../stores/project-session";
import { useSlideInStore } from "../../stores/slideIn";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
import type { PreviewSessionKind } from "./types";
import { PreviewOnboardingCoachmark } from "./PreviewOnboardingCoachmark";
import { previewModeHint } from "./previewModeHint";
import { loadTauri, type TauriApi } from "../../lib/tauri";
import { runUserAction } from "../../lib/runUserAction";

const PREVIEW_CANDIDATES = ["http://127.0.0.1:5173", "http://localhost:5173"];
const STATIC_PREVIEW_CANDIDATES = ["index.html"];

/**
 * Responsive preview widths (S-031): selecting a preset constrains the iframe
 * render width so responsive breakpoints become observable in-app. `desktop`
 * uses the full panel width.
 */
type PreviewViewport = "mobile" | "tablet" | "desktop";
const VIEWPORT_WIDTH: Record<PreviewViewport, number | null> = {
  mobile: 375,
  tablet: 768,
  desktop: null,
};
const PREVIEW_VIEWPORTS: PreviewViewport[] = ["mobile", "tablet", "desktop"];

function viewportIcon(viewport: PreviewViewport) {
  const cls = "h-3.5 w-3.5";
  if (viewport === "mobile") return <Smartphone className={cls} aria-hidden />;
  if (viewport === "tablet") return <Tablet className={cls} aria-hidden />;
  return <Monitor className={cls} aria-hidden />;
}

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

const KNOWN_PREVIEW_REASONS = new Set([
  "missing_project",
  "missing_target",
  "missing_static_file",
  "missing_package_json",
  "missing_dev_or_start_script",
  "local_url_unreachable",
  "dev_server_unavailable",
  "unsupported_extension",
  "project_escape",
  "unsupported_url",
]);

const REUSED_PREVIEW_LOG_CODES = new Set(["running_server_detected", "previously_started_reused"]);

function previewSessionKind(kind: PreviewOpenKind): PreviewSessionKind | undefined {
  return kind === "auto" ? undefined : kind;
}

function staticTargetFromRememberedUrl(lastUrl: string): string {
  try {
    const url = new URL(lastUrl);
    const target = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return target || lastUrl;
  } catch {
    return lastUrl;
  }
}

/**
 * Localized message for a known backend preview reason code (so the UI shows a
 * translated sentence instead of a raw code / Korean backend string). Returns
 * null for unknown codes so callers fall back to the raw message — no regression.
 */
function previewReasonText(
  reasonCode: string | null | undefined,
  t: (key: string) => string,
): string | null {
  return reasonCode && KNOWN_PREVIEW_REASONS.has(reasonCode)
    ? t(`slide_in.preview.reason.${reasonCode}`)
    : null;
}

function previewLogText(line: string, t: (key: string) => string): string {
  return REUSED_PREVIEW_LOG_CODES.has(line) ? t(`slide_in.preview.reused.${line}`) : line;
}

export function PreviewTab() {
  const t = useT();
  const previewUrl = useSlideInStore((s) => s.previewUrl);
  const previewSession = useSlideInStore((s) => s.previewSession);
  const previewRequestContext = useSlideInStore((s) => s.previewRequestContext);
  const setPreviewUrl = useSlideInStore((s) => s.setPreviewUrl);
  const setPreviewSession = useSlideInStore((s) => s.setPreviewSession);
  const pushTerminalLine = useSlideInStore((s) => s.pushTerminalLine);
  const currentProjectId = useProjectSessionStore((s) => s.currentProjectId);
  const setProjectPreviewMode = useUiPreferencesStore((s) => s.setProjectPreviewMode);
  const rememberedPreview = useUiPreferencesStore((s) =>
    currentProjectId === null ? null : (s.previewModeByProject[currentProjectId] ?? null),
  );
  const rememberedLastUrl = rememberedPreview?.lastUrl ?? "";
  const rememberedModeHint = previewModeHint(rememberedPreview?.kind);
  const [input, setInput] = useState(() => previewUrl ?? rememberedLastUrl);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [staticPath, setStaticPath] = useState(() =>
    rememberedPreview?.kind === "static_file"
      ? staticTargetFromRememberedUrl(rememberedLastUrl)
      : "",
  );
  const [showOtherPreviewWays, setShowOtherPreviewWays] = useState(false);
  const viewportWidth = VIEWPORT_WIDTH[viewport];
  const modeHint = previewModeHint(previewSession?.kind);

  useEffect(() => {
    if (previewUrl) {
      setInput(previewUrl);
      return;
    }
    if (rememberedPreview?.kind === "static_file") {
      setInput(rememberedLastUrl);
      setStaticPath(staticTargetFromRememberedUrl(rememberedLastUrl));
      return;
    }
    setInput(rememberedLastUrl);
  }, [previewUrl, rememberedLastUrl, rememberedPreview?.kind]);

  const applyPreviewResponse = (api: TauriApi, result: PreviewOpenResponse) => {
    const displayUrl =
      result.previewUrl ?? (result.assetFilePath ? api.convertFileSrc(result.assetFilePath) : null);
    const resolvedKind = previewSessionKind(result.kind);
    setPreviewSession({
      requestId: result.requestId,
      status: result.status,
      kind: resolvedKind,
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
      if (currentProjectId !== null && resolvedKind) {
        setProjectPreviewMode(currentProjectId, {
          kind: resolvedKind,
          lastUrl: displayUrl,
        });
      }
    } else {
      setError(previewReasonText(result.reasonCode, t) ?? result.message);
      setStatus(null);
    }
    if (result.commandSummary) {
      pushTerminalLine({ kind: "info", text: `[preview] ${result.commandSummary}` });
    }
    for (const line of result.logs) {
      pushTerminalLine({ kind: "stdout", text: previewLogText(line, t) });
    }
    if (result.status !== "ready") {
      const displayMessage = previewReasonText(result.reasonCode, t) ?? result.message;
      pushTerminalLine({ kind: "stderr", text: `[preview] ${displayMessage}` });
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
    await runUserAction(
      () => openPreview("local_url", url),
      (err) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        pushTerminalLine({ kind: "stderr", text: `[preview] ${message}` });
      },
    );
    setConnecting(false);
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
      await openPreview("auto");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus(null);
      pushTerminalLine({ kind: "stderr", text: `[preview] ${message}` });
    } finally {
      setConnecting(false);
    }
  };

  const reopenRememberedPreview = async () => {
    if (!rememberedPreview) return;
    const target = rememberedPreview.lastUrl ?? "";
    if (rememberedPreview.kind !== "dev_server" && target.trim().length === 0) {
      setError(t("slide_in.preview.reason.missing_target"));
      return;
    }
    setError(null);
    setStatus(t("slide_in.preview.checking_project"));
    setConnecting(true);
    try {
      // Dev-server memory never writes the remembered URL directly; Rust re-checks or starts it.
      if (rememberedPreview.kind === "dev_server") await openPreview("dev_server");
      else if (rememberedPreview.kind === "static_file")
        await openPreview("static_file", staticTargetFromRememberedUrl(target));
      else await openPreview(rememberedPreview.kind, target);
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
          {t("slide_in.preview.show_result")}
        </Button>
      </header>
      {previewUrl ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b bg-bg-panel2 px-2 py-1.5 text-xs"
          data-testid="preview-toolbar"
        >
          <span className="text-fg-muted">{t("slide_in.preview.viewport_label")}</span>
          <div
            className="flex gap-1"
            role="group"
            aria-label={t("slide_in.preview.viewport_label")}
          >
            {PREVIEW_VIEWPORTS.map((vp) => (
              <Button
                key={vp}
                size="sm"
                variant={viewport === vp ? "primary" : "outline"}
                onClick={() => setViewport(vp)}
                aria-pressed={viewport === vp}
                data-testid={`preview-viewport-${vp}`}
              >
                {viewportIcon(vp)}
                {t(`slide_in.preview.viewport_${vp}`)}
              </Button>
            ))}
          </div>
          <span className="font-mono text-fg-muted" data-testid="preview-viewport-readout">
            {viewportWidth ? `${viewportWidth}px` : t("slide_in.preview.viewport_full")}
          </span>
          {modeHint ? (
            <span
              className="rounded border border-border bg-bg px-2 py-1 font-medium text-fg-muted"
              data-testid="preview-mode-badge"
            >
              {t(`slide_in.preview.mode.${modeHint}`)}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setReloadNonce((current) => current + 1)}
            aria-label={t("slide_in.preview.reload_aria")}
            data-testid="preview-reload"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("slide_in.preview.reload")}
          </Button>
        </div>
      ) : null}
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
      <div className="flex-1 overflow-auto bg-bg-panel2">
        {previewUrl ? (
          <div
            className="mx-auto h-full"
            style={viewportWidth ? { width: viewportWidth } : undefined}
            data-testid="preview-viewport-frame"
            data-viewport={viewport}
          >
            <iframe
              key={`${previewUrl}:${reloadNonce}`}
              src={previewUrl}
              title={t("slide_in.preview.iframe_title")}
              sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
              className="h-full w-full border-0 bg-bg"
              data-testid="preview-iframe"
            />
          </div>
        ) : (
          <div
            className="flex h-full items-center justify-center p-6 text-center"
            data-testid="preview-empty"
          >
            <div className="max-w-sm">
              <PreviewOnboardingCoachmark />
              <p className="text-sm font-semibold text-fg">{t("slide_in.preview.empty_title")}</p>
              <p className="mt-2 text-sm text-fg-muted">
                {previewSession?.status === "unavailable" || previewSession?.status === "failed"
                  ? previewReasonText(previewSession.errorReason, t) ||
                    previewSession.errorReason ||
                    t(`slide_in.preview.${previewSession.status}`)
                  : t("slide_in.preview.empty_description")}
              </p>
              <p className="mt-2 text-xs text-fg-muted" data-testid="preview-mode-empty-hint">
                {t("slide_in.preview.mode.empty_hint")}
              </p>
              {rememberedPreview ? (
                <div
                  className="mt-4 flex flex-col items-center gap-2"
                  data-testid="preview-remembered-preview"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void reopenRememberedPreview()}
                    disabled={connecting}
                    data-testid="preview-reopen-last"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {t("slide_in.preview.reopen_last")}
                  </Button>
                  {rememberedModeHint ? (
                    <span
                      className="rounded border border-border bg-bg px-2 py-1 text-xs font-medium text-fg-muted"
                      data-testid="preview-remembered-mode"
                    >
                      {t(`slide_in.preview.mode.${rememberedModeHint}`)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowOtherPreviewWays((current) => !current)}
                  aria-expanded={showOtherPreviewWays}
                  data-testid="preview-other-ways-toggle"
                >
                  <ChevronDown
                    className={`mr-1.5 h-3.5 w-3.5 transition-transform ${
                      showOtherPreviewWays ? "rotate-180" : ""
                    }`}
                    aria-hidden
                  />
                  {t("slide_in.preview.other_ways")}
                </Button>
              </div>
              {showOtherPreviewWays ? (
                <div data-testid="preview-other-ways-panel">
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
                  <form
                    className="mt-3 flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = staticPath.trim();
                      if (trimmed) void loadStaticCandidate(trimmed);
                    }}
                  >
                    <input
                      type="text"
                      value={staticPath}
                      onChange={(e) => setStaticPath(e.target.value)}
                      placeholder={t("slide_in.preview.static_path_placeholder")}
                      aria-label={t("slide_in.preview.static_path_aria")}
                      data-testid="preview-static-path-input"
                      className="flex-1 rounded-md border bg-bg px-3 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={staticPath.trim().length === 0}
                      data-testid="preview-static-path-open"
                    >
                      {t("slide_in.preview.static_path_open")}
                    </Button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
