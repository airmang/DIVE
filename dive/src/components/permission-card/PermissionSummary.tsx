import { Badge } from "../ui/badge";
import { useT } from "../../i18n";
import type { ToolExplanation } from "./explain";
import type { PermissionActionContext, PermissionChangeSummary, RiskLevel } from "./types";

interface Props {
  toolName: string;
  risk: RiskLevel;
  explanation: ToolExplanation;
  actionContext?: PermissionActionContext;
  changeSummary?: PermissionChangeSummary | null;
}

const BADGE_VARIANT: Record<RiskLevel, "info" | "warn" | "danger"> = {
  safe: "info",
  warn: "warn",
  danger: "danger",
};

function uniqueItems(items: string[] | undefined): string[] {
  return [...new Set((items ?? []).map((item) => item.trim()).filter(Boolean))];
}

function compactList(items: string[], empty: string): string {
  if (items.length === 0) return empty;
  if (items.length <= 3) return items.join(", ");
  return `${items.slice(0, 3).join(", ")} +${items.length - 3}`;
}

// Files the AI wants to write that are NOT in the approved plan's expected
// targets — the "AI went off-script" signal. Only meaningful when a plan
// expectation exists; an empty expectation set means we can't judge divergence.
function divergentFiles(writeFiles: string[], expectedFiles: string[]): string[] {
  if (expectedFiles.length === 0) return [];
  const expected = new Set(expectedFiles);
  return writeFiles.filter((path) => !expected.has(path));
}

export function PermissionSummary({
  toolName,
  risk,
  explanation,
  actionContext,
  changeSummary,
}: Props) {
  const t = useT();
  const expectedFiles = uniqueItems(actionContext?.expectedFiles);
  const readFiles = uniqueItems(actionContext?.readFiles);
  const writeFiles = uniqueItems(actionContext?.writeFiles);
  const diffPreviewPath = actionContext?.diffPreviewPath?.trim() || null;
  const unexpectedWriteFiles = divergentFiles(writeFiles, expectedFiles);
  const checkpointLabel =
    actionContext?.checkpointAvailable === true
      ? t("permission_card.summary.checkpoint_available")
      : actionContext?.checkpointAvailable === false
        ? t("permission_card.summary.checkpoint_unavailable")
        : t("permission_card.summary.checkpoint_unknown");
  const hasActionContext =
    expectedFiles.length > 0 ||
    readFiles.length > 0 ||
    writeFiles.length > 0 ||
    diffPreviewPath !== null ||
    actionContext?.checkpointAvailable !== undefined;
  const hasSecondaryDetails = hasActionContext || explanation.files.length > 0;

  return (
    <div
      className="space-y-3 text-xs"
      data-testid="permission-summary"
      data-default-metadata={hasSecondaryDetails ? "collapsed" : "none"}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">{explanation.actionTitle}</h3>
          <Badge variant={BADGE_VARIANT[risk]}>{explanation.riskLabel}</Badge>
          <span className="font-mono text-[11px] text-fg-muted">{toolName}</span>
        </div>
        <p className="mt-1 text-fg-muted">{explanation.actionBody}</p>
        <p className="mt-1 text-fg-muted">{explanation.riskBody}</p>
      </div>

      {changeSummary ? (
        <section
          className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2"
          data-testid="permission-change-summary"
        >
          <p className="font-semibold text-fg">{t("permission_card.change_summary.title")}</p>
          <p className="mt-1 text-fg">{changeSummary.headline}</p>
          {changeSummary.details.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-fg-muted">
              {changeSummary.details.map((detail, index) => (
                <li key={index}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {unexpectedWriteFiles.length > 0 ? (
        <section
          className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2"
          data-testid="permission-divergence-warning"
        >
          <p className="text-sm font-semibold text-danger">
            {t("permission_card.summary.divergence_title")}
          </p>
          <p className="mt-1 break-words text-fg-muted">
            {t("permission_card.summary.divergence_body", {
              paths: compactList(unexpectedWriteFiles, ""),
            })}
          </p>
        </section>
      ) : null}

      {hasSecondaryDetails ? (
        <details
          className="rounded-md border bg-bg/60 px-2 py-1.5"
          data-testid="permission-secondary-details"
        >
          <summary
            className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            aria-label={t("permission_card.summary.details_aria")}
          >
            {t("permission_card.summary.details_toggle")}
          </summary>
          <div className="mt-2 space-y-2">
            {hasActionContext ? (
              <div data-testid="permission-action-context">
                <p className="font-medium text-fg">
                  {t("permission_card.summary.action_context_title")}
                </p>
                <dl className="mt-1 grid gap-1.5 text-[11px] text-fg-muted sm:grid-cols-2">
                  <div data-testid="permission-expected-files">
                    <dt className="font-semibold text-fg">
                      {t("permission_card.summary.expected_files")}
                    </dt>
                    <dd className="mt-0.5 break-words font-mono">
                      {compactList(expectedFiles, t("permission_card.summary.none"))}
                    </dd>
                  </div>
                  <div data-testid="permission-write-files">
                    <dt className="font-semibold text-fg">
                      {t("permission_card.summary.write_files")}
                    </dt>
                    <dd className="mt-0.5 break-words font-mono">
                      {compactList(writeFiles, t("permission_card.summary.none"))}
                    </dd>
                  </div>
                  <div data-testid="permission-read-files">
                    <dt className="font-semibold text-fg">
                      {t("permission_card.summary.read_files")}
                    </dt>
                    <dd className="mt-0.5 break-words font-mono">
                      {compactList(readFiles, t("permission_card.summary.none"))}
                    </dd>
                  </div>
                  <div data-testid="permission-diff-path">
                    <dt className="font-semibold text-fg">
                      {t("permission_card.summary.diff_preview")}
                    </dt>
                    <dd className="mt-0.5 break-words font-mono">
                      {diffPreviewPath ?? t("permission_card.summary.none")}
                    </dd>
                  </div>
                  <div className="sm:col-span-2" data-testid="permission-checkpoint-availability">
                    <dt className="font-semibold text-fg">
                      {t("permission_card.summary.checkpoint")}
                    </dt>
                    <dd className="mt-0.5">{checkpointLabel}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div data-testid="permission-involved-files">
              <p className="font-medium text-fg">{t("permission_card.summary.files_title")}</p>
              {explanation.files.length > 0 ? (
                <ul className="mt-1 space-y-1 font-mono text-[11px] text-fg-muted">
                  {explanation.files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-fg-muted">{t("permission_card.summary.files_empty")}</p>
              )}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
