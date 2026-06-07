import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";

interface Props {
  initial: unknown;
  onChange: (parsed: unknown | null) => void;
  className?: string;
}

export function ArgsEditor({ initial, onChange, className }: Props) {
  const t = useT();
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = useState<string | null>(null);

  const debouncedText = useDebounce(text, 200);

  const parsed = useMemo(() => {
    try {
      return JSON.parse(debouncedText);
    } catch (e) {
      return { __error: e instanceof Error ? e.message : String(e) };
    }
  }, [debouncedText]);

  useEffect(() => {
    if (parsed && typeof parsed === "object" && "__error" in parsed) {
      setError((parsed as { __error: string }).__error);
      onChange(null);
    } else {
      setError(null);
      onChange(parsed);
    }
  }, [parsed, onChange]);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-xs text-fg-muted">{t("permission_card.actions.args_label")}</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        spellCheck={false}
        aria-label={t("permission_card.actions.args_aria")}
        data-testid="args-editor-textarea"
        className={cn(
          "w-full resize-y rounded-md border bg-bg-panel2 px-3 py-2 font-mono text-xs text-fg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          error ? "border-danger" : "",
        )}
      />
      {error ? (
        <p className="text-xs text-danger" data-testid="args-editor-error">
          {t("permission_card.actions.json_error", { message: error })}
        </p>
      ) : null}
    </div>
  );
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
