import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Send, Sparkles, ClipboardCheck } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { AmbiguityHit } from "../../lib/ambiguity";
import type { PromptContext } from "../../lib/prompt-templates";
import { AmbiguityHintList, AmbiguityUnderlay } from "../prompt-helper/AmbiguityHinter";
import { PromptHelperPanel } from "../prompt-helper/PromptHelperPanel";
import { PromptCheckDialog, type PromptCheckResult } from "../prompt-helper/PromptCheckDialog";
import { RuntimeModelSelector } from "./RuntimeModelSelector";
import { useChatComposerStore } from "../../stores/chatComposer";
import { useT } from "../../i18n";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  modelLabel?: string;
  busyLabel?: string;
  onPromptHelper?: () => void;
  context?: PromptContext | null;
  className?: string;
  promptCheckMock?: PromptCheckResult;
}

const MIN_HEIGHT_PX = 40;
const MAX_HEIGHT_PX = 200;

export function ChatInput({
  onSend,
  disabled = false,
  modelLabel,
  busyLabel,
  onPromptHelper,
  context = null,
  className,
  promptCheckMock,
}: Props) {
  const t = useT();
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<AmbiguityHit[]>([]);
  const [helperOpen, setHelperOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  const composerPending = useChatComposerStore((s) => s.pending);
  const consumeComposer = useChatComposerStore((s) => s.consume);
  useEffect(() => {
    if (!composerPending) return;
    const { seed, focus } = composerPending;
    consumeComposer();
    if (seed.length > 0) {
      setValue(seed);
      setHits([]);
    }
    if (focus) {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      });
    }
  }, [composerPending, consumeComposer]);

  const canSend = value.trim().length > 0 && !disabled && !runtimeSaving;
  const canCheck = value.trim().length > 0 && !disabled && !runtimeSaving;

  const handleSend = () => {
    if (!canSend) return;
    onSend(value);
    setValue("");
    setHits([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      if (canCheck) {
        e.preventDefault();
        setCheckOpen(true);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleHelperButton = () => {
    setHelperOpen((o) => !o);
    onPromptHelper?.();
  };

  const handleInsertTemplate = (body: string) => {
    setValue((v) => (v.length === 0 ? body : `${v}\n${body}`));
    textareaRef.current?.focus();
    setHelperOpen(false);
  };

  const handleApplyRefined = (refined: string, alsoSend: boolean) => {
    if (alsoSend) {
      onSend(refined);
      setValue("");
      setHits([]);
    } else {
      setValue(refined);
    }
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <div className="flex flex-1 flex-col gap-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={t("chat.input.placeholder")}
            aria-label={t("chat.input.aria_label")}
            rows={1}
            data-testid="chat-input-textarea"
            className={cn(
              "relative w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm leading-normal text-fg",
              "placeholder:text-fg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            style={{ minHeight: `${MIN_HEIGHT_PX}px`, maxHeight: `${MAX_HEIGHT_PX}px` }}
          />
          <AmbiguityUnderlay value={value} onHitsChange={setHits} />
        </div>
        <AmbiguityHintList hits={hits} />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleHelperButton}
            disabled={disabled}
            aria-label={t("chat.input.prompt_helper_aria")}
            aria-expanded={helperOpen}
            data-testid="chat-prompt-helper"
          >
            <Sparkles />
            {t("chat.input.prompt_helper_label")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCheckOpen(true)}
            disabled={!canCheck}
            aria-label={t("chat.input.pre_send_check_aria")}
            data-testid="chat-prompt-check"
          >
            <ClipboardCheck />
            {t("chat.input.pre_send_check_label")}
          </Button>
          <div className="flex-1" />
          <RuntimeModelSelector
            busyLabel={busyLabel}
            fallbackLabel={modelLabel ?? t("chat.input.model_select_default_label")}
            disabled={disabled}
            onBusyChange={setRuntimeSaving}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!canSend}
            aria-label={t("chat.input.send_aria")}
            data-testid="chat-send"
          >
            <Send />
            {t("chat.input.send_label")}
          </Button>
        </div>
      </div>
      <PromptHelperPanel
        open={helperOpen}
        context={context}
        onClose={() => setHelperOpen(false)}
        onInsert={handleInsertTemplate}
      />
      <PromptCheckDialog
        open={checkOpen}
        initialText={value}
        onOpenChange={setCheckOpen}
        onApply={handleApplyRefined}
        mockResult={promptCheckMock}
      />
    </div>
  );
}

export default ChatInput;
