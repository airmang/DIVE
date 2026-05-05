import { Button } from "../ui/button";

interface ProviderSetupBannerProps {
  show: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onOpenSettings: () => void;
}

export function ProviderSetupBanner({
  show,
  title,
  description,
  actionLabel,
  onOpenSettings,
}: ProviderSetupBannerProps) {
  if (!show) return null;

  return (
    <div
      role="alert"
      data-testid="provider-required-banner"
      className="pointer-events-none absolute left-[296px] right-4 top-4 z-30 flex items-center justify-between gap-3 rounded-lg border border-warn/50 bg-bg-panel px-4 py-3 text-sm shadow-lg"
    >
      <div>
        <div className="font-semibold text-fg">{title}</div>
        <div className="text-xs text-fg-muted">{description}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onOpenSettings}
        data-testid="provider-banner-cta"
        className="pointer-events-auto"
      >
        {actionLabel}
      </Button>
    </div>
  );
}
