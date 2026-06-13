import { memo, useMemo, useState } from "react";
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
import type { PermissionCardData } from "../permission-card";
import { formatRaw } from "../permission-card/explain";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import { useT } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import { useSlideInStore } from "../../stores/slideIn";
import type { ChangedFile } from "../slide-in/types";
import {
  ProvocationCardHost,
  generateProvocationCards,
  normalizeChangedFile,
  type ProvocationAction,
  type ProvocationCard as ProvocationCardData,
  type ProvocationChangedFile,
  type ProvocationPlanStep,
  type ScaffoldMode,
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
    onOpenRecovery?: () => void;
  };
}

interface RiskAcceptance {
  cardId: string;
  cardType: string;
  actionId: string;
  reason: string;
  highRiskFiles: string[];
}

function pathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const path = (args as Record<string, unknown>).path;
  return typeof path === "string" && path.trim().length > 0 ? path : null;
}

function changeTypeForCall(call: ToolCallMessageData): ProvocationChangedFile["changeType"] {
  if (call.toolName === "delete_file") return "deleted";
  if (call.toolName === "write_file" && call.diffPreview?.before === "") return "added";
  if (call.toolName === "write_file" || call.toolName === "edit_file") return "modified";
  return undefined;
}

function pendingChangedFile(call: ToolCallMessageData): ProvocationChangedFile | null {
  const path = call.diffPreview?.path ?? pathFromArgs(call.args);
  if (!path) return null;
  return normalizeChangedFile({
    path,
    changeType: changeTypeForCall(call),
  });
}

function mergeChangedFiles(
  call: ToolCallMessageData,
  known: ProvocationChangedFile[] | undefined,
): ProvocationChangedFile[] {
  const byPath = new Map<string, ProvocationChangedFile>();
  for (const file of known ?? []) {
    if (!file.path.trim()) continue;
    byPath.set(file.path, normalizeChangedFile(file));
  }
  const pending = pendingChangedFile(call);
  if (pending) {
    byPath.set(pending.path, { ...byPath.get(pending.path), ...pending });
  }
  return [...byPath.values()];
}

function compactPathList(paths: string[]): string {
  if (paths.length <= 3) return paths.join(", ");
  return `${paths.slice(0, 3).join(", ")} 외 ${paths.length - 3}개`;
}

function stringListMetadata(card: ProvocationCardData | null, key: string): string[] {
  const value = card?.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function changedFilesForDiffPanel(
  call: ToolCallMessageData,
  known: ProvocationChangedFile[],
  primaryPaths: string[],
): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  const orderedPaths = [...primaryPaths, ...known.map((file) => file.path)];
  for (const path of orderedPaths) {
    if (!path.trim() || byPath.has(path)) continue;
    byPath.set(path, { path, diff: null });
  }
  if (call.diffPreview) {
    byPath.set(call.diffPreview.path, {
      path: call.diffPreview.path,
      diff: call.diffPreview,
    });
  }
  return [...byPath.values()];
}

