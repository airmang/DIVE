import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { LearningHint } from "../ui/learning-hint";
import { useLocale, useT } from "../../i18n";

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

export interface PromptIssue {
  kind: string;
  span?: [number, number] | null;
  excerpt: string;
  suggestion: string;
}

export interface PromptCheckResult {
  issues: PromptIssue[];
  refined_text: string;
  approximate_tokens: number;
}

function friendlyPromptCheckError(error: string, t: (key: string) => string): string {
  if (error.includes("tool_choice") || error.toLowerCase().includes("tool choice")) {
    return t("prompt_check.error_tool_choice");
  }
  if (error.toLowerCase().includes("not configured")) {
    return t("prompt_check.error_not_configured");
  }
  return error;
}

interface Props {
  open: boolean;
  initialText: string;
  onOpenChange: (open: boolean) => void;
  onApply: (refinedText: string, alsoSend: boolean) => void;
  mockResult?: PromptCheckResult;
}

export function PromptCheckDialog({
  open,
  initialText,
  onOpenChange,
  onApply,
  mockResult,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const [result, setResult] = useState<PromptCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setLoading(false);
      setError(null);
    }
  }, [open]);

  const runCheck = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const api = await loadTauri();
      if (api) {
        const r = await api.invoke<PromptCheckResult>("prompt_check_review", {
          text: initialText,
          locale,
        });
        setResult(r);
      } else if (mockResult) {
        setResult(mockResult);
      } else {
        setResult({
          issues: [],
          refined_text: initialText,
          approximate_tokens: 0,
        });
      }
    } catch (err) {
      setError(friendlyPromptCheckError(String(err), t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="prompt-check-dialog"
        data-phase={loading ? "loading" : result ? "done" : error ? "error" : "idle"}
      >
        <DialogHeader>
          <DialogTitle>{t("prompt_check.title")}</DialogTitle>
          <DialogDescription>
            {t("prompt_check.description")}{" "}
            <LearningHint inline className="ml-1">
              {t("prompt_check.cost_hint")}
            </LearningHint>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border bg-bg-panel p-3" data-testid="prompt-original">
            <div className="text-[11px] text-fg-muted">{t("prompt_check.original")}</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg">
              {initialText}
            </pre>
          </div>

          {!result && !loading && !error ? (
            <Button
              variant="primary"
              onClick={() => void runCheck()}
              data-testid="prompt-check-run"
            >
              {t("prompt_check.run")}
            </Button>
          ) : null}

          {loading ? (
            <div
              className="rounded-md border bg-bg-panel px-3 py-3 text-center text-xs text-fg-muted"
              data-testid="prompt-check-loading"
            >
              {t("prompt_check.loading")}
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-md border border-danger bg-danger/10 p-3 text-xs"
              data-testid="prompt-check-error"
            >
              <div className="font-medium text-danger">{t("prompt_check.error_title")}</div>
              <code>{error}</code>
            </div>
          ) : null}

          {result ? (
            <>
              <div className="rounded-md border bg-bg-panel p-3" data-testid="prompt-issues">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-fg-muted">{t("prompt_check.issues_found")}</div>
                  <Badge
                    variant={result.issues.length === 0 ? "success" : "warn"}
                    data-testid="prompt-issues-count"
                  >
                    {t("prompt_check.issues_count", { count: result.issues.length })}
                  </Badge>
                </div>
                {result.issues.length === 0 ? (
                  <div className="mt-2 text-[11px] text-fg-muted" data-testid="prompt-issues-empty">
                    {t("prompt_check.issues_empty")}
                  </div>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1.5 text-xs">
                    {result.issues.map((iss, i) => (
                      <li
                        key={i}
                        className="rounded border bg-bg px-2 py-1.5"
                        data-testid="prompt-issue"
                        data-issue-kind={iss.kind}
                      >
                        <code className="text-warn">{iss.excerpt}</code>
                        <span className="ml-1 text-fg-muted">— {iss.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div
                className="rounded-md border border-accent/40 bg-accent-subtle/30 p-3"
                data-testid="prompt-refined"
              >
                <div className="text-[11px] text-accent">{t("prompt_check.refined")}</div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg">
                  {result.refined_text || t("prompt_check.refined_empty")}
                </pre>
              </div>

              <div className="text-right text-[10px] text-fg-muted" data-testid="prompt-usage">
                {t("prompt_check.usage", { count: result.approximate_tokens })}
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="prompt-check-cancel"
          >
            {t("prompt_check.close")}
          </Button>
          {result && result.refined_text ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onApply(result.refined_text, false);
                  onOpenChange(false);
                }}
                data-testid="prompt-apply-only"
              >
                {t("prompt_check.apply_only")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onApply(result.refined_text, true);
                  onOpenChange(false);
                }}
                data-testid="prompt-apply-send"
              >
                {t("prompt_check.apply_send")}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PromptCheckDialog;
