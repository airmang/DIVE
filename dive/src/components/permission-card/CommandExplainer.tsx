import { TerminalSquare } from "lucide-react";
import { useT } from "../../i18n";
import type { ToolExplanation } from "./explain";

interface Props {
  explanation: ToolExplanation;
}

export function CommandExplainer({ explanation }: Props) {
  const t = useT();

  if (!explanation.command) return null;

  const changeCopy =
    explanation.commandWillChangeFiles === "maybe"
      ? t("permission_card.command.change_maybe")
      : explanation.commandWillChangeFiles === "yes"
        ? t("permission_card.command.change_yes")
        : t("permission_card.command.change_no");

  return (
    <section
      className="rounded-md border border-danger/30 bg-danger/5 p-3 text-xs"
      data-testid="command-explainer"
    >
      <div className="flex items-center gap-2 font-semibold text-fg">
        <TerminalSquare className="h-4 w-4 text-danger" aria-hidden />
        {t("permission_card.command.title")}
      </div>
      <pre
        className="mt-2 overflow-auto rounded-md border bg-bg p-2 font-mono text-[11px] leading-5 text-fg"
        data-testid="command-explainer-command"
      >
        {explanation.command}
      </pre>
      <ul className="mt-2 space-y-1 text-fg-muted">
        <li>{changeCopy}</li>
        <li>{t("permission_card.command.failure_note")}</li>
        <li>{t("permission_card.command.deny_note")}</li>
      </ul>
    </section>
  );
}
