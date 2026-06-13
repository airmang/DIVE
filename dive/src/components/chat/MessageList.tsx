import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { ChatMessage, ToolApprovalMetadata } from "./types";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ToolActivity } from "./ToolActivity";
import { SystemMessage } from "./SystemMessage";
import { ErrorMessage } from "./ErrorMessage";
import { filterInterviewNoise } from "./filterInterviewNoise";
import { useT } from "../../i18n";
import { useChatComposerStore } from "../../stores/chatComposer";
import type {
  ProvocationChangedFile,
  ProvocationPlanStep,
  ScaffoldMode,
} from "../../features/provocation";
import {
  ProvocationCardHost,
  assistantReportsFromConversation,
  createProvocationContext,
  generateProvocationCards,
  retrySignalsFromConversation,
  type ProvocationAction,
} from "../../features/provocation";

interface Props {
  messages: ChatMessage[];
  onRetryError?: (id: string) => void;
  onEditUser?: (id: string) => void;
  onResendUser?: (id: string) => void;
  onApproveToolCall?: (
    toolCallId: string,
    modifiedArgs?: unknown,
    approvalMetadata?: ToolApprovalMetadata,
  ) => void;
  onDenyToolCall?: (toolCallId: string, reason?: string) => void;
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
  /** Cap DOM nodes to last N. Real virtualization lands in task 4-4. */
  maxRendered?: number;
}

/** Scroll distance from bottom that still counts as "pinned". */
const AUTO_SCROLL_THRESHOLD_PX = 50;

function isToolRelated(message: ChatMessage): boolean {
  return (
    message.kind === "reasoning" || message.kind === "tool_call" || message.kind === "tool_result"
  );
}

