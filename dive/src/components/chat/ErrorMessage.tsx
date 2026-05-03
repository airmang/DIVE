import { memo } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ErrorMessageData } from "./types";
import { Button } from "../ui/button";

interface Props {
  message: ErrorMessageData;
  onRetry?: (id: string) => void;
}

function ErrorMessageImpl({ message, onRetry }: Props) {
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
          <p className="text-sm font-medium text-danger">오류</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-fg">
            {message.message}
          </p>
        </div>
        {message.retryable ? (
          <Button
            variant="outline"
            size="sm"
            aria-label="재시도"
            onClick={() => onRetry?.(message.id)}
            disabled={!onRetry}
            data-testid="error-retry"
          >
            <RotateCcw className="h-3 w-3" />
            재시도
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export const ErrorMessage = memo(ErrorMessageImpl);
