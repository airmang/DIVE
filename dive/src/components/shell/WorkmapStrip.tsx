import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

interface WorkmapStripProps {
  className?: string;
  collapsed: boolean;
  onToggle: () => void;
}

const EXPANDED_HEIGHT = 220;
const COLLAPSED_HEIGHT = 80;

export function WorkmapStrip({ className, collapsed, onToggle }: WorkmapStripProps) {
  const height = collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT;
  const progressPercent = 0;

  return (
    <section
      data-testid="workmap-strip"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="워크맵"
      className={cn(
        "flex flex-col overflow-hidden border-t bg-bg-panel",
        "transition-[height] duration-200 ease-out motion-reduce:transition-none",
        className,
      )}
      style={{ height }}
    >
      <header className="flex h-10 shrink-0 items-center gap-3 px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-fg">워크맵</h2>
          <span className="text-xs text-fg-muted">{progressPercent}%</span>
        </div>

        <div
          className="relative h-1.5 max-w-md flex-1 overflow-hidden rounded-full bg-bg-panel2"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="워크맵 진행률"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" disabled aria-label="카드 추가 (준비 중)">
            <Plus />
            카드 추가
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            aria-label={collapsed ? "워크맵 펼치기" : "워크맵 접기"}
            aria-expanded={!collapsed}
            aria-controls="workmap-body"
            data-testid="workmap-toggle"
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </div>
      </header>

      <div
        id="workmap-body"
        aria-hidden={collapsed}
        className={cn(
          "flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4",
          collapsed && "pointer-events-none invisible",
        )}
      >
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-fg-muted">
            아직 카드가 없습니다. D 단계에서 작업을 분해해 카드를 만드세요.
          </p>
        </div>
      </div>
    </section>
  );
}

export default WorkmapStrip;