function MessageListImpl({
  messages,
  onRetryError,
  onEditUser,
  onResendUser,
  onApproveToolCall,
  onDenyToolCall,
  provocation,
  maxRendered = 200,
}: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pendingNodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [autoScroll, setAutoScroll] = useState(true);
  const pushComposerSeed = useChatComposerStore((s) => s.pushSeed);

  const rendered = filterInterviewNoise(messages);
  const visible = rendered.length > maxRendered ? rendered.slice(-maxRendered) : rendered;
  const pendingApproval = visible.find(
    (message) => message.kind === "tool_call" && message.status === "pending",
  );
  const conversationProvocationContext = useMemo(() => {
    if (!provocation?.enabled) return null;
    const assistantReports = assistantReportsFromConversation(visible);
    const retrySignals = retrySignalsFromConversation(visible);
    if (assistantReports.length === 0 && retrySignals.length === 0) return null;
    const retryTaskId = [...retrySignals].reverse().find((signal) => signal.lastUserMessageId)
      ?.lastUserMessageId;
    const assistantTaskId = [...assistantReports].reverse().find((report) => report.messageId)
      ?.messageId;

    return createProvocationContext({
      mode: provocation.mode,
      stage: retrySignals.length > 0 ? "execute" : "verify",
      projectId: provocation.projectId,
      sessionId: provocation.sessionId,
      taskId: retryTaskId ?? assistantTaskId,
      goalText: provocation.goalText ?? undefined,
      assistantReports,
      retrySignals,
    });
  }, [
    provocation?.enabled,
    provocation?.goalText,
    provocation?.mode,
    provocation?.projectId,
    provocation?.sessionId,
    visible,
  ]);
  const conversationProvocationCards = useMemo(
    () =>
      conversationProvocationContext
        ? generateProvocationCards(conversationProvocationContext).filter(
            (card) => card.type === "ai_self_report_only" || card.type === "regeneration_loop",
          )
        : [],
    [conversationProvocationContext],
  );

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX);
  }, []);

  useLayoutEffect(() => {
    if (!autoScroll) return;
    sentinelRef.current?.scrollIntoView({ block: "end" });
  }, [messages, autoScroll]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const setPendingNode = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      if (node) {
        pendingNodeRefs.current.set(id, node);
      } else {
        pendingNodeRefs.current.delete(id);
      }
    },
    [],
  );

  const scrollToPendingApproval = useCallback(() => {
    if (!pendingApproval) return;
    pendingNodeRefs.current.get(pendingApproval.id)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [pendingApproval]);

  const handleConversationProvocationAction = useCallback(
    (action: ProvocationAction) => {
      if (action.kind === "create_repro_steps") {
        pushComposerSeed(
          "반복되는 오류를 기준으로 재현 단계, 가장 작은 확인 명령, 마지막 변경에서 볼 부분을 정리해줘.",
        );
        return;
      }
      if (action.kind === "rollback_last_change") {
        provocation?.onOpenRecovery?.();
        return;
      }
      if (action.kind === "split_scope") {
        pushComposerSeed("현재 실패를 더 작은 범위 하나로 줄여서 다시 요청할 문장을 만들어줘.");
        return;
      }
      if (action.kind === "retry_with_ai") {
        pushComposerSeed(
          "복구 지점, 재현 단계, 범위 축소 여부를 먼저 확인한 뒤 같은 실패를 피해서 다시 고쳐줘.",
        );
        return;
      }
      if (action.kind === "run_tests") {
        pushComposerSeed("AI 완료 보고를 검증할 수 있는 가장 작은 테스트 또는 확인 명령을 제안해줘.");
        return;
      }
      if (action.kind === "run_app" || action.kind === "open_preview") {
        pushComposerSeed("AI 완료 보고를 검증하기 위해 프리뷰에서 확인할 동작과 기준을 짧게 정리해줘.");
      }
    },
    [provocation, pushComposerSeed],
  );

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-6 py-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      data-testid="message-list"
      data-auto-scroll={autoScroll ? "true" : "false"}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {pendingApproval && !autoScroll ? (
          <button
            type="button"
            className="sticky top-2 z-10 flex min-h-11 items-center gap-2 self-center rounded-md border border-warn/50 bg-bg-panel px-3 py-2 text-sm font-medium text-fg shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            onClick={scrollToPendingApproval}
            aria-label={t("chat.pending_approval_jump_aria")}
            data-testid="pending-approval-jump"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
            <span>{t("chat.pending_approval_jump")}</span>
          </button>
        ) : null}
        {(() => {
          // Group reasoning + tool_call + tool_result by call_id into one ToolActivity.
          // reasoning carries toolCallId; tool_result id is `tr-<call_id>`.
          const reasoningByCall = new Map<string, (typeof visible)[number]>();
          const resultByCall = new Map<string, (typeof visible)[number]>();
          for (const m of visible) {
            if (m.kind === "reasoning") reasoningByCall.set(m.toolCallId, m);
            else if (m.kind === "tool_result") resultByCall.set(m.id.replace(/^tr-/, ""), m);
          }

          const renderToolActivity = (msg: Extract<ChatMessage, { kind: "tool_call" }>) => {
            const reasoning = reasoningByCall.get(msg.id);
            const result = resultByCall.get(msg.id);
            return (
              <div
                key={msg.id}
                ref={msg.status === "pending" ? setPendingNode(msg.id) : undefined}
                data-pending-approval={msg.status === "pending" ? "true" : undefined}
              >
                <ToolActivity
                  call={msg}
                  reasoning={reasoning?.kind === "reasoning" ? reasoning : undefined}
                  result={result?.kind === "tool_result" ? result : undefined}
                  onApprove={onApproveToolCall}
                  onDeny={onDenyToolCall}
                  provocation={provocation}
                />
              </div>
            );
          };

          const renderToolGroup = (
            calls: Extract<ChatMessage, { kind: "tool_call" }>[],
            key: string,
          ) => {
            const hasPending = calls.some((call) => call.status === "pending");
            const hasRunning = calls.some(
              (call) => call.status === "approved" && !resultByCall.has(call.id),
            );
            const failedCount = calls.filter((call) => {
              const result = resultByCall.get(call.id);
              return result?.kind === "tool_result" && !result.success;
            }).length;
            const summaryKey = hasPending
              ? "tool_call.group_summary_pending"
              : hasRunning
                ? "tool_call.group_summary_running"
                : failedCount > 0
                  ? "tool_call.group_summary_failed"
                  : "tool_call.group_summary";
            return (
              <details
                key={key}
                className="group rounded-md border border-border bg-bg-panel2/50 px-3 py-2"
                data-testid="tool-activity-list"
                open={hasPending || hasRunning ? true : undefined}
              >
                <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
                  <ChevronDown
                    className="h-4 w-4 text-fg-subtle transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                  <span>{t(summaryKey, { count: calls.length })}</span>
                </summary>
                <div className="mt-2 flex flex-col gap-2">{calls.map(renderToolActivity)}</div>
              </details>
            );
          };

          const collectToolCalls = (start: number) => {
            const calls: Extract<ChatMessage, { kind: "tool_call" }>[] = [];
            let cursor = start;
            while (cursor < visible.length && isToolRelated(visible[cursor])) {
              const candidate = visible[cursor];
              if (candidate.kind === "tool_call") calls.push(candidate);
              cursor += 1;
            }
            return { calls, nextIndex: cursor };
          };

          const items: ReactNode[] = [];
          for (let index = 0; index < visible.length; index += 1) {
            const msg = visible[index];
            switch (msg.kind) {
              case "user":
                items.push(
                  <UserMessage
                    key={msg.id}
                    message={msg}
                    onEdit={onEditUser}
                    onResend={onResendUser}
                  />,
                );
                break;
              case "assistant":
                if (index + 1 < visible.length && isToolRelated(visible[index + 1])) {
                  const { calls, nextIndex } = collectToolCalls(index + 1);
                  if (calls.length > 0) {
                    items.push(renderToolGroup(calls, `tools-before-${msg.id}`));
                    items.push(<AssistantMessage key={msg.id} message={msg} />);
                    index = nextIndex - 1;
                    break;
                  }
                }
                items.push(<AssistantMessage key={msg.id} message={msg} />);
                break;
              case "reasoning":
                // Rendered inside its ToolActivity (grouped by toolCallId).
                break;
              case "tool_call": {
                const { calls, nextIndex } = collectToolCalls(index);
                if (calls.length > 0) {
                  items.push(
                    renderToolGroup(calls, `tools-${calls.map((call) => call.id).join("-")}`),
                  );
                  index = nextIndex - 1;
                }
                break;
              }
              case "tool_result":
                // Rendered inside its ToolActivity (grouped by call_id).
                break;
              case "system":
                items.push(<SystemMessage key={msg.id} message={msg} />);
                break;
              case "error":
                items.push(<ErrorMessage key={msg.id} message={msg} onRetry={onRetryError} />);
                break;
            }
          }
          return items;
        })()}
        {conversationProvocationCards.length > 0 && conversationProvocationContext ? (
          <ProvocationCardHost
            className="rounded-md border border-border bg-bg-panel px-3 py-2"
            cards={conversationProvocationCards}
            context={conversationProvocationContext}
            mode={provocation?.mode ?? "standard"}
            onAction={handleConversationProvocationAction}
          />
        ) : null}
        <div ref={sentinelRef} aria-hidden />
      </div>
    </div>
  );
}

export const MessageList = memo(MessageListImpl);
