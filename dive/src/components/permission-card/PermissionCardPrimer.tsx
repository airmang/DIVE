import { X } from "lucide-react";
import { useT } from "../../i18n";
import {
  usePermissionCardPrimerDismissed,
  useUiPreferencesStore,
} from "../../stores/ui-preferences";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";

/**
 * One-time, dismissible primer shown above a permission card the first time the
 * student meets the Safe/Warn/Danger model (audit P1-19). It is guided-help
 * scaffolding — gated on `tutorialEnabled` (via LearningHint + explicit check)
 * and a persisted one-time `permissionCardPrimerDismissed` flag — NOT a lesson
 * track, quiz, or deck. Mirrors the shipped PreviewOnboardingCoachmark pattern.
 */
export function PermissionCardPrimer() {
  const t = useT();
  const tutorialEnabled = useUiPreferencesStore((state) => state.tutorialEnabled);
  const dismissed = usePermissionCardPrimerDismissed();
  const dismissPrimer = useUiPreferencesStore((state) => state.dismissPermissionCardPrimer);

  if (!tutorialEnabled || dismissed) return null;

  return (
    <div data-testid="permission-card-primer">
      <LearningHint className="mb-2 rounded-md border border-border bg-bg px-3 py-2 text-left">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg">{t("permission_card.primer.title")}</p>
            <p className="mt-1">{t("permission_card.primer.intro")}</p>
            <ul className="mt-1.5 space-y-1">
              <li className="flex items-start gap-1.5">
                <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-success" />
                <span>{t("permission_card.primer.safe")}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn" />
                <span>{t("permission_card.primer.warn")}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-danger" />
                <span>{t("permission_card.primer.danger")}</span>
              </li>
            </ul>
            <p className="mt-1.5 font-medium text-fg">{t("permission_card.primer.blocked")}</p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-fg-muted"
            onClick={dismissPrimer}
            aria-label={t("permission_card.primer.dismiss_aria")}
            data-testid="permission-card-primer-dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </LearningHint>
    </div>
  );
}

export default PermissionCardPrimer;