function rationalePrompt(goalText: string | null | undefined, files: string[]): string {
  const fileText = files.length > 0 ? compactPathList(files) : "현재 diff의 고위험 파일";
  const goal = goalText?.trim() || "현재 작업 목표";
  return [
    "다음 고위험 변경 파일들이 현재 목표에 왜 필요한지 파일별 근거를 설명해줘.",
    "필요 없는 변경이면 되돌릴 파일과 이유를 짧게 제안해줘.",
    `목표: ${goal}`,
    `파일: ${fileText}`,
  ].join("\n");
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

function ToolActivityImpl({ call, reasoning, result, onApprove, onDeny, provocation }: Props) {
  const t = useT();
  const openSlideIn = useSlideInStore((s) => s.open);
  const setSelectedFile = useSlideInStore((s) => s.setSelectedFile);
  const pushComposerSeed = useChatComposerStore((s) => s.pushSeed);
  const [riskAcceptance, setRiskAcceptance] = useState<RiskAcceptance | null>(null);
  const [actionStatus, setActionStatus] = useState<{
    kind: string;
    message: string;
  } | null>(null);

  const showCard =
    call.status === "pending" &&
    call.risk !== undefined &&
    onApprove !== undefined &&
    onDeny !== undefined;
  const changedFiles = useMemo(
    () => mergeChangedFiles(call, provocation?.changedFiles),
    [call, provocation?.changedFiles],
  );
  const targetFiles = useMemo(
    () => [...new Set((provocation?.targetFiles ?? []).filter((path) => path.trim().length > 0))],
    [provocation?.targetFiles],
  );
  const provocationContext = useMemo(
    () =>
      showCard && provocation?.enabled && changedFiles.length > 0
        ? {
            mode: provocation.mode,
            stage: "execute" as const,
            projectId: provocation.projectId,
            sessionId: provocation.sessionId,
            taskId: call.id,
            toolCallId: call.id,
            toolName: call.toolName,
            goalText: provocation.goalText ?? undefined,
            planSteps: provocation.planSteps,
            changedFiles,
            targetFiles,
          }
        : null,
    [
      call.id,
      call.toolName,
      changedFiles,
      provocation?.enabled,
      provocation?.goalText,
      provocation?.mode,
      provocation?.planSteps,
      provocation?.projectId,
      provocation?.sessionId,
      showCard,
      targetFiles,
    ],
  );
  const provocationCards = useMemo(
    () => (provocationContext ? generateProvocationCards(provocationContext) : []),
    [provocationContext],
  );
  const highRiskCard =
    provocationCards.find(
      (card) => card.type === "diff_scope_drift" && card.metadata?.highRisk === true,
    ) ?? null;
  const acceptedRisk =
    highRiskCard && riskAcceptance?.cardId === highRiskCard.id ? riskAcceptance : null;
  const approvalRequirement = highRiskCard
    ? {
        required: true,
        satisfied: acceptedRisk !== null,
        message: acceptedRisk
          ? `고위험 변경 수용 이유 기록됨: ${acceptedRisk.reason}`
          : "고위험 변경은 검토 카드에서 짧은 이유를 남긴 뒤에만 승인할 수 있습니다.",
      }
    : undefined;

  const handleProvocationAction = (
    action: ProvocationAction,
    card: ProvocationCardData,
    reason?: string,
  ) => {
    const cardHighRiskFiles = stringListMetadata(card, "highRiskFiles");
    const primaryPaths =
      cardHighRiskFiles.length > 0 ? cardHighRiskFiles : stringListMetadata(card, "changedFiles");

    if (action.kind === "open_diff") {
      const files = changedFilesForDiffPanel(call, changedFiles, primaryPaths);
      openSlideIn({
        tab: "code",
        files,
        emptyReason: files.length > 0 ? null : "no_output",
        replaceFiles: true,
      });
      setSelectedFile(primaryPaths[0] ?? files[0]?.path ?? null);
      setActionStatus({
        kind: "open_diff",
        message: "Diff 패널을 열었습니다.",
      });
      return;
    }

    if (action.kind === "ask_ai_for_rationale") {
      pushComposerSeed(rationalePrompt(provocation?.goalText, primaryPaths));
      setActionStatus({
        kind: "ask_ai_for_rationale",
        message: "채팅 입력창에 고위험 변경 이유 요청을 채웠습니다.",
      });
      return;
    }

    if (action.kind === "revert_unrelated_changes") {
      if (provocation?.onOpenRecovery) {
        provocation.onOpenRecovery();
        setActionStatus({
          kind: "revert_unrelated_changes",
          message: "복구 패널을 열었습니다. 되돌릴 체크포인트를 선택하세요.",
        });
      } else {
        setActionStatus({
          kind: "revert_unavailable",
          message:
            "자동 되돌리기 경로가 연결되어 있지 않습니다. Diff에서 파일을 확인한 뒤 수동으로 되돌리세요.",
        });
      }
      return;
    }

    if (action.kind === "continue_with_risk" && reason?.trim()) {
      setRiskAcceptance({
        cardId: card.id,
        cardType: card.type,
        actionId: action.id,
        reason: reason.trim(),
        highRiskFiles: cardHighRiskFiles,
      });
      setActionStatus({
        kind: "continue_with_risk",
        message: "위험 수용 이유가 이 도구 승인에 연결되었습니다.",
      });
    }
  };

  const handleApprove = (toolCallId: string, modifiedArgs?: unknown) => {
    if (highRiskCard && !acceptedRisk) {
      setActionStatus({
        kind: "risk_reason_required",
        message: "먼저 검토 카드에서 고위험 변경을 계속 진행하는 이유를 남겨야 합니다.",
      });
      return;
    }
    const metadata: ToolApprovalMetadata | undefined =
      highRiskCard && acceptedRisk
        ? {
            source: "provocation.continue_with_risk",
            cardId: acceptedRisk.cardId,
            cardType: acceptedRisk.cardType,
            actionId: acceptedRisk.actionId,
            riskReason: acceptedRisk.reason,
            highRiskFiles: acceptedRisk.highRiskFiles,
          }
        : undefined;
    onApprove?.(toolCallId, modifiedArgs, metadata);
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
          <PermissionCard
            card={card}
            onApprove={handleApprove}
            onDeny={onDeny}
            approvalRequirement={approvalRequirement}
          />
          <ProvocationCardHost
            className="mt-2"
            cards={provocationCards}
            context={provocationContext ?? undefined}
            mode={provocation?.mode ?? "standard"}
            onAction={handleProvocationAction}
          />
          {actionStatus ? (
            <p
              className="mt-2 rounded-sm border border-border bg-bg-panel2 px-2 py-1.5 text-[11px] text-fg-muted"
              data-testid="provocation-action-status"
              data-status-kind={actionStatus.kind}
            >
              {actionStatus.message}
            </p>
          ) : null}
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

  let StatusIcon: LucideIcon = Loader2;
  let statusTone = "text-accent";
  if (denied) {
    StatusIcon = Ban;
    statusTone = "text-fg-subtle";
  } else if (result) {
    StatusIcon = result.success ? Check : X;
    statusTone = result.success ? "text-success" : "text-danger";
  }

  const metaText = denied
    ? t("tool_call.status.denied")
    : result
      ? result.summary
      : running
        ? "…"
        : t("tool_call.status.approved");

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

        {denied && call.deniedReason ? (
          <div className="ml-8 mt-1 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            <p className="font-semibold">{t("tool_call.denied_title")}</p>
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
