import { useState } from "react";
import { FileDiff } from "lucide-react";
import { useT } from "../../i18n";
import { DiffViewer } from "./DiffViewer";
import { ApprovalWarningCallouts } from "./ApprovalWarningCallouts";
import type { DiffPreviewData, PermissionApprovalWarnings, PermissionChangeSummary } from "./types";

interface Props {
  diff: DiffPreviewData | null;
  diffPreviews?: DiffPreviewData[] | null;
  expected: boolean;
  summary?: PermissionChangeSummary | null;
  approvalWarnings?: PermissionApprovalWarnings | null;
  onViewed?: () => void;
}

export function PatchPreviewPanel({
  diff,
  diffPreviews,
  expected,
  summary,
  approvalWarnings,
  onViewed,
}: Props) {
  const t = useT();
  const [explanationOpen, setExplanationOpen] = useState(false);
  const multiDiffs = diffPreviews && diffPreviews.length > 0 ? diffPreviews : null;
  const hasDiff = diff !== null || multiDiffs !== null;
  // The secret / whole-file callout must surface even with no diff to scroll —
  // it's the only concrete danger signal on the highest-stakes approvals (P1-25).
  const hasWarningCallout =
    approvalWarnings?.secretFlagged === true || approvalWarnings?.wholeFileOverwrite != null;

  if (!hasDiff && !expected && !hasWarningCallout) return null;

  return (
    <section className="rounded-md border bg-bg-panel2/40 p-3" data-testid="patch-preview-panel">
      <div className="mb-2 flex items-start gap-2 text-xs">
        <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div>
          <p className="font-semibold text-fg">{t("permission_card.patch.title")}</p>
          <p className="text-fg-muted">
            {multiDiffs
              ? t("permission_card.patch.with_multi_diff", { count: multiDiffs.length })
              : diff
                ? t("permission_card.patch.with_diff")
                : t("permission_card.patch.missing_diff")}
          </p>
        </div>
      </div>
      {multiDiffs ? (
        <div className="space-y-2" data-testid="multi-diff-preview-list">
          {multiDiffs.map((item) => (
            <DiffViewer
              key={item.path}
              diff={item}
              approvalWarnings={approvalWarnings}
              onViewed={onViewed}
            />
          ))}
        </div>
      ) : diff ? (
        <>
          <DiffViewer diff={diff} approvalWarnings={approvalWarnings} onViewed={onViewed} />
          {summary ? (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                onClick={() => setExplanationOpen((value) => !value)}
                data-testid="patch-explain-toggle"
              >
                {t("permission_card.patch.explain")}
              </button>
              {explanationOpen ? (
                <div
                  className="mt-2 rounded-sm border bg-bg/70 px-2 py-2 text-xs"
                  data-testid="patch-explain-panel"
                >
                  <p className="font-semibold text-fg">
                    {t("permission_card.patch.explain_title")}
                  </p>
                  <p className="mt-1 text-fg-muted">{t("permission_card.patch.explain_body")}</p>
                  <p className="mt-1 text-fg">{summary.headline}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg-muted">
                    {summary.details.map((detail, index) => (
                      <li key={index}>{detail}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-fg-muted">
                    {t("permission_card.patch.explain_unavailable")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : hasWarningCallout ? (
        <div className="overflow-hidden rounded-md border" data-testid="patch-preview-callouts">
          <ApprovalWarningCallouts approvalWarnings={approvalWarnings} />
        </div>
      ) : null}
    </section>
  );
}
