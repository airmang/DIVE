import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { LearningHint } from "../ui/learning-hint";
import {
  templatesForContext,
  PROMPT_TEMPLATES,
  type PromptContext,
} from "../../lib/prompt-templates";
import { useT } from "../../i18n";

interface Props {
  open: boolean;
  context: PromptContext | null;
  onClose: () => void;
  onInsert: (body: string) => void;
}

export function PromptHelperPanel({ open, context, onClose, onInsert }: Props) {
  const t = useT();
  if (!open) return null;
  const list = context ? templatesForContext(context) : PROMPT_TEMPLATES;
  const fallback = context && list.length === 0 ? PROMPT_TEMPLATES : null;

  return (
    <aside
      className="flex w-[280px] flex-col gap-3 border-l bg-bg-panel p-3"
      role="complementary"
      aria-label={t("prompt_helper.title")}
      data-testid="prompt-helper-panel"
      data-context={context ?? ""}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t("prompt_helper.title")}</h3>
          {context ? <Badge variant="accent">{t(`prompt_helper.context.${context}`)}</Badge> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={t("prompt_helper.close_aria")}
          data-testid="prompt-helper-close"
        >
          <X />
        </Button>
      </header>
      <p className="text-[11px] text-fg-muted">{t("prompt_helper.templates_for_flow")}</p>
      <LearningHint>{t("prompt_helper.hint")}</LearningHint>
      <div className="flex flex-col gap-2" data-testid="prompt-helper-templates">
        {list.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="rounded-md border bg-bg-panel2 p-2 text-left transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onInsert(t(`prompt_helper.templates.${tpl.id}.body`))}
            data-testid="prompt-helper-template"
            data-template-id={tpl.id}
          >
            <div className="text-xs font-medium text-fg">
              {t(`prompt_helper.templates.${tpl.id}.title`)}
            </div>
            <div className="mt-1 text-[11px] text-fg-muted">
              {t(`prompt_helper.templates.${tpl.id}.body`)}
            </div>
          </button>
        ))}
        {fallback ? (
          <LearningHint className="text-[10px]">
            {t("prompt_helper.fallback")}
          </LearningHint>
        ) : null}
      </div>
    </aside>
  );
}

export default PromptHelperPanel;
