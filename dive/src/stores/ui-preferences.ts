import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScaffoldMode } from "../features/provocation";

type PersistedUiPreferences = Partial<{
  tutorialEnabled: boolean;
  enableProvocationCards: boolean;
  provocationScaffoldMode: ScaffoldMode;
  quickIntakeEnabled: boolean;
}>;

interface UiPreferencesStore {
  tutorialEnabled: boolean;
  enableProvocationCards: boolean;
  provocationScaffoldMode: ScaffoldMode;
  quickIntakeEnabled: boolean;
  setTutorialEnabled: (enabled: boolean) => void;
  setEnableProvocationCards: (enabled: boolean) => void;
  setProvocationScaffoldMode: (mode: ScaffoldMode) => void;
  setQuickIntakeEnabled: (enabled: boolean) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeProvocationScaffoldMode(mode: unknown): ScaffoldMode {
  if (mode === "guided" || mode === "work") return mode;
  if (mode === "standard" || mode === "expert") return "work";
  return "guided";
}

function normalizePersistedPreferences(value: unknown): PersistedUiPreferences {
  if (!isObject(value)) return {};
  return {
    ...value,
    provocationScaffoldMode: normalizeProvocationScaffoldMode(value.provocationScaffoldMode),
    quickIntakeEnabled: value.quickIntakeEnabled === true,
  };
}

export const useUiPreferencesStore = create<UiPreferencesStore>()(
  persist(
    (set) => ({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "guided",
      quickIntakeEnabled: false,
      setTutorialEnabled: (tutorialEnabled) => set({ tutorialEnabled }),
      setEnableProvocationCards: (enableProvocationCards) => set({ enableProvocationCards }),
      setProvocationScaffoldMode: (provocationScaffoldMode) => set({ provocationScaffoldMode }),
      setQuickIntakeEnabled: (quickIntakeEnabled) => set({ quickIntakeEnabled }),
    }),
    {
      name: "dive:ui-preferences",
      version: 1,
      migrate: (persistedState) => normalizePersistedPreferences(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizePersistedPreferences(persistedState),
      }),
    },
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

export function useQuickIntakeEnabled(): boolean {
  return useUiPreferencesStore((state) => state.quickIntakeEnabled);
}
