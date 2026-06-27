// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { PreviewOnboardingCoachmark } from "./PreviewOnboardingCoachmark";

describe("PreviewOnboardingCoachmark", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      previewOnboardingDismissed: false,
      previewModeByProject: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders when tutorials are enabled and preview onboarding is not dismissed", () => {
    render(<PreviewOnboardingCoachmark />);

    expect(screen.getByTestId("preview-onboarding-coachmark")).toBeTruthy();
    expect(screen.getByText("Preview helps you inspect the result.")).toBeTruthy();
    expect(
      screen.getByText("DIVE shows the result; the human confirms it works, not the AI."),
    ).toBeTruthy();
  });

  it("dismisses through persisted store state and stays hidden after re-render", () => {
    const { rerender } = render(<PreviewOnboardingCoachmark />);

    fireEvent.click(screen.getByTestId("preview-onboarding-dismiss"));

    expect(useUiPreferencesStore.getState().previewOnboardingDismissed).toBe(true);
    expect(screen.queryByTestId("preview-onboarding-coachmark")).toBeNull();

    rerender(<PreviewOnboardingCoachmark />);

    expect(screen.queryByTestId("preview-onboarding-coachmark")).toBeNull();
  });

  it.each([false, true])(
    "stays hidden when tutorials are disabled, dismissed=%s",
    (previewOnboardingDismissed) => {
      useUiPreferencesStore.setState({
        tutorialEnabled: false,
        previewOnboardingDismissed,
      });

      render(<PreviewOnboardingCoachmark />);

      expect(screen.queryByTestId("preview-onboarding-coachmark")).toBeNull();
      expect(screen.queryByTestId("preview-onboarding-dismiss")).toBeNull();
    },
  );
});
