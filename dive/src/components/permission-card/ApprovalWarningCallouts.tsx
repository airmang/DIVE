import { useT } from "../../i18n";
import type { PermissionApprovalWarnings } from "./types";

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

/**
 * Backend-detected secret-write and whole-file-overwrite callouts. Rendered both
 * inside the diff (between header and body) and on the no-diff path so the
 * highest-stakes danger signal is never lost just because a diff preview is
 * unavailable (P1-25). Grounded in concrete `approvalWarnings` evidence, not a
 * generic banner — returns nothing when no warning is flagged.
 */
export function ApprovalWarningCallouts({
  approvalWarnings,
}: {
  approvalWarnings?: PermissionApprovalWarnings | null;
}) {
  const t = useT();
  if (!approvalWarnings?.secretFlagged && !approvalWarnings?.wholeFileOverwrite) {
    return null;
  }
  return (
    <>
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
    </>
  );
}
