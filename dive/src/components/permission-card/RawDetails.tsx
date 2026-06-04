import { useT } from "../../i18n";
import { formatRaw } from "./explain";

interface Props {
  label?: string;
  value: unknown;
  testId?: string;
}

export function RawDetails({ label, value, testId = "raw-details" }: Props) {
  const t = useT();
  const summaryLabel = label ?? t("permission_card.actions.show_details");

  return (
    <details className="rounded-md border bg-bg-panel2/60 px-3 py-2 text-xs" data-testid={testId}>
      <summary className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg">
        {summaryLabel}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-fg-muted">
        {formatRaw(value)}
      </pre>
    </details>
  );
}
