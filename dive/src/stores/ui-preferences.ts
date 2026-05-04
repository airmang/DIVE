import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiPreferencesStore {
  tutorialEnabled: boolean;
  setTutorialEnabled: (enabled: boolean) => void;
}

export const useUiPreferencesStore = create<UiPreferencesStore>()(
  persist(
    (set) => ({
      tutorialEnabled: false,
      setTutorialEnabled: (tutorialEnabled) => set({ tutorialEnabled }),
    }),
    { name: "dive:ui-preferences" },
  ),
);

export function useTutorialEnabled(): boolean {
  return useUiPreferencesStore((state) => state.tutorialEnabled);
}
