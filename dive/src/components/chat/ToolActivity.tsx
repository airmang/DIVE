import { memo, useMemo } from "react";
import {
  Ban,
  Check,
  ChevronDown,
  Eye,
  FileText,
  Loader2,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ReasoningMessageData,
  ToolApprovalMetadata,
  ToolCallMessageData,
  ToolResultMessageData,
} from "./types";
import { Badge } from "../ui/badge";
import { PermissionCard } from "../permission-card";
import type { PermissionActionContext, PermissionCardData } from "../permission-card";
import { formatRaw } from "../permission-card/explain";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import { useT } from "../../i18n";
import type {
  ProvocationChangedFile,
  ProvocationPlanStep,
  ScaffoldMode,
} from "../../features/provocation";

/**
 * ToolActivity — a single tool action rendered as one unit.
 *
 * One tool action arrives as up to three ChatMessages (reasoning + tool_call +
 * tool_result) grouped by call_id in MessageList. This component renders them
 * together:
 *   - pending (with risk + handlers) → elevated PermissionCard (supervision gate)
 *   - blocked                        → elevated blocked card
 *   - otherwise (approved/denied)    → compact one-line row + light "why" + expandable details
 *
 * data-testid attributes are preserved so existing chat tests keep passing.
 */

interface Props {
  call: ToolCallMessageData;
  reasoning?: ReasoningMessageData;
  result?: ToolResultMessageData;
  onApprove?: (
    toolCallId: string,
    modifiedArgs?: unknown,
    approvalMetadata?: ToolApprovalMetadata,
  ) => void;
  onDeny?: (toolCallId: string, reason?: string) => void;
  provocation?: {
    enabled: boolean;
    mode: ScaffoldMode;
    projectId?: number | null;
    sessionId?: number | null;
    goalText?: string | null;
    changedFiles?: ProvocationChangedFile[];
    targetFiles?: string[];
    planSteps?: ProvocationPlanStep[];
    checkpointAvailable?: boolean | null;
    onOpenRecovery?: () => void;
  };
}

function pathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const path = (args as Record<string, unknown>).path;
  return typeof path === "string" && path.trim().length > 0 ? path : null;
}

function filesFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const paths = new Set<string>();
  const path = record.path;
  if (typeof path === "string" && path.trim()) paths.add(path.trim());
  for (const key of ["paths", "files", "readFiles", "writeFiles"]) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) paths.add(item.trim());
    }
  }
  return [...paths];
}

function actionContextForCall(
  call: ToolCallMessageData,
  expectedFiles: string[],
  checkpointAvailable: boolean | null | undefined,
): PermissionActionContext {
  const argFiles = filesFromArgs(call.args);
  const diffPath = call.diffPreview?.path ?? pathFromArgs(call.args);
  const diffFiles = diffPath ? [diffPath] : [];
  const mutatesFiles =
    call.toolName === "write_file" ||
    call.toolName === "edit_file" ||
    call.toolName === "delete_file" ||
    call.toolName === "mkdir";
  const readsFiles =
    call.toolName === "read_file" ||
    call.toolName === "list_dir" ||
    call.toolName === "search_files";
  return {
    expectedFiles,
    readFiles: readsFiles ? argFiles : [],
    writeFiles: mutatesFiles ? [...new Set([...argFiles, ...diffFiles])] : [],
    diffPreviewPath: call.diffPreview?.path ?? null,
    checkpointAvailable: checkpointAvailable ?? null,
  };
}

function toolIcon(toolName: string): LucideIcon {
  switch (toolName) {
    case "read_file":
    case "list_dir":
      return toolName === "read_file" ? FileText : Eye;
    case "write_file":
    case "edit_file":
      return FileText;
    case "delete_file":
      return Trash2;
    case "bash":
    case "run_process":
      return SquareTerminal;
    default:
      return Wrench;
  }
}

function runtimeActionLabelKey(action: ToolCallMessageData["runtimeAction"]): string | null {
  switch (action) {
    case "preview":
      return "runtime.actions.preview";
    case "project_command":
      return "runtime.actions.project_command";
    case "terminal_script":
      return "runtime.actions.terminal_script";
    default:
      return null;
  }
}

