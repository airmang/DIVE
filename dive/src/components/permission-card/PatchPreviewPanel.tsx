import { FileDiff } from "lucide-react";
import { useT } from "../../i18n";
import { DiffViewer } from "./DiffViewer";
import type { DiffPreviewData } from "./types";

interface Props {
  diff: DiffPreviewData | null;
  expected: boolean;
}

export function PatchPreviewPanel({ diff, expected }: Props) {
  const t = useT();

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
      {diff ? <DiffViewer diff={diff} /> : null}
    </section>
  );
}
