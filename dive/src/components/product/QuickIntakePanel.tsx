import { ChevronDown, ClipboardList, Send } from "lucide-react";
import { useMemo, useState } from "react";
import {
  EMPTY_QUICK_INTAKE_INPUT,
  normalizeQuickIntakeInput,
  type QuickIntakeInput,
} from "../../features/planning";
import { useT } from "../../i18n";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

interface QuickIntakePanelProps {
  enabled: boolean;
  busy?: boolean;
  onSubmit: (input: QuickIntakeInput) => void;
}

export function QuickIntakePanel({ enabled, busy = false, onSubmit }: QuickIntakePanelProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState<QuickIntakeInput>(EMPTY_QUICK_INTAKE_INPUT);
  const normalized = useMemo(() => normalizeQuickIntakeInput(input), [input]);
  const canSubmit = Object.values(normalized).every((value) => value.length > 0) && !busy;

  if (!enabled) return null;

  const update = (key: keyof QuickIntakeInput, value: string) => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(normalized);
  };

  return (
    <div
      className="border-b bg-bg-panel/60"
      data-testid="quick-intake-panel"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-medium text-fg hover:bg-bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        data-testid="quick-intake-toggle"
      >
        <ClipboardList className="h-4 w-4 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block">{t("planning.interview.quick_intake.title")}</span>
          <span className="block text-[11px] font-normal leading-snug text-fg-muted">
            {t("planning.interview.quick_intake.description")}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-fg-muted transition-transform", expanded && "rotate-180")}
          aria-hidden
        />
      </button>

      {expanded ? (
        <div className="space-y-3 border-t px-4 py-3">
          {(Object.keys(EMPTY_QUICK_INTAKE_INPUT) as Array<keyof QuickIntakeInput>).map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-fg-muted">
                {t(`planning.interview.quick_intake.fields.${key}.label`)}
              </span>
              <textarea
                value={input[key]}
                onChange={(event) => update(key, event.target.value)}
                rows={key === "inScope" || key === "outOfScope" ? 2 : 1}
                className="resize-none rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                placeholder={t(`planning.interview.quick_intake.fields.${key}.placeholder`)}
                disabled={busy}
                data-testid={`quick-intake-${key}`}
              />
              <span className="text-[11px] leading-snug text-fg-muted">
                {t(`planning.interview.quick_intake.fields.${key}.help`)}
              </span>
            </label>
          ))}
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            disabled={!canSubmit}
            onClick={submit}
            data-testid="quick-intake-submit"
          >
            <Send />
            {t("planning.interview.quick_intake.submit")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default QuickIntakePanel;
