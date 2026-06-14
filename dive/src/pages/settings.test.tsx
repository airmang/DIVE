// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import { useProjectSessionStore } from "../stores/project-session";
import { useUiPreferencesStore } from "../stores/ui-preferences";
import { SettingsPage } from "./settings";

describe("SettingsPage review-card preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({
      loaded: true,
      providers: [],
      projects: [],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      error: null,
    });
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "standard",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("localizes provider status, host warning, and disconnect confirmation", () => {
    useLocaleStore.setState({ locale: "en" });
    useProjectSessionStore.setState({
      loaded: true,
      providers: [
        {
          id: 42,
          kind: "openrouter",
          auth_type: "api_key",
          base_url: "https://proxy.example.com/v1",
          is_connected: true,
          selected_model: "openai/gpt-5.4-mini",
        },
      ],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<SettingsPage />);

    const openrouterCard = screen
      .getAllByTestId("provider-card")
      .find((card) => card.dataset.providerKind === "openrouter");
    expect(openrouterCard).toBeTruthy();
    const card = within(openrouterCard as HTMLElement);

    expect(card.getByLabelText("AI connection active")).toBeTruthy();
    expect(
      card.getByText(
        "Connected to a non-default AI endpoint. The API key will be sent to that server.",
      ),
    ).toBeTruthy();

    fireEvent.click(card.getByTestId("provider-disconnect"));
    expect(confirmSpy).toHaveBeenCalledWith("Disconnect openrouter?");
  });
});
