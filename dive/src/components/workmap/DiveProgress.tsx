import { cn } from "../../lib/utils";
import type { CardDiveStages, CardTileMode } from "./types";

interface DiveProgressProps {
  stages: CardDiveStages;
  mode: CardTileMode;
  className?: string;
}

const ORDER: Array<keyof CardDiveStages> = ["d", "i", "v", "e"];

function completedCount(stages: CardDiveStages): number {
  return ORDER.reduce((sum, key) => (stages[key] ? sum + 1 : sum), 0);
}

function compressedText(stages: CardDiveStages): string {
  let text = "";
  for (const key of ORDER) {
    if (!stages[key]) break;
    text += key.toUpperCase();
  }
  return text;
}

export function DiveProgress({ stages, mode, className }: DiveProgressProps) {
  const completed = completedCount(stages);

  if (mode === "collapsed") {
    const text = compressedText(stages);
    return (
      <span
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label="DIVE 진행 상황"
        data-testid="dive-progress"
        data-mode="collapsed"
        className={cn(
          "inline-block font-mono text-[10px] tabular-nums text-fg-muted",
          "min-w-[2.75rem] text-right",
          className,
        )}
      >
        {text || "-"}
      </span>
    );
  }

  return (
    <div
      role="progressbar"
      aria-valuenow={completed}
      aria-valuemin={0}
      aria-valuemax={4}
      aria-label="DIVE 진행 상황"
      data-testid="dive-progress"
      data-mode="expanded"
      className={cn("flex items-center gap-1.5", className)}
    >
      {ORDER.map((key) => (
        <span
          key={key}
          data-stage={key}
          data-completed={stages[key] ? "true" : "false"}
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors",
            stages[key] ? "bg-accent" : "bg-bg-panel2",
          )}
        />
      ))}
    </div>
  );
}

export default DiveProgress;
