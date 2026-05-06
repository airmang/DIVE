import { TerminalSquare } from "lucide-react";
import type { ToolExplanation } from "./explain";

interface Props {
  explanation: ToolExplanation;
}

export function CommandExplainer({ explanation }: Props) {
  if (!explanation.command) return null;

  const changeCopy =
    explanation.commandWillChangeFiles === "maybe"
      ? "This command might change files if the program writes to the project. DIVE will show results afterward, but it cannot promise the command is read-only."
      : explanation.commandWillChangeFiles === "yes"
        ? "This action is expected to change project files."
        : "This command is not expected to change files.";

  return (
    <section
      className="rounded-md border border-danger/30 bg-danger/5 p-3 text-xs"
      data-testid="command-explainer"
    >
      <div className="flex items-center gap-2 font-semibold text-fg">
        <TerminalSquare className="h-4 w-4 text-danger" aria-hidden />
        Command to run
      </div>
      <pre
        className="mt-2 overflow-auto rounded-md border bg-bg p-2 font-mono text-[11px] leading-5 text-fg"
        data-testid="command-explainer-command"
      >
        {explanation.command}
      </pre>
      <ul className="mt-2 space-y-1 text-fg-muted">
        <li>{changeCopy}</li>
        <li>
          If it fails, no approval is reused automatically. DIVE gets the error and can explain it.
        </li>
        <li>You can deny now and ask DIVE why this command is needed.</li>
      </ul>
    </section>
  );
}
