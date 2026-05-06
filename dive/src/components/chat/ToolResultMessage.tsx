import { memo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ToolResultMessageData } from "./types";
import { RawDetails } from "../permission-card";

interface Props {
  message: ToolResultMessageData;
}

function ToolResultMessageImpl({ message }: Props) {
  const Icon = message.success ? CheckCircle2 : XCircle;
  const tone = message.success ? "text-success" : "text-danger";
  const border = message.success ? "border-success/40" : "border-danger/40";
  const isCommand = message.toolName === "bash" || message.toolName === "run_process";

  return (
    <article
      className="flex items-start justify-center"
      data-testid="chat-message"
      data-kind="tool_result"
      data-message-id={message.id}
      data-success={message.success ? "true" : "false"}
    >
      <div className={`w-full max-w-[80%] rounded-lg border bg-bg-panel2 px-4 py-2 ${border}`}>
        <header className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon className={`h-4 w-4 ${tone}`} aria-hidden />
          <span>{message.toolName}</span>
          <span className={`text-xs ${tone}`}>{message.success ? "Finished" : "Failed"}</span>
        </header>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-fg-muted">
          {message.summary}
        </p>
        {isCommand ? (
          <p className="mt-2 rounded-md border bg-bg px-3 py-2 text-xs text-fg-muted">
            {message.success
              ? "Command finished. If it changed files, DIVE will use the result in the next step."
              : "Command failed. That usually means the project rejected the command or printed an error; you can ask DIVE to explain before trying again."}
          </p>
        ) : null}
        {message.full !== undefined ? (
          <div className="mt-2">
            <RawDetails label="Show details" value={message.full} testId="tool-result-details" />
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const ToolResultMessage = memo(ToolResultMessageImpl);
