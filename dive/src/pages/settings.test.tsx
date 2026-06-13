// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { SettingsPage } from "./settings";

describe("SettingsPage review-card preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "standard",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps review-card controls separate from guided help", () => {
    render(<SettingsPage />);

    const tutorialToggle = screen.getByTestId("settings-tutorial-toggle") as HTMLInputElement;
    const reviewToggle = screen.getByTestId("settings-review-cards-toggle") as HTMLInputElement;
    const expertMode = screen.getByTestId("settings-review-card-mode-expert");

    expect(tutorialToggle.checked).toBe(true);
    expect(reviewToggle.checked).toBe(true);
    expect(screen.getByTestId("settings-review-card-mode-standard").dataset.selected).toBe("true");

    fireEvent.click(reviewToggle);
    expect(useUiPreferencesStore.getState().enableProvocationCards).toBe(false);
    expect(useUiPreferencesStore.getState().tutorialEnabled).toBe(true);

    fireEvent.click(expertMode);
    expect(useUiPreferencesStore.getState().provocationScaffoldMode).toBe("expert");
    expect(useUiPreferencesStore.getState().tutorialEnabled).toBe(true);
  });
});
