import { memo } from "react";
import { Ban, Wrench } from "lucide-react";
import type { ToolCallMessageData } from "./types";
import { Badge } from "../ui/badge";
import { PermissionCard, RawDetails } from "../permission-card";
import type { PermissionCardData } from "../permission-card";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import { useT } from "../../i18n";

const STATUS_VARIANT: Record<ToolCallMessageData["status"], "warn" | "success" | "danger"> = {
  pending: "warn",
  approved: "success",
  denied: "danger",
  blocked: "danger",
};

interface Props {
  message: ToolCallMessageData;
  onApprove?: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDeny?: (toolCallId: string, reason?: string) => void;
}

function ToolCallMessageImpl({ message, onApprove, onDeny }: Props) {
  const t = useT();
  const showCard =
    message.status === "pending" &&
    message.risk !== undefined &&
    onApprove !== undefined &&
    onDeny !== undefined;

  if (showCard) {
    const card: PermissionCardData = {
      toolCallId: message.id,
      toolName: message.toolName,
      paramsPreview: message.paramsPreview,
      risk: message.risk!,
      diffPreview: message.diffPreview ?? null,
      args: message.args,
    };
    return (
      <article
        className="flex w-full items-start justify-center"
        data-testid="chat-message"
        data-kind="tool_call"
        data-message-id={message.id}
        data-status={message.status}
      >
        <div className="w-full max-w-[80%]">
          <PermissionCard card={card} onApprove={onApprove} onDeny={onDeny} />
        </div>
      </article>
    );
  }

  if (message.status === "blocked") {
    return (
      <article
        className="flex items-start justify-center"
        data-testid="chat-message"
        data-kind="tool_call"
        data-message-id={message.id}
        data-status="blocked"
      >
        <div
          className="w-full max-w-[80%] overflow-hidden rounded-md border-2 border-danger/70 bg-danger/10"
          data-testid="tool-call-blocked"
        >
          <header className="flex items-center gap-2 border-b border-danger/40 bg-danger/20 px-3 py-2">
            <Ban className="h-4 w-4 text-danger" aria-hidden />
            <span className="text-sm font-semibold text-danger">
              {t("tool_call.blocked_title")}
            </span>
            <Badge variant="danger" className="ml-auto">
              {t("tool_call.status.blocked")}
            </Badge>
          </header>
          <div className="space-y-1 px-3 py-2 text-xs">
            <p className="flex items-center gap-1 text-fg">
              <span className="font-semibold">{t("tool_call.tool_label")}</span>
              <span className="font-mono">{message.toolName}</span>
              <McpProvenanceBadge name={message.toolName} />
            </p>
            <p className="truncate font-mono text-fg-muted">{message.paramsPreview}</p>
            {message.blockedReason ? (
              <>
                <p className="mt-1 text-danger">
                  <span className="font-semibold">{t("tool_call.blocked_rule")}</span>{" "}
                  {message.blockedReason.rule}
                </p>
                <p className="font-mono text-fg-muted">
                  <span className="font-semibold">{t("tool_call.blocked_pattern")}</span>{" "}
                  {message.blockedReason.pattern}
                </p>
              </>
            ) : null}
            <p className="mt-1 text-fg-muted">{t("tool_call.blocked_explain")}</p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className="flex items-start justify-center"
      data-testid="chat-message"
      data-kind="tool_call"
      data-message-id={message.id}
      data-status={message.status}
    >
      <div className="w-full max-w-[80%] rounded-lg border bg-bg-panel2 px-4 py-2">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <Wrench className="h-4 w-4 text-accent" aria-hidden />
            <span>{message.toolName}</span>
            <McpProvenanceBadge name={message.toolName} />
          </div>
          <Badge variant={STATUS_VARIANT[message.status]}>
            {t(`tool_call.status.${message.status}`)}
          </Badge>
        </header>
        <p className="mt-1 truncate font-mono text-xs text-fg-muted">{message.paramsPreview}</p>
        {message.deniedReason ? (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            <p className="font-semibold">{t("tool_call.denied_title")}</p>
            <p>{message.deniedReason}</p>
            {message.deniedReason.includes("plan-first") ? (
              <p className="mt-1 text-fg-muted">{t("tool_call.denied_plan_first")}</p>
            ) : null}
          </div>
        ) : null}
        {message.args !== undefined ? (
          <div className="mt-2">
            <RawDetails
              label={t("tool_call.show_details")}
              value={{ preview: message.paramsPreview, args: message.args }}
              testId="tool-call-details"
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const ToolCallMessage = memo(ToolCallMessageImpl);
