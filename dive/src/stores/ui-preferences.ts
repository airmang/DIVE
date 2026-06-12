import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScaffoldMode } from "../features/provocation";

interface UiPreferencesStore {
  tutorialEnabled: boolean;
  enableProvocationCards: boolean;
  provocationScaffoldMode: ScaffoldMode;
  setTutorialEnabled: (enabled: boolean) => void;
  setEnableProvocationCards: (enabled: boolean) => void;
  setProvocationScaffoldMode: (mode: ScaffoldMode) => void;
}

export const useUiPreferencesStore = create<UiPreferencesStore>()(
  persist(
    (set) => ({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "guided",
      setTutorialEnabled: (tutorialEnabled) => set({ tutorialEnabled }),
      setEnableProvocationCards: (enableProvocationCards) => set({ enableProvocationCards }),
      setProvocationScaffoldMode: (provocationScaffoldMode) => set({ provocationScaffoldMode }),
    }),
    { name: "dive:ui-preferences" },
  ),
);

export function useTutorialEnabled(): boolean {
  return useUiPreferencesStore((state) => state.tutorialEnabled);
}

export function useProvocationCardsEnabled(): boolean {
  return useUiPreferencesStore((state) => state.enableProvocationCards);
}

export function useProvocationScaffoldMode(): ScaffoldMode {
  return useUiPreferencesStore((state) => state.provocationScaffoldMode);
}
