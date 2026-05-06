import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

interface ProviderSetupBannerProps {
  show: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onOpenSettings: () => void;
  inline?: boolean;
}

export function ProviderSetupBanner({
  show,
  title,
  description,
  actionLabel,
  onOpenSettings,
  inline = false,
}: ProviderSetupBannerProps) {
  if (!show) return null;

  return (
    <div
      role="alert"
      data-testid="provider-required-banner"
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-warn/50 bg-bg-panel px-4 py-2 text-sm shadow-sm",
        inline
          ? "w-full"
          : "pointer-events-none absolute left-[296px] right-4 top-4 z-30 py-3 shadow-lg",
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold text-fg">{title}</div>
        <div className="truncate text-xs text-fg-muted">{description}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onOpenSettings}
        data-testid="provider-banner-cta"
        className={cn("shrink-0", inline ? "" : "pointer-events-auto")}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
