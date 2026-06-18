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
      {explanation.projectCommand ? (
        <dl
          className="mt-2 grid gap-1.5 rounded-sm border border-border bg-bg/70 p-2 text-[11px] text-fg-muted sm:grid-cols-2"
          data-testid="project-command-details"
        >
          <div data-testid="project-command-executable">
            <dt className="font-semibold text-fg">{t("permission_card.command.executable")}</dt>
            <dd className="mt-0.5 break-words font-mono">
              {explanation.projectCommand.executable}
            </dd>
          </div>
          <div data-testid="project-command-args">
            <dt className="font-semibold text-fg">{t("permission_card.command.args")}</dt>
            <dd className="mt-0.5 break-words font-mono">
              {explanation.projectCommand.args.length > 0
                ? explanation.projectCommand.args.join(" ")
                : t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div data-testid="project-command-timeout">
            <dt className="font-semibold text-fg">{t("permission_card.command.timeout")}</dt>
            <dd className="mt-0.5">
              {explanation.projectCommand.timeoutSec !== null
                ? t("permission_card.command.seconds", {
                    count: explanation.projectCommand.timeoutSec,
                  })
                : t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div data-testid="project-command-reason">
            <dt className="font-semibold text-fg">{t("permission_card.command.reason")}</dt>
            <dd className="mt-0.5">
              {explanation.projectCommand.reason ?? t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div className="sm:col-span-2" data-testid="project-command-expected-effect">
            <dt className="font-semibold text-fg">
              {t("permission_card.command.expected_effect")}
            </dt>
            <dd className="mt-0.5">
              {explanation.projectCommand.expectedEffect ??
                t("permission_card.command.not_provided")}
            </dd>
          </div>
        </dl>
      ) : null}
      {explanation.terminalScript ? (
        <dl
          className="mt-2 grid gap-1.5 rounded-sm border border-danger/30 bg-bg/70 p-2 text-[11px] text-fg-muted sm:grid-cols-2"
          data-testid="terminal-script-details"
        >
          <div data-testid="terminal-script-shell-family">
            <dt className="font-semibold text-fg">{t("permission_card.command.shell_family")}</dt>
            <dd className="mt-0.5 break-words font-mono">
              {explanation.terminalScript.shellFamily}
            </dd>
          </div>
          <div data-testid="terminal-script-timeout">
            <dt className="font-semibold text-fg">{t("permission_card.command.timeout")}</dt>
            <dd className="mt-0.5">
              {explanation.terminalScript.timeoutSec !== null
                ? t("permission_card.command.seconds", {
                    count: explanation.terminalScript.timeoutSec,
                  })
                : t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div data-testid="terminal-script-output-limit">
            <dt className="font-semibold text-fg">{t("permission_card.command.output_limit")}</dt>
            <dd className="mt-0.5">
              {explanation.terminalScript.outputLimit !== null
                ? t("permission_card.command.bytes", {
                    count: explanation.terminalScript.outputLimit,
                  })
                : t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div data-testid="terminal-script-risk-factors">
            <dt className="font-semibold text-fg">{t("permission_card.command.risk_factors")}</dt>
            <dd className="mt-0.5 break-words font-mono">
              {explanation.terminalScript.riskFactors.join(", ")}
            </dd>
          </div>
          <div data-testid="terminal-script-reason">
            <dt className="font-semibold text-fg">{t("permission_card.command.reason")}</dt>
            <dd className="mt-0.5">
              {explanation.terminalScript.reason ?? t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div data-testid="terminal-script-expected-effect">
            <dt className="font-semibold text-fg">
              {t("permission_card.command.expected_effect")}
            </dt>
            <dd className="mt-0.5">
              {explanation.terminalScript.expectedEffect ??
                t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div className="sm:col-span-2" data-testid="terminal-script-one-shot">
            <dt className="font-semibold text-fg">{t("permission_card.command.one_shot_title")}</dt>
            <dd className="mt-0.5">{t("permission_card.command.one_shot_body")}</dd>
          </div>
        </dl>
      ) : null}
      <ul className="mt-2 space-y-1 text-fg-muted">
        <li>{changeCopy}</li>
        <li>{t("permission_card.command.failure_note")}</li>
        <li>{t("permission_card.command.deny_note")}</li>
      </ul>
    </section>
  );
}
