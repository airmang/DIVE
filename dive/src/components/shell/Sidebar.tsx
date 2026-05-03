import { Moon, Sun } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useTheme } from "../../hooks/useTheme";

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const themeSwitchLabel = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <aside
      className={cn(
        "flex h-full flex-col gap-4 border-r bg-bg-panel px-4 py-5",
        "overflow-y-auto",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-xl font-bold tracking-tight text-accent">DIVE</span>
      </div>

      <SidebarSection label="프로젝트">
        <Button
          variant="ghost"
          size="sm"
          disabled
          className="w-full justify-start text-fg-muted"
          aria-label="새 프로젝트 (준비 중)"
        >
          + 새 프로젝트
        </Button>
        <EmptyLine text="프로젝트가 없습니다" />
      </SidebarSection>

      <SidebarSection label="세션">
        <Button
          variant="ghost"
          size="sm"
          disabled
          className="w-full justify-start text-fg-muted"
          aria-label="새 세션 (준비 중)"
        >
          + 새 세션
        </Button>
        <EmptyLine text="세션이 없습니다" />
      </SidebarSection>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <button
          type="button"
          disabled
          aria-label="프로바이더·모델 변경 (준비 중)"
          className="block w-full cursor-not-allowed text-left opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-lg"
        >
          <Card className="px-3 py-2.5">
            <div className="text-xs text-fg-muted">현재 모델</div>
            <div className="text-sm font-medium text-fg">Anthropic · claude-sonnet-4.5</div>
          </Card>
        </button>

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleTheme}
          aria-label={themeSwitchLabel}
          className="w-full justify-start"
        >
          {theme === "dark" ? <Sun /> : <Moon />}
          {themeSwitchLabel}
        </Button>
      </div>
    </aside>
  );
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="px-3 py-1.5 text-xs text-fg-subtle">{text}</div>;
}

export default Sidebar;
