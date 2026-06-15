// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useUiPreferencesStore } from "./ui-preferences";

function seedPersistedMode(mode: string) {
  window.localStorage.setItem(
    "dive:ui-preferences",
    JSON.stringify({
      state: {
        tutorialEnabled: false,
        enableProvocationCards: false,
        provocationScaffoldMode: mode,
      },
      version: 0,
    }),
  );
}

describe("ui preferences persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "guided",
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
});
