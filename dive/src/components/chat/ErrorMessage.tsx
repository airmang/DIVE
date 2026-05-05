import { memo } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ErrorMessageData } from "./types";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
import { classifyError } from "../../lib/error-classify";

interface Props {
  message: ErrorMessageData;
  onRetry?: (id: string) => void;
}

function ErrorMessageImpl({ message, onRetry }: Props) {
  const t = useT();
  const classified = classifyError(message.message);
  const hints = t(classified.hintsKey)
    .split("|")
    .map((hint) => hint.trim())
    .filter(Boolean);
  const retryable = message.retryable || classified.retryable;

  return (
    <article
      className="flex items-start justify-center"
      data-testid="chat-message"
      data-kind="error"
      data-message-id={message.id}
      role="alert"
    >
      <div className="flex w-full max-w-[80%] items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-danger">{t(classified.titleKey)}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-fg">
            {t(classified.bodyKey, { message: classified.rawMessage })}
          </p>
          {hints.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-fg-muted">
              {hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {retryable ? (
          <Button
            variant="outline"
            size="sm"
            aria-label={t("common.retry")}
            onClick={() => onRetry?.(message.id)}
            disabled={!onRetry}
            data-testid="error-retry"
          >
            <RotateCcw className="h-3 w-3" />
            {t("common.retry")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export const ErrorMessage = memo(ErrorMessageImpl);
