import { memo } from "react";
import type { UserMessageData } from "./types";
import { Button } from "../ui/button";
import { Pencil, RotateCcw } from "lucide-react";
import { useT } from "../../i18n";

interface Props {
  message: UserMessageData;
  onEdit?: (id: string) => void;
  onResend?: (id: string) => void;
}

function UserMessageImpl({ message, onEdit, onResend }: Props) {
  const t = useT();
  return (
    <article
      className="flex flex-col items-end gap-1"
      data-testid="chat-message"
      data-kind="user"
      data-message-id={message.id}
    >
      <div className="group relative max-w-full rounded-lg bg-accent-subtle px-4 py-2 text-fg sm:max-w-[80%]">
        <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        {onEdit || onResend ? (
          <div className="absolute -top-3 right-1 hidden gap-1 group-focus-within:flex group-hover:flex">
            {onEdit ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("chat.message.edit_aria")}
                onClick={() => onEdit(message.id)}
                className="h-6 w-6 bg-bg-panel2"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            ) : null}
            {onResend ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("chat.message.resend_aria")}
                onClick={() => onResend(message.id)}
                className="h-6 w-6 bg-bg-panel2"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const UserMessage = memo(UserMessageImpl);
