import { X } from "lucide-react";
import { useT } from "../../i18n";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";

export function PreviewOnboardingCoachmark() {
  const t = useT();
  const tutorialEnabled = useUiPreferencesStore((state) => state.tutorialEnabled);
  const previewOnboardingDismissed = useUiPreferencesStore(
    (state) => state.previewOnboardingDismissed,
  );
  const dismissPreviewOnboarding = useUiPreferencesStore((state) => state.dismissPreviewOnboarding);

  if (!tutorialEnabled || previewOnboardingDismissed) return null;

  return (
    <div data-testid="preview-onboarding-coachmark">
      <LearningHint className="mb-4 rounded-md border border-border bg-bg px-3 py-2 text-left">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg">
              {t("slide_in.preview.onboarding.title")}
            </p>
            <p className="mt-1">{t("slide_in.preview.onboarding.static")}</p>
            <p className="mt-1">{t("slide_in.preview.onboarding.server")}</p>
            <p className="mt-2 font-medium text-fg">
              {t("slide_in.preview.onboarding.human_confirm")}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-fg-muted"
            onClick={dismissPreviewOnboarding}
            aria-label={t("slide_in.preview.onboarding.dismiss")}
            data-testid="preview-onboarding-dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </LearningHint>
    </div>
  );
}
