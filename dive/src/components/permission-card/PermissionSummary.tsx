import { Badge } from "../ui/badge";
import { useT } from "../../i18n";
import type { ToolExplanation } from "./explain";
import type { RiskLevel } from "./types";

interface Props {
  toolName: string;
  risk: RiskLevel;
  explanation: ToolExplanation;
}

const BADGE_VARIANT: Record<RiskLevel, "info" | "warn" | "danger"> = {
  safe: "info",
  warn: "warn",
  danger: "danger",
};

export function PermissionSummary({ toolName, risk, explanation }: Props) {
  const t = useT();

  return (
    <div className="space-y-3 text-xs" data-testid="permission-summary">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">{explanation.actionTitle}</h3>
          <Badge variant={BADGE_VARIANT[risk]}>{explanation.riskLabel}</Badge>
          <span className="font-mono text-[11px] text-fg-muted">{toolName}</span>
        </div>
        <p className="mt-1 text-fg-muted">{explanation.actionBody}</p>
        <p className="mt-1 text-fg-muted">{explanation.riskBody}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border bg-bg/60 p-2" data-testid="permission-involved-files">
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
        <div className="rounded-md border bg-bg/60 p-2" data-testid="permission-choices">
          <p className="font-medium text-fg">{t("permission_card.summary.choices_title")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-fg-muted">
            {explanation.choices.map((choice) => (
              <li key={choice}>{choice}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
