import { useCallback, useMemo } from "react";
import { useT } from "../../i18n";
import type { DiffPreviewData, PermissionApprovalWarnings } from "./types";
import { computeLineDiff } from "./diff";

interface Props {
  diff: DiffPreviewData;
  className?: string;
  /** When set, render a link in the truncated footer that opens the full diff
   * in the slide-in panel (task 2-5). */
  onExpand?: () => void;
  onViewed?: () => void;
  approvalWarnings?: PermissionApprovalWarnings | null;
}

function secretReasonLabel(reason: string, t: (key: string) => string): string {
  switch (reason) {
    case "env_file":
      return t("permission_card.diff.secret_reason_env_file");
    case "named_secret":
      return t("permission_card.diff.secret_reason_named_secret");
    case "high_entropy_literal":
      return t("permission_card.diff.secret_reason_high_entropy_literal");
    default:
      return reason;
  }
}

export function DiffViewer({ diff, className, onExpand, onViewed, approvalWarnings }: Props) {
  const t = useT();
  const result = useMemo(() => computeLineDiff(diff.before, diff.after), [diff.before, diff.after]);
  const markViewed = useCallback(() => {
    onViewed?.();
  }, [onViewed]);

  return (
    <div
      className={`overflow-hidden rounded-md border bg-bg ${className ?? ""}`}
      data-testid="diff-viewer"
    >
      <header className="flex items-center justify-between border-b bg-bg-panel2 px-3 py-1.5 text-xs">
        <span className="font-mono text-fg-muted" data-testid="diff-path">
          {diff.path}
        </span>
        <span className="font-mono">
          <span className="text-success" data-testid="diff-add-count">
            +{result.addCount}
          </span>
          {"  "}
          <span className="text-danger" data-testid="diff-del-count">
            −{result.delCount}
          </span>
        </span>
      </header>
      {approvalWarnings?.secretFlagged ? (
        <div
          className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          data-testid="diff-secret-callout"
        >
          <p className="font-semibold">{t("permission_card.diff.secret_title")}</p>
          <p className="mt-0.5">{t("permission_card.diff.secret_body")}</p>
          {approvalWarnings.secretReasons.length > 0 ? (
            <p className="mt-1 font-mono text-[11px]">
              {approvalWarnings.secretReasons
                .map((reason) => secretReasonLabel(reason, t))
                .join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {approvalWarnings?.wholeFileOverwrite ? (
        <div
          className="border-b border-warn/30 bg-warn/10 px-3 py-2 text-xs text-fg"
          data-testid="diff-overwrite-callout"
        >
          <p className="font-semibold text-warn">{t("permission_card.diff.overwrite_title")}</p>
          <p className="mt-0.5">
            {t("permission_card.diff.overwrite_body", {
              count: approvalWarnings.wholeFileOverwrite.linesRemoved,
            })}
          </p>
        </div>
      ) : null}
      <pre className="max-h-72 overflow-auto font-mono text-xs leading-5" onScroll={markViewed}>
        {result.lines.map((line, idx) => {
          const bg = line.op === "add" ? "bg-success/10" : line.op === "del" ? "bg-danger/10" : "";
          const prefix = line.op === "add" ? "+ " : line.op === "del" ? "− " : "  ";
          const color =
            line.op === "add"
              ? "text-success"
              : line.op === "del"
                ? "text-danger"
                : "text-fg-muted";
          return (
            <div key={idx} className={`flex ${bg}`} data-testid="diff-line" data-op={line.op}>
              <span className="w-10 shrink-0 select-none border-r px-2 text-right text-fg-subtle">
                {line.leftNum ?? ""}
              </span>
              <span className="w-10 shrink-0 select-none border-r px-2 text-right text-fg-subtle">
                {line.rightNum ?? ""}
              </span>
              <span className={`whitespace-pre px-2 ${color}`}>
                {prefix}
                {line.text}
              </span>
            </div>
          );
        })}
      </pre>
      {result.truncated ? (
        <footer className="flex items-center justify-between border-t bg-bg-panel2 px-3 py-1.5 text-xs">
          <span className="text-warn">{t("permission_card.diff.truncated")}</span>
          {onExpand ? (
            <button
              type="button"
              onClick={() => {
                markViewed();
                onExpand?.();
              }}
              data-testid="diff-expand"
              className="text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("permission_card.diff.expand")}
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
