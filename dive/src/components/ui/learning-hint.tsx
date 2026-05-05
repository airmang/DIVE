import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useTutorialEnabled } from "../../stores/ui-preferences";

interface LearningHintProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  inline?: boolean;
}

export function LearningHint({ children, className, inline = false, ...props }: LearningHintProps) {
  const enabled = useTutorialEnabled();
  if (!enabled) return null;

  const Comp = inline ? "span" : "div";
  return (
    <Comp
      {...props}
      data-testid="learning-hint"
      data-tutorial-visible="true"
      className={cn("text-[11px] leading-snug text-fg-muted", className)}
    >
      {children}
    </Comp>
  );
}

export default LearningHint;
