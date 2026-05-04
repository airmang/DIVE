import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { DiveStage } from "../../lib/ambiguity";
import { templatesForStage, PROMPT_TEMPLATES } from "../../lib/prompt-templates";

interface Props {
  open: boolean;
  stage: DiveStage | null;
  onClose: () => void;
  onInsert: (body: string) => void;
}

const STAGE_LABEL: Record<DiveStage, string> = {
  D: "D · Decompose",
  I: "I · Instruct",
  V: "V · Verify",
  E: "E · Extend",
};

export function PromptHelperPanel({ open, stage, onClose, onInsert }: Props) {
  if (!open) return null;
  const list = stage ? templatesForStage(stage) : PROMPT_TEMPLATES;
  const fallback = stage && list.length === 0 ? PROMPT_TEMPLATES : null;

  return (
    <aside
      className="flex w-[280px] flex-col gap-3 border-l bg-bg-panel p-3"
      role="complementary"
      aria-label="프롬프트 도우미"
      data-testid="prompt-helper-panel"
      data-stage={stage ?? ""}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">프롬프트 도우미</h3>
          {stage ? <Badge variant="accent">{STAGE_LABEL[stage]}</Badge> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="프롬프트 도우미 닫기"
          data-testid="prompt-helper-close"
        >
          <X />
        </Button>
      </header>
      <p className="text-[11px] text-fg-muted">
        현재 단계에 맞는 템플릿을 눌러 입력란에 삽입하세요. 대괄호 부분을 본인 작업으로 교체하면
        됩니다.
      </p>
      <div className="flex flex-col gap-2" data-testid="prompt-helper-templates">
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            className="rounded-md border bg-bg-panel2 p-2 text-left transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onInsert(t.body)}
            data-testid="prompt-helper-template"
            data-template-id={t.id}
          >
            <div className="text-xs font-medium text-fg">{t.title}</div>
            <div className="mt-1 text-[11px] text-fg-muted">{t.body}</div>
          </button>
        ))}
        {fallback ? (
          <div className="text-[10px] text-fg-muted" data-testid="prompt-helper-fallback">
            이 단계용 템플릿이 아직 없어 전체 라이브러리를 대신 표시합니다.
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export default PromptHelperPanel;