function ToolActivityImpl({ call, reasoning, result, onApprove, onDeny, provocation }: Props) {
  const t = useT();

  const showCard =
    call.status === "pending" &&
    call.risk !== undefined &&
    onApprove !== undefined &&
    onDeny !== undefined;
  const targetFiles = useMemo(
    () => [...new Set((provocation?.targetFiles ?? []).filter((path) => path.trim().length > 0))],
    [provocation?.targetFiles],
  );
  const permissionActionContext = useMemo(
    () => actionContextForCall(call, targetFiles, provocation?.checkpointAvailable),
    [call, provocation?.checkpointAvailable, targetFiles],
  );

  const handleApprove = (toolCallId: string, modifiedArgs?: unknown) => {
    onApprove?.(toolCallId, modifiedArgs);
  };

  // pending + risk → elevated approval gate (supervision moment)
  if (showCard) {
    const card: PermissionCardData = {
      toolCallId: call.id,
      toolName: call.toolName,
      paramsPreview: call.paramsPreview,
      risk: call.risk!,
      diffPreview: call.diffPreview ?? null,
      args: call.args,
      actionContext: permissionActionContext,
    };
    return (
      <article
        className="flex w-full items-start justify-center"
        data-testid="chat-message"
        data-kind="tool_call"
        data-message-id={call.id}
        data-status={call.status}
      >
        <div className="w-full max-w-full sm:max-w-[80%]">
          {reasoning ? (
            <p className="mb-1.5 px-1 text-xs text-fg-subtle">
              <span className="font-semibold">↳ {t("tool_call.why_label")}</span> {reasoning.text}
            </p>
          ) : null}
          <PermissionCard card={card} onApprove={handleApprove} onDeny={onDeny} />
        </div>
      </article>
    );
  }

  // blocked → elevated danger card
  if (call.status === "blocked") {
    return (
      <article
        className="flex items-start justify-center"
        data-testid="chat-message"
        data-kind="tool_call"
        data-message-id={call.id}
        data-status="blocked"
      >
        <div
          className="w-full max-w-full overflow-hidden rounded border border-danger/70 bg-danger/10 sm:max-w-[80%]"
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
              <span className="font-mono">{call.toolName}</span>
              <McpProvenanceBadge name={call.toolName} />
            </p>
            <p className="truncate font-mono text-fg-muted">{call.paramsPreview}</p>
            {call.blockedReason ? (
              <>
                <p className="mt-1 text-danger">
                  <span className="font-semibold">{t("tool_call.blocked_rule")}</span>{" "}
                  {call.blockedReason.rule}
                </p>
                <p className="font-mono text-fg-muted">
                  <span className="font-semibold">{t("tool_call.blocked_pattern")}</span>{" "}
                  {call.blockedReason.pattern}
                </p>
              </>
            ) : null}
            <p className="mt-1 text-fg-muted">{t("tool_call.blocked_explain")}</p>
          </div>
        </div>
      </article>
    );
  }

  // compact one-line row (approved / denied, with or without a result)
  const ToolIcon = toolIcon(call.toolName);
  const running = call.status === "approved" && result === undefined;
  const denied = call.status === "denied";
  const rerouted = call.status === "rerouted";
  const stale = call.status === "stale";

  let StatusIcon: LucideIcon = Loader2;
  let statusTone = "text-accent";
  if (denied || stale) {
    StatusIcon = Ban;
    statusTone = "text-fg-subtle";
  } else if (rerouted) {
    StatusIcon = Eye;
    statusTone = "text-accent";
  } else if (result) {
    StatusIcon = result.success ? Check : X;
    statusTone = result.success ? "text-success" : "text-danger";
  }

  const metaText = stale
    ? t("tool_call.status.stale")
    : rerouted
      ? t("tool_call.status.rerouted")
      : denied
        ? t("tool_call.status.denied")
        : result
          ? result.summary
          : running
            ? "…"
            : t("tool_call.status.approved");
  const runtimeAction = result?.runtimeAction ?? call.runtimeAction;
  const runtimeLabelKey = runtimeActionLabelKey(runtimeAction);

  return (
    <article
      className="flex w-full items-start justify-center"
      data-testid="chat-message"
      data-kind="tool_call"
      data-message-id={call.id}
      data-status={call.status}
    >
      <div className="w-full max-w-full sm:max-w-[80%]">
        <div
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-bg-panel2"
          data-kind="tool_result"
          data-success={result ? (result.success ? "true" : "false") : undefined}
        >
          <StatusIcon
            className={`h-4 w-4 flex-none ${statusTone} ${running ? "animate-spin" : ""}`}
            aria-hidden
          />
          <ToolIcon className="h-3.5 w-3.5 flex-none text-fg-muted" aria-hidden />
          <span className="font-mono font-semibold text-fg">{call.toolName}</span>
          <McpProvenanceBadge name={call.toolName} />
          {runtimeLabelKey ? (
            <Badge variant="info" className="hidden sm:inline-flex">
              {t(runtimeLabelKey)}
            </Badge>
          ) : null}
          <span className="text-fg-subtle">·</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
            {call.paramsPreview}
          </span>
          <span
            className={`ml-auto whitespace-nowrap font-mono text-xs ${
              result && !result.success ? "text-danger" : "text-fg-muted"
            }`}
          >
            {metaText}
          </span>
          {call.args !== undefined || result?.full !== undefined ? (
            <ChevronDown className="h-3.5 w-3.5 flex-none text-fg-subtle" aria-hidden />
          ) : null}
        </div>

        {reasoning ? (
          <p className="px-2 pb-1 pl-8 text-[11px] text-fg-subtle">
            <span className="font-semibold">↳ {t("tool_call.why_label")}</span> {reasoning.text}
          </p>
        ) : null}

        {(denied || rerouted || stale) && call.deniedReason ? (
          <div className="ml-8 mt-1 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            <p className="font-semibold">
              {stale
                ? t("tool_call.stale_title")
                : rerouted
                  ? t("tool_call.rerouted_title")
                  : t("tool_call.denied_title")}
            </p>
            <p>{call.deniedReason}</p>
            {call.deniedReason.includes("plan-first") ? (
              <p className="mt-1 text-fg-muted">{t("tool_call.denied_plan_first")}</p>
            ) : null}
          </div>
        ) : null}

        {call.args !== undefined || result?.full !== undefined ? (
          <details className="ml-8 mt-1 rounded-sm border bg-bg-panel2/60 px-3 py-2 text-xs">
            <summary className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg">
              {t("tool_call.show_details")}
            </summary>
            {call.args !== undefined ? (
              <div className="mt-2" data-testid="tool-call-details">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-fg-muted">
                  {formatRaw({ preview: call.paramsPreview, args: call.args })}
                </pre>
              </div>
            ) : null}
            {result?.full !== undefined ? (
              <div className="mt-2" data-testid="tool-result-details">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-fg-muted">
                  {formatRaw(result.full)}
                </pre>
              </div>
            ) : null}
          </details>
        ) : null}
      </div>
    </article>
  );
}

export const ToolActivity = memo(ToolActivityImpl);
