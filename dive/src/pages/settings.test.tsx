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
      provocationScaffoldMode: "guided",
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
    const workMode = screen.getByTestId("settings-review-card-mode-work");

    expect(tutorialToggle.checked).toBe(true);
    expect(reviewToggle.checked).toBe(true);
    expect(screen.getByTestId("settings-review-card-mode-guided").dataset.selected).toBe("true");

    fireEvent.click(reviewToggle);
    expect(useUiPreferencesStore.getState().enableProvocationCards).toBe(false);
    expect(useUiPreferencesStore.getState().tutorialEnabled).toBe(true);

    fireEvent.click(workMode);
    expect(useUiPreferencesStore.getState().provocationScaffoldMode).toBe("work");
    expect(useUiPreferencesStore.getState().tutorialEnabled).toBe(true);
  });

  it("renders exactly the canonical Work and Guided review-card mode options", () => {
    render(<SettingsPage />);

    const group = screen.getByTestId("settings-review-card-mode");
    const options = within(group).getAllByRole("radio");

    expect(options).toHaveLength(2);
    expect(screen.getByTestId("settings-review-card-mode-guided")).toBeTruthy();
    expect(screen.getByTestId("settings-review-card-mode-work")).toBeTruthy();
    expect(screen.queryByTestId("settings-review-card-mode-standard")).toBeNull();
    expect(screen.queryByTestId("settings-review-card-mode-expert")).toBeNull();
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

  it("does not offer unsupported opencode zen setup as a connectable GA provider", () => {
    render(<SettingsPage />);

    const opencodeCard = screen
      .getAllByTestId("provider-card")
      .find((card) => card.dataset.providerKind === "opencode_zen");
    expect(opencodeCard).toBeTruthy();
    const card = within(opencodeCard as HTMLElement);
    const connectButton = card.getByTestId("provider-connect-btn") as HTMLButtonElement;

    expect(connectButton.disabled).toBe(true);
    expect(connectButton.textContent).toContain("준비 중");
    expect(card.getByTestId("provider-warning").textContent).toContain(
      "확인된 Pi 런타임 지원이 없습니다",
    );

    fireEvent.click(connectButton);
    expect(screen.queryByTestId("provider-key-input")).toBeNull();
  });

  it("clears the API key input when switching between provider connect forms (P2 settings-api-key-carries-across-providers)", () => {
    render(<SettingsPage />);

    const anthropicCard = screen
      .getAllByTestId("provider-card")
      .find((card) => card.dataset.providerKind === "anthropic") as HTMLElement;
    const openaiCard = screen
      .getAllByTestId("provider-card")
      .find((card) => card.dataset.providerKind === "openai") as HTMLElement;

    fireEvent.click(within(anthropicCard).getByTestId("provider-connect-btn"));
    fireEvent.change(within(anthropicCard).getByTestId("provider-key-input"), {
      target: { value: "sk-secret-for-anthropic" },
    });
    expect(
      (within(anthropicCard).getByTestId("provider-key-input") as HTMLInputElement).value,
    ).toBe("sk-secret-for-anthropic");

    // Switching the expanded card to openai must not carry the anthropic-typed
    // key along (it would otherwise be submittable, masked, to the wrong provider).
    fireEvent.click(within(openaiCard).getByTestId("provider-connect-btn"));

    const openaiInput = within(openaiCard).getByTestId("provider-key-input") as HTMLInputElement;
    expect(openaiInput.value).toBe("");
  });

  it("shows a role=alert connect error when connecting a provider fails", async () => {
    useProjectSessionStore.setState({
      connectProvider: vi.fn().mockRejectedValue(new Error("401 Unauthorized invalid x-api-key")),
    });

    render(<SettingsPage />);

    const anthropicCard = screen
      .getAllByTestId("provider-card")
      .find((card) => card.dataset.providerKind === "anthropic") as HTMLElement;
    const card = within(anthropicCard);

    fireEvent.click(card.getByTestId("provider-connect-btn"));
    fireEvent.change(card.getByTestId("provider-key-input"), { target: { value: "sk-bad" } });
    fireEvent.click(card.getByTestId("provider-submit"));

    const errorBox = await screen.findByTestId("provider-connect-error");
    expect(errorBox.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("provider-connect-error-hints")).toBeTruthy();
    // The form stays populated (not silently reset) so retrying doesn't require retyping.
    expect((card.getByTestId("provider-key-input") as HTMLInputElement).value).toBe("sk-bad");
  });
});
