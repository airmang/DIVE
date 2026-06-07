import { AlertCircle, Code, Eye, Lightbulb, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import { ChatInput } from "../chat/ChatInput";
import { MessageList } from "../chat/MessageList";
import type { ChatMessage } from "../chat/types";
import type { PromptContext } from "../../lib/prompt-templates";
import { useT } from "../../i18n";

export type ChatStageBannerTone = "info" | "warn" | "success";

export interface ChatStageBanner {
  tone: ChatStageBannerTone;
  message: string;
}

interface ChatAreaProps {
  className?: string;
  messages?: ChatMessage[];
  cardTitle?: string | null;
  sessionTitle?: string | null;
  cardStateLabel?: string | null;
  stageBanner?: ChatStageBanner | null;
  onSendMessage?: (text: string) => void;
  onOpenSlidePanel?: () => void;
  onRetryError?: (id: string) => void;
  onApproveToolCall?: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDenyToolCall?: (toolCallId: string, reason?: string) => void;
  interviewPanel?: ReactNode;
  modelLabel?: string;
  isStreaming?: boolean;
  runStartedAt?: number | null;
  cancelRequested?: boolean;
  onCancelStreaming?: () => void;
  isRouting?: boolean;
  routeStartedAt?: number | null;
  routeCancelRequested?: boolean;
  onCancelRouting?: () => void;
  inputDisabled?: boolean;
  inputBlocked?: { reason: string; actionLabel?: string; onAction?: () => void } | null;
  composerHint?: { message: string; actionLabel?: string; onAction?: () => void } | null;
  context?: PromptContext | null;
  emptyState?: {
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
  };
  planDraftApproval?: ReactNode;
}

export function ChatArea({
  className,
  messages,
  cardTitle,
  sessionTitle,
  cardStateLabel,
  stageBanner,
  onSendMessage,
  onOpenSlidePanel,
  onRetryError,
  onApproveToolCall,
  onDenyToolCall,
  interviewPanel,
  modelLabel,
  isStreaming = false,
  runStartedAt = null,
  cancelRequested = false,
  onCancelStreaming,
  isRouting = false,
  routeStartedAt = null,
  routeCancelRequested = false,
  onCancelRouting,
  inputDisabled,
  inputBlocked,
  composerHint,
  context,
  emptyState,
  planDraftApproval,
}: ChatAreaProps) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [hintDismissed, setHintDismissed] = useState(false);
  useEffect(() => {
    setHintDismissed(false);
  }, [composerHint?.message]);
  const showComposerHint = composerHint !== null && composerHint !== undefined && !hintDismissed;
  const hasConversation = messages !== undefined && messages.length > 0;
  const elapsedSeconds =
    isStreaming && runStartedAt !== null ? Math.max(0, Math.floor((now - runStartedAt) / 1000)) : 0;
  const runningLabel = isStreaming
    ? t("chat.running.elapsed", { seconds: elapsedSeconds })
    : undefined;
  const routeElapsedSeconds =
    isRouting && routeStartedAt !== null
      ? Math.max(0, Math.floor((now - routeStartedAt) / 1000))
      : 0;
  const routingLabel = isRouting
    ? routeCancelRequested
      ? t("planning.route.cancel_requested_status")
      : t("planning.route.elapsed", { seconds: routeElapsedSeconds })
    : undefined;

  const handleOpenSlidePanel = () => {
    if (onOpenSlidePanel) onOpenSlidePanel();
  };

  useEffect(() => {
    if ((!isStreaming || runStartedAt === null) && (!isRouting || routeStartedAt === null)) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRouting, isStreaming, routeStartedAt, runStartedAt]);

  return (
    <section className={cn("flex h-full flex-col bg-bg", className)} aria-label={t("chat.region_aria")}>
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold text-fg">{t("chat.header_title")}</h1>
          <span className="text-xs text-fg-muted" data-testid="chat-card-title">
            {cardTitle ?? sessionTitle ?? t("chat.no_session")}
          </span>
          {cardStateLabel ? (
            <span
              className="rounded-full bg-bg-panel2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
              data-testid="chat-card-state"
            >
              {cardStateLabel}
            </span>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenSlidePanel}
          aria-label={t("chat.slide_panel_aria")}
        >
          <Code />
          <span>{t("chat.code_label")}</span>
          <span className="text-fg-subtle">/</span>
          <Eye />
          <span>{t("chat.preview_label")}</span>
        </Button>
      </header>

      {stageBanner ? (
        <div
          role="status"
          data-testid="chat-stage-banner"
          data-tone={stageBanner.tone}
          className={cn(
            "flex items-center gap-2 border-b px-6 py-2 text-xs",
            stageBanner.tone === "warn" && "bg-warn/10 text-warn",
            stageBanner.tone === "success" && "bg-success/10 text-success",
            stageBanner.tone === "info" && "bg-info/10 text-info",
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-fg">{stageBanner.message}</span>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden">
        {planDraftApproval ? (
          planDraftApproval
        ) : hasConversation ? (
          <MessageList
            messages={messages}
            onRetryError={onRetryError}
            onApproveToolCall={onApproveToolCall}
            onDenyToolCall={onDenyToolCall}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-xl font-semibold text-fg">
              {emptyState?.title ?? t("chat.empty_default_title")}
            </p>
            <p className="text-sm text-fg-muted">
              {emptyState?.description ?? t("chat.empty_default_description")}
            </p>
            {!emptyState?.description ? (
              <LearningHint className="text-sm">{t("chat.empty_hint")}</LearningHint>
            ) : null}
            {emptyState?.actionLabel && emptyState.onAction ? (
              <Button
                variant="primary"
                size="sm"
                onClick={emptyState.onAction}
                data-testid="chat-empty-cta"
              >
                {emptyState.actionLabel}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t p-4">
        {isRouting ? (
          <div
            className="mb-2 flex items-center gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg"
            role="status"
            data-testid="chat-routing-status"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-info" aria-hidden />
            <span className="flex-1">{routingLabel}</span>
            {onCancelRouting ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancelRouting}
                disabled={routeCancelRequested}
                data-testid="chat-cancel-routing"
              >
                <X />
                {routeCancelRequested
                  ? t("planning.route.cancel_requested")
                  : t("planning.route.cancel")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {isStreaming ? (
          <div
            className="mb-2 flex items-center gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg"
            role="status"
            data-testid="chat-running-status"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-info" aria-hidden />
            <span className="flex-1">{runningLabel}</span>
            {onCancelStreaming ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onCancelStreaming}
                disabled={cancelRequested}
                data-testid="chat-cancel-streaming"
              >
                <X />
                {cancelRequested ? t("chat.running.cancel_requested") : t("chat.running.cancel")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {inputBlocked ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
            role="status"
            data-testid="chat-input-blocked"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1 text-fg">{inputBlocked.reason}</span>
            {inputBlocked.actionLabel && inputBlocked.onAction ? (
              <Button
                variant="outline"
                size="sm"
                onClick={inputBlocked.onAction}
                data-testid="chat-input-blocked-action"
              >
                {inputBlocked.actionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
        {showComposerHint && composerHint ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-md border border-accent/40 bg-accent-subtle px-3 py-2 text-xs"
            role="status"
            data-testid="chat-composer-hint"
          >
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="flex-1 text-fg">{composerHint.message}</span>
            {composerHint.actionLabel && composerHint.onAction ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={composerHint.onAction}
                data-testid="chat-composer-hint-action"
              >
                {composerHint.actionLabel}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHintDismissed(true)}
              aria-label={t("chat.hint_dismiss_aria")}
              data-testid="chat-composer-hint-dismiss"
            >
              <X />
            </Button>
          </div>
        ) : null}
        {interviewPanel ? (
          interviewPanel
        ) : onSendMessage ? (
          <ChatInput
            onSend={onSendMessage}
            disabled={inputDisabled || !!inputBlocked}
            modelLabel={modelLabel}
            busyLabel={runningLabel ?? routingLabel}
            context={context}
          />
        ) : (
          <ChatInput
            onSend={() => {}}
            disabled={inputDisabled || !!inputBlocked}
            modelLabel={modelLabel}
            busyLabel={runningLabel ?? routingLabel}
            context={context}
          />
        )}
      </footer>
    </section>
  );
}

export default ChatArea;
