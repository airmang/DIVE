// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useUiPreferencesStore } from "./ui-preferences";

const STORAGE_KEY = "dive:ui-preferences";

function seedPersistedPreferences(state: Record<string, unknown>, version = 1) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      state,
      version,
    }),
  );
}

function seedPersistedMode(mode: string) {
  seedPersistedPreferences(
    {
      tutorialEnabled: false,
      enableProvocationCards: false,
      provocationScaffoldMode: mode,
      quickIntakeEnabled: true,
    },
    0,
  );
}

describe("ui preferences persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "guided",
      quickIntakeEnabled: false,
      previewOnboardingDismissed: false,
      permissionCardPrimerDismissed: false,
      webPermissionCardPrimerDismissed: false,
      previewModeByProject: {},
    });
  });

  it.each(["standard", "expert"])(
    "migrates persisted %s review-card mode to canonical work on hydration",
    async (legacyMode) => {
      seedPersistedMode(legacyMode);

      await useUiPreferencesStore.persist.rehydrate();

      expect(useUiPreferencesStore.getState().provocationScaffoldMode).toBe("work");
    },
  );

  it("keeps the default review-card mode guided", () => {
    expect(useUiPreferencesStore.getState().provocationScaffoldMode).toBe("guided");
  });

  it("keeps quick intake disabled by default and preserves an explicit classroom flag", async () => {
    expect(useUiPreferencesStore.getState().quickIntakeEnabled).toBe(false);

    seedPersistedMode("guided");
    await useUiPreferencesStore.persist.rehydrate();

    expect(useUiPreferencesStore.getState().quickIntakeEnabled).toBe(true);
  });

  it("persists preview onboarding dismissal through rehydrate", async () => {
    useUiPreferencesStore.getState().dismissPreviewOnboarding();
    const persisted = window.localStorage.getItem(STORAGE_KEY);

    useUiPreferencesStore.setState({ previewOnboardingDismissed: false });
    if (persisted) window.localStorage.setItem(STORAGE_KEY, persisted);
    await useUiPreferencesStore.persist.rehydrate();

    expect(useUiPreferencesStore.getState().previewOnboardingDismissed).toBe(true);
  });

  it("persists the one-time permission-card primer dismissal through rehydrate", async () => {
    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(false);

    useUiPreferencesStore.getState().dismissPermissionCardPrimer();
    const persisted = window.localStorage.getItem(STORAGE_KEY);

    useUiPreferencesStore.setState({ permissionCardPrimerDismissed: false });
    if (persisted) window.localStorage.setItem(STORAGE_KEY, persisted);
    await useUiPreferencesStore.persist.rehydrate();

    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(true);
  });

  it("persists the one-time web permission-card primer dismissal independently", async () => {
    expect(useUiPreferencesStore.getState().webPermissionCardPrimerDismissed).toBe(false);

    useUiPreferencesStore.getState().dismissWebPermissionCardPrimer();
    const persisted = window.localStorage.getItem(STORAGE_KEY);

    useUiPreferencesStore.setState({
      permissionCardPrimerDismissed: false,
      webPermissionCardPrimerDismissed: false,
    });
    if (persisted) window.localStorage.setItem(STORAGE_KEY, persisted);
    await useUiPreferencesStore.persist.rehydrate();

    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(false);
    expect(useUiPreferencesStore.getState().webPermissionCardPrimerDismissed).toBe(true);
  });

  it("round-trips project preview mode memory and keeps projects independent", async () => {
    useUiPreferencesStore.getState().setProjectPreviewMode(7, {
      kind: "local_url",
      lastUrl: "http://127.0.0.1:5173/",
    });
    useUiPreferencesStore.getState().setProjectPreviewMode(9, {
      kind: "static_file",
      lastUrl: "index.html",
    });
    const persisted = window.localStorage.getItem(STORAGE_KEY);

    useUiPreferencesStore.setState({ previewModeByProject: {} });
    if (persisted) window.localStorage.setItem(STORAGE_KEY, persisted);
    await useUiPreferencesStore.persist.rehydrate();

    expect(useUiPreferencesStore.getState().previewModeByProject[7]).toEqual({
      kind: "local_url",
      lastUrl: "http://127.0.0.1:5173/",
    });
    expect(useUiPreferencesStore.getState().previewModeByProject[9]).toEqual({
      kind: "static_file",
      lastUrl: "index.html",
    });
  });

  it("migrates a version 1 payload with preview defaults and preserves existing fields", async () => {
    seedPersistedPreferences({
      tutorialEnabled: false,
      enableProvocationCards: false,
      provocationScaffoldMode: "standard",
      quickIntakeEnabled: true,
    });

    await useUiPreferencesStore.persist.rehydrate();

    expect(useUiPreferencesStore.getState().tutorialEnabled).toBe(false);
    expect(useUiPreferencesStore.getState().enableProvocationCards).toBe(false);
    expect(useUiPreferencesStore.getState().provocationScaffoldMode).toBe("work");
    expect(useUiPreferencesStore.getState().quickIntakeEnabled).toBe(true);
    expect(useUiPreferencesStore.getState().previewOnboardingDismissed).toBe(false);
    expect(useUiPreferencesStore.getState().webPermissionCardPrimerDismissed).toBe(false);
    expect(useUiPreferencesStore.getState().previewModeByProject).toEqual({});
  });

  it("drops malformed preview mode memory entries without throwing", async () => {
    seedPersistedPreferences({
      previewModeByProject: {
        7: { kind: "dev_server", lastUrl: "http://127.0.0.1:5173/" },
        8: { kind: "unsupported", lastUrl: "http://127.0.0.1:5174/" },
        9: "not-an-entry",
        project: { kind: "static_file", lastUrl: "index.html" },
      },
    });

    await expect(useUiPreferencesStore.persist.rehydrate()).resolves.toBeUndefined();

    expect(useUiPreferencesStore.getState().previewModeByProject).toEqual({
      7: { kind: "dev_server", lastUrl: "http://127.0.0.1:5173/" },
    });
  });
});
