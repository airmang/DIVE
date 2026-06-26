import { useState } from "react";
import { FileDiff } from "lucide-react";
import { useT } from "../../i18n";
import { DiffViewer } from "./DiffViewer";
import type { DiffPreviewData, PermissionApprovalWarnings, PermissionChangeSummary } from "./types";

interface Props {
  diff: DiffPreviewData | null;
  expected: boolean;
  summary?: PermissionChangeSummary | null;
  approvalWarnings?: PermissionApprovalWarnings | null;
  onViewed?: () => void;
}

export function PatchPreviewPanel({ diff, expected, summary, approvalWarnings, onViewed }: Props) {
  const t = useT();
  const [explanationOpen, setExplanationOpen] = useState(false);

  if (!diff && !expected) return null;

  return (
    <section className="rounded-md border bg-bg-panel2/40 p-3" data-testid="patch-preview-panel">
      <div className="mb-2 flex items-start gap-2 text-xs">
        <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div>
          <p className="font-semibold text-fg">{t("permission_card.patch.title")}</p>
          <p className="text-fg-muted">
            {diff ? t("permission_card.patch.with_diff") : t("permission_card.patch.missing_diff")}
          </p>
        </div>
      </div>
      {diff ? (
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
      ) : null}
    </section>
  );
}
