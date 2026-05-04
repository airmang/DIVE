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
import type { DiveStage } from "../../lib/ambiguity";

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

interface Props {
  open: boolean;
  initialText: string;
  stage?: DiveStage | null;
  onOpenChange: (open: boolean) => void;
  onApply: (refinedText: string, alsoSend: boolean) => void;
  mockResult?: PromptCheckResult;
}

export function PromptCheckDialog({
  open,
  initialText,
  stage,
  onOpenChange,
  onApply,
  mockResult,
}: Props) {
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
          stage: stage ?? null,
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
      setError(String(err));
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
          <DialogTitle>보내기 전 점검</DialogTitle>
          <DialogDescription>
            AI가 프롬프트 자체를 비평합니다. 모델 호출 1회가 소비됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border bg-bg-panel p-3" data-testid="prompt-original">
            <div className="text-[11px] text-fg-muted">원본</div>
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
              AI 비평 실행
            </Button>
          ) : null}

          {loading ? (
            <div
              className="rounded-md border bg-bg-panel px-3 py-3 text-center text-xs text-fg-muted"
              data-testid="prompt-check-loading"
            >
              모델 호출 중…
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-md border border-danger bg-danger/10 p-3 text-xs"
              data-testid="prompt-check-error"
            >
              <div className="font-medium text-danger">오류</div>
              <code>{error}</code>
            </div>
          ) : null}

          {result ? (
            <>
              <div className="rounded-md border bg-bg-panel p-3" data-testid="prompt-issues">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-fg-muted">발견된 모호함</div>
                  <Badge
                    variant={result.issues.length === 0 ? "success" : "warn"}
                    data-testid="prompt-issues-count"
                  >
                    {result.issues.length}건
                  </Badge>
                </div>
                {result.issues.length === 0 ? (
                  <div className="mt-2 text-[11px] text-fg-muted" data-testid="prompt-issues-empty">
                    모호한 부분이 감지되지 않았습니다.
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
                <div className="text-[11px] text-accent">정제된 제안</div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-fg">
                  {result.refined_text || "(정제 제안 없음)"}
                </pre>
              </div>

              <div className="text-right text-[10px] text-fg-muted" data-testid="prompt-usage">
                이 검토: 토큰 약 {result.approximate_tokens}개
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
            닫기
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
                제안 적용만
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onApply(result.refined_text, true);
                  onOpenChange(false);
                }}
                data-testid="prompt-apply-send"
              >
                제안 적용 + 전송
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PromptCheckDialog;
