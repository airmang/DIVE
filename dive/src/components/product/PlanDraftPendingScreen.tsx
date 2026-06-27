import { LoaderCircle } from "lucide-react";
import { useT } from "../../i18n";

export function PlanDraftPendingScreen() {
  const t = useT();

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center bg-bg px-6 py-8"
      data-testid="plan-draft-pending"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-2xl rounded-lg border border-accent/35 bg-bg-panel2 p-5">
        <div className="flex items-start gap-3">
          <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-fg">
              {t("planning.interview.pending.title")}
            </p>
            <p className="mt-1 text-sm leading-6 text-fg-muted">
              {t("planning.interview.pending.description")}
            </p>
            <div className="mt-5 space-y-2" aria-hidden>
              <div className="h-3 w-3/4 animate-pulse rounded bg-border" />
              <div className="h-3 w-full animate-pulse rounded bg-border" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-border" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlanDraftPendingScreen;
