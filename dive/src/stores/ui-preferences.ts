import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScaffoldMode } from "../features/provocation";

export type PreviewModeMemoryKind = "static_file" | "local_url" | "dev_server";

export interface ProjectPreviewModeMemory {
  kind: PreviewModeMemoryKind;
  lastUrl?: string;
}

type PersistedUiPreferences = Partial<{
  tutorialEnabled: boolean;
  enableProvocationCards: boolean;
  provocationScaffoldMode: ScaffoldMode;
  quickIntakeEnabled: boolean;
  previewOnboardingDismissed: boolean;
  previewModeByProject: Record<number, ProjectPreviewModeMemory>;
}>;

interface UiPreferencesStore {
  tutorialEnabled: boolean;
  enableProvocationCards: boolean;
  provocationScaffoldMode: ScaffoldMode;
  quickIntakeEnabled: boolean;
  previewOnboardingDismissed: boolean;
  previewModeByProject: Record<number, ProjectPreviewModeMemory>;
  setTutorialEnabled: (enabled: boolean) => void;
  setEnableProvocationCards: (enabled: boolean) => void;
  setProvocationScaffoldMode: (mode: ScaffoldMode) => void;
  setQuickIntakeEnabled: (enabled: boolean) => void;
  dismissPreviewOnboarding: () => void;
  setProjectPreviewMode: (projectId: number, entry: ProjectPreviewModeMemory) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeProvocationScaffoldMode(mode: unknown): ScaffoldMode {
  if (mode === "guided" || mode === "work") return mode;
  if (mode === "standard" || mode === "expert") return "work";
  return "guided";
}

function isPreviewModeMemoryKind(value: unknown): value is PreviewModeMemoryKind {
  return value === "static_file" || value === "local_url" || value === "dev_server";
}

function normalizePreviewModeMemoryEntry(value: unknown): ProjectPreviewModeMemory | null {
  if (!isObject(value) || !isPreviewModeMemoryKind(value.kind)) return null;
  const lastUrl =
    typeof value.lastUrl === "string" && value.lastUrl.trim().length > 0
      ? value.lastUrl
      : undefined;
  return lastUrl === undefined ? { kind: value.kind } : { kind: value.kind, lastUrl };
}

function normalizePreviewModeByProject(value: unknown): Record<number, ProjectPreviewModeMemory> {
  if (!isObject(value)) return {};
  const normalized: Record<number, ProjectPreviewModeMemory> = {};
  for (const [projectIdKey, entry] of Object.entries(value)) {
    const projectId = Number(projectIdKey);
    if (!Number.isInteger(projectId)) continue;
    const normalizedEntry = normalizePreviewModeMemoryEntry(entry);
    if (normalizedEntry) normalized[projectId] = normalizedEntry;
  }
  return normalized;
}

function normalizePersistedPreferences(value: unknown): PersistedUiPreferences {
  if (!isObject(value)) return {};
  return {
    ...value,
    provocationScaffoldMode: normalizeProvocationScaffoldMode(value.provocationScaffoldMode),
    quickIntakeEnabled: value.quickIntakeEnabled === true,
    previewOnboardingDismissed: value.previewOnboardingDismissed === true,
    previewModeByProject: normalizePreviewModeByProject(value.previewModeByProject),
  };
}

export const useUiPreferencesStore = create<UiPreferencesStore>()(
  persist(
    (set) => ({
      tutorialEnabled: true,
      enableProvocationCards: true,
      provocationScaffoldMode: "guided",
      quickIntakeEnabled: false,
      previewOnboardingDismissed: false,
      previewModeByProject: {},
      setTutorialEnabled: (tutorialEnabled) => set({ tutorialEnabled }),
      setEnableProvocationCards: (enableProvocationCards) => set({ enableProvocationCards }),
      setProvocationScaffoldMode: (provocationScaffoldMode) => set({ provocationScaffoldMode }),
      setQuickIntakeEnabled: (quickIntakeEnabled) => set({ quickIntakeEnabled }),
      dismissPreviewOnboarding: () => set({ previewOnboardingDismissed: true }),
      setProjectPreviewMode: (projectId, entry) => {
        if (!Number.isInteger(projectId)) return;
        const normalizedEntry = normalizePreviewModeMemoryEntry(entry);
        if (!normalizedEntry) return;
        set((state) => ({
          previewModeByProject: {
            ...state.previewModeByProject,
            [projectId]: normalizedEntry,
          },
        }));
      },
    }),
    {
      name: "dive:ui-preferences",
      version: 2,
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

export function usePreviewOnboardingDismissed(): boolean {
  return useUiPreferencesStore((state) => state.previewOnboardingDismissed);
}
