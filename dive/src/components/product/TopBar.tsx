import { Undo2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { useT } from "../../i18n";
import { ProviderSetupBanner } from "./ProviderSetupBanner";
import type { ProductShellController } from "./useProductShellController";

interface TopBarProps {
  projectName: string | null;
  providerBanner: ProductShellController["providerBanner"];
  recoveryCount: number;
  hasFailedStep: boolean;
  onOpenRecovery: () => void;
}

export function TopBar({
  projectName,
  providerBanner,
  recoveryCount,
  hasFailedStep,
  onOpenRecovery,
}: TopBarProps) {
  const t = useT();
  const displayedCount = recoveryCount + (hasFailedStep ? 1 : 0);
  return (
    <header
      className="row-start-1 col-span-full shrink-0 flex items-center gap-3 border-b bg-bg-panel px-4 py-2"
      data-testid="product-topbar"
    >
      <div
        className="min-w-0 truncate text-sm font-semibold text-fg"
        data-testid="topbar-project-name"
      >
        {projectName?.trim() || t("topbar.project_fallback")}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <ProviderSetupBanner inline {...providerBanner} />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenRecovery}
        aria-label={t("topbar.recovery_trigger_aria")}
        data-testid="topbar-recovery-trigger"
        className="shrink-0"
      >
        <Undo2 />
        {t("topbar.recovery_trigger_label")}
        {displayedCount > 0 && (
          <Badge variant={hasFailedStep ? "danger" : "default"} className="ml-1">
            {t("topbar.recovery_trigger_count", { count: displayedCount })}
          </Badge>
        )}
      </Button>
    </header>
  );
}
