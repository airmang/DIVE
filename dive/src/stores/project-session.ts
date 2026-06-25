import { create } from "zustand";
import { hasRecognizedDemoRoute } from "../lib/dev-demo";
import { refreshMenuRecents } from "../lib/menu-events";
import { translate, useLocaleStore } from "../i18n";

export interface ProjectRow {
  id: number;
  name: string;
  path: string;
  provider_default: string | null;
  model_default: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: number;
  project_id: number;
  title: string;
  started_at: number;
  ended_at: number | null;
  status: string;
}

export interface ProviderSummary {
  id: number;
  kind: string;
  auth_type: string;
  base_url: string | null;
  is_connected: boolean;
  is_active?: boolean;
  selected_model?: string | null;
  account_id?: string | null;
}

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

const STORAGE_KEY = "dive:project-session";
const ONBOARDED_KEY = "dive:onboarded";
const CURRENT_PROJECT_KEY = "dive:current-project-id";
const CURRENT_SESSION_KEY = "dive:current-session-id";

let projectSessionDemoFallbackEnabled = false;

export function setProjectSessionDemoFallback(enabled: boolean) {
  projectSessionDemoFallbackEnabled = enabled;
}

export function isProjectSessionDemoFallbackEnabled() {
  return projectSessionDemoFallbackEnabled;
}

function canUseDemoFallback() {
  return projectSessionDemoFallbackEnabled || (import.meta.env.DEV && hasRecognizedDemoRoute());
}

function ipcUnavailableError() {
  return new Error("Tauri IPC unavailable outside explicit demo mode");
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function setOnboardedFlag(v: boolean) {
  if (typeof window === "undefined") return;
  if (v) window.localStorage.setItem(ONBOARDED_KEY, "true");
  else window.localStorage.removeItem(ONBOARDED_KEY);
}

function clearStoredCurrentSelection() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CURRENT_PROJECT_KEY);
  window.localStorage.removeItem(CURRENT_SESSION_KEY);
}

function hasConnectedProvider(providers: ProviderSummary[]) {
  return providers.some((p) => p.is_connected);
}

interface MockStore {
  projects: ProjectRow[];
  sessions: SessionRow[];
  providers: ProviderSummary[];
  nextId: number;
}

function loadMock(): MockStore {
  if (typeof window === "undefined")
    return { projects: [], sessions: [], providers: [], nextId: 1 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: [], sessions: [], providers: [], nextId: 1 };
    return JSON.parse(raw) as MockStore;
  } catch {
    return { projects: [], sessions: [], providers: [], nextId: 1 };
  }
}

function saveMock(store: MockStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function nowMs() {
  return Date.now();
}

function defaultSessionTitle() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return translate(useLocaleStore.getState().locale, "chat.session_default_title", { date });
}

function preferredSessionId(sessions: SessionRow[], storedSessionId: number): number | null {
  const stored = sessions.find((session) => session.id === storedSessionId);
  if (stored && stored.status !== "archived") return stored.id;
  const active = sessions.find((session) => session.status !== "archived");
  return active?.id ?? null;
}

interface State {
  isTauri: boolean;
  loaded: boolean;
  projects: ProjectRow[];
  sessions: SessionRow[];
  providers: ProviderSummary[];
  currentProjectId: number | null;
  currentSessionId: number | null;
  error: string | null;
  loadAll: () => Promise<void>;
  createProject: (name: string, path: string) => Promise<ProjectRow | null>;
  openProject: (path: string) => Promise<ProjectRow | null>;
  deleteProject: (projectId: number, deleteFolder?: boolean) => Promise<void>;
  selectProject: (projectId: number | null) => Promise<void>;
  createSession: (projectId: number, title?: string) => Promise<SessionRow | null>;
  selectSession: (sessionId: number | null) => void;
  renameSession: (sessionId: number, title: string) => Promise<void>;
  archiveSession: (sessionId: number) => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
  connectProvider: (
    kind: string,
    apiKey: string,
    baseUrl?: string,
  ) => Promise<ProviderSummary | null>;
  selectProvider: (providerId: number) => Promise<ProviderSummary | null>;
  disconnectProvider: (providerId: number) => Promise<void>;
  setOnboarded: (v: boolean) => void;
  isOnboarded: () => boolean;
}

async function withTauriOrDemoMock<T>(
  api: TauriApi | null,
  tauriFn: () => Promise<T>,
  mockFn: () => T,
): Promise<T> {
  if (api) return tauriFn();
  if (canUseDemoFallback()) return mockFn();
  throw ipcUnavailableError();
}

async function runStoreAction<T>(set: (partial: Partial<State>) => void, action: () => Promise<T>) {
  try {
    set({ error: null });
    return await action();
  } catch (err) {
    set({ error: errorMessage(err) });
    throw err;
  }
}

export const useProjectSessionStore = create<State>((set, get) => ({
  isTauri: false,
  loaded: false,
  projects: [],
  sessions: [],
  providers: [],
  currentProjectId: null,
  currentSessionId: null,
  error: null,

  loadAll: async () => {
    const api = await loadTauri();
    const isTauri = api !== null;
    if (isTauri && api) {
      try {
        const [projects, providers] = await Promise.all([
          api.invoke<ProjectRow[]>("project_list"),
          api.invoke<ProviderSummary[]>("provider_list"),
        ]);
        const storedProjectId = Number(window.localStorage.getItem(CURRENT_PROJECT_KEY) ?? "");
        const storedSessionId = Number(window.localStorage.getItem(CURRENT_SESSION_KEY) ?? "");
        const currentProjectId = projects.find((p) => p.id === storedProjectId)
          ? storedProjectId
          : (projects[0]?.id ?? null);
        let orderedProjects = projects;
        let sessions: SessionRow[] = [];
        if (currentProjectId !== null) {
          let selectedProject: ProjectRow;
          try {
            selectedProject = await api.invoke<ProjectRow>("project_select", {
              projectId: currentProjectId,
            });
          } catch (err) {
            clearStoredCurrentSelection();
            if (!hasConnectedProvider(providers)) setOnboardedFlag(false);
            set({
              isTauri: true,
              loaded: true,
              projects,
              providers,
              sessions: [],
              currentProjectId: null,
              currentSessionId: null,
              error: errorMessage(err),
            });
            return;
          }
          orderedProjects = [
            selectedProject,
            ...projects.filter((project) => project.id !== selectedProject.id),
          ];
          sessions = await api.invoke<SessionRow[]>("session_list", {
            projectId: currentProjectId,
          });
        }
        const currentSessionId = preferredSessionId(sessions, storedSessionId);
        if (!hasConnectedProvider(providers)) setOnboardedFlag(false);
        set({
          isTauri: true,
          loaded: true,
          projects: orderedProjects,
          providers,
          sessions,
          currentProjectId,
          currentSessionId,
          error: null,
        });
        return;
      } catch (err) {
        set({ isTauri: true, loaded: true, error: errorMessage(err) });
        throw err;
      }
    }
    if (!canUseDemoFallback()) {
      set({
        isTauri: false,
        loaded: true,
        projects: [],
        sessions: [],
        providers: [],
        currentProjectId: null,
        currentSessionId: null,
        error: ipcUnavailableError().message,
      });
      return;
    }
    const mock = loadMock();
    const storedProjectId =
      typeof window !== "undefined"
        ? Number(window.localStorage.getItem(CURRENT_PROJECT_KEY) ?? "")
        : 0;
    const storedSessionId =
      typeof window !== "undefined"
        ? Number(window.localStorage.getItem(CURRENT_SESSION_KEY) ?? "")
        : 0;
    const currentProjectId = mock.projects.find((p) => p.id === storedProjectId)
      ? storedProjectId
      : (mock.projects[0]?.id ?? null);
    const projectSessions = mock.sessions.filter((s) => s.project_id === currentProjectId);
    const currentSessionId = preferredSessionId(projectSessions, storedSessionId);
    set({
      isTauri: false,
      loaded: true,
      projects: mock.projects,
      sessions: projectSessions,
      providers: mock.providers,
      currentProjectId,
      currentSessionId,
      error: null,
    });
  },

  createProject: async (name, path) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      const row = await withTauriOrDemoMock<ProjectRow | null>(
        api,
        () => api!.invoke<ProjectRow>("project_create", { name, path }),
        () => {
          const mock = loadMock();
          const id = mock.nextId++;
          const now = nowMs();
          const row: ProjectRow = {
            id,
            name,
            path,
            provider_default: null,
            model_default: null,
            created_at: now,
            updated_at: now,
          };
          mock.projects.unshift(row);
          saveMock(mock);
          return row;
        },
      );
      if (!row) return null;
      set((s) => ({
        projects: [row, ...s.projects.filter((p) => p.id !== row.id)],
        currentProjectId: row.id,
        sessions: [],
        currentSessionId: null,
      }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CURRENT_PROJECT_KEY, String(row.id));
        window.localStorage.removeItem(CURRENT_SESSION_KEY);
      }
      await refreshMenuRecents();
      return row;
    }),

  openProject: async (path) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      const row = await withTauriOrDemoMock<ProjectRow | null>(
        api,
        () => api!.invoke<ProjectRow>("project_open", { path }),
        () => {
          const mock = loadMock();
          const now = nowMs();
          const existing = mock.projects.find((project) => project.path === path);
          if (existing) {
            const row = { ...existing, updated_at: now };
            mock.projects = [row, ...mock.projects.filter((project) => project.id !== row.id)];
            saveMock(mock);
            return row;
          }
          const trimmed = path.replace(/[\\/]+$/, "");
          const name = trimmed.split(/[\\/]/).pop() || "project";
          const row: ProjectRow = {
            id: mock.nextId++,
            name,
            path,
            provider_default: null,
            model_default: null,
            created_at: now,
            updated_at: now,
          };
          mock.projects.unshift(row);
          saveMock(mock);
          return row;
        },
      );
      if (!row) return null;
      set((state) => ({
        projects: [row, ...state.projects.filter((project) => project.id !== row.id)],
        currentProjectId: row.id,
        sessions: [],
        currentSessionId: null,
      }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CURRENT_PROJECT_KEY, String(row.id));
        window.localStorage.removeItem(CURRENT_SESSION_KEY);
      }
      await refreshMenuRecents();
      return row;
    }),

  deleteProject: async (projectId, deleteFolder = false) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      await withTauriOrDemoMock<void>(
        api,
        () =>
          api!.invoke<void>("project_delete", {
            projectId,
            deleteFolder,
          }),
        () => {
          const mock = loadMock();
          mock.projects = mock.projects.filter((p) => p.id !== projectId);
          mock.sessions = mock.sessions.filter((s) => s.project_id !== projectId);
          saveMock(mock);
        },
      );
      const wasActiveProject = get().currentProjectId === projectId;
      const projects = get().projects.filter((p) => p.id !== projectId);
      if (!wasActiveProject) {
        set((s) => ({
          projects,
          currentProjectId: s.currentProjectId,
          sessions: s.sessions,
          currentSessionId: s.currentSessionId,
        }));
      } else if (projects.length === 0) {
        clearStoredCurrentSelection();
        set({
          projects: [],
          currentProjectId: null,
          sessions: [],
          currentSessionId: null,
        });
      } else {
        clearStoredCurrentSelection();
        set({
          projects,
          currentProjectId: null,
          sessions: [],
          currentSessionId: null,
        });
        await get().selectProject(projects[0].id);
      }
      await refreshMenuRecents();
    }),

  selectProject: async (projectId) => {
    if (projectId === null) {
      set({ currentProjectId: null, sessions: [], currentSessionId: null });
      clearStoredCurrentSelection();
      return;
    }
    await runStoreAction(set, async () => {
      const api = await loadTauri();
      const selectedProject = await withTauriOrDemoMock<ProjectRow | null>(
        api,
        () => api!.invoke<ProjectRow>("project_select", { projectId }),
        () => {
          const mock = loadMock();
          return mock.projects.find((project) => project.id === projectId) ?? null;
        },
      );
      if (!selectedProject) throw new Error(`project ${projectId} not found`);
      const sessions = await withTauriOrDemoMock<SessionRow[]>(
        api,
        () => api!.invoke<SessionRow[]>("session_list", { projectId }),
        () => {
          const mock = loadMock();
          return mock.sessions
            .filter((s) => s.project_id === projectId)
            .sort((a, b) => {
              const aArch = a.status === "archived" ? 1 : 0;
              const bArch = b.status === "archived" ? 1 : 0;
              return aArch - bArch || b.started_at - a.started_at;
            });
        },
      );
      const storedSessionId =
        typeof window !== "undefined"
          ? Number(window.localStorage.getItem(CURRENT_SESSION_KEY) ?? "")
          : 0;
      const currentSessionId = preferredSessionId(sessions, storedSessionId);
      set((state) => ({
        projects: [
          selectedProject,
          ...state.projects.filter((project) => project.id !== selectedProject.id),
        ],
        currentProjectId: projectId,
        sessions,
        currentSessionId,
      }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CURRENT_PROJECT_KEY, String(projectId));
        if (currentSessionId === null) window.localStorage.removeItem(CURRENT_SESSION_KEY);
        else window.localStorage.setItem(CURRENT_SESSION_KEY, String(currentSessionId));
      }
    });
  },

  createSession: async (projectId, title) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      const row = await withTauriOrDemoMock<SessionRow | null>(
        api,
        () =>
          api!.invoke<SessionRow>("session_create", {
            projectId,
            title: title ?? null,
          }),
        () => {
          const mock = loadMock();
          const id = mock.nextId++;
          const row: SessionRow = {
            id,
            project_id: projectId,
            title: title && title.trim() ? title.trim() : defaultSessionTitle(),
            started_at: nowMs(),
            ended_at: null,
            status: "active",
          };
          mock.sessions.unshift(row);
          saveMock(mock);
          return row;
        },
      );
      if (!row) return null;
      set((s) => ({
        sessions: [row, ...s.sessions],
        currentSessionId: row.id,
      }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CURRENT_SESSION_KEY, String(row.id));
      }
      return row;
    }),

  selectSession: (sessionId) => {
    set({ currentSessionId: sessionId });
    if (typeof window !== "undefined") {
      if (sessionId === null) window.localStorage.removeItem(CURRENT_SESSION_KEY);
      else window.localStorage.setItem(CURRENT_SESSION_KEY, String(sessionId));
    }
  },

  renameSession: async (sessionId, title) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      await withTauriOrDemoMock<void>(
        api,
        async () => {
          await api!.invoke<SessionRow>("session_rename", { sessionId, title });
        },
        () => {
          const mock = loadMock();
          mock.sessions = mock.sessions.map((s) => (s.id === sessionId ? { ...s, title } : s));
          saveMock(mock);
        },
      );
      set((s) => ({
        sessions: s.sessions.map((ss) => (ss.id === sessionId ? { ...ss, title } : ss)),
      }));
    }),

  archiveSession: async (sessionId) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      await withTauriOrDemoMock<void>(
        api,
        () => api!.invoke<void>("session_archive", { sessionId }),
        () => {
          const mock = loadMock();
          mock.sessions = mock.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: "archived", ended_at: nowMs() } : s,
          );
          saveMock(mock);
        },
      );
      set((s) => ({
        sessions: s.sessions.map((ss) =>
          ss.id === sessionId ? { ...ss, status: "archived", ended_at: nowMs() } : ss,
        ),
        currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
      }));
    }),

  deleteSession: async (sessionId) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      await withTauriOrDemoMock<void>(
        api,
        () => api!.invoke<void>("session_delete", { sessionId }),
        () => {
          const mock = loadMock();
          mock.sessions = mock.sessions.filter((s) => s.id !== sessionId);
          saveMock(mock);
        },
      );
      set((s) => ({
        sessions: s.sessions.filter((ss) => ss.id !== sessionId),
        currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
      }));
    }),

  connectProvider: async (kind, apiKey, baseUrl) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      const row = await withTauriOrDemoMock<ProviderSummary | null>(
        api,
        () =>
          api!.invoke<ProviderSummary>("provider_connect", {
            kind,
            apiKey,
            baseUrl: baseUrl ?? null,
          }),
        () => {
          const mock = loadMock();
          const id = mock.nextId++;
          const row: ProviderSummary = {
            id,
            kind,
            auth_type: "api_key",
            base_url: baseUrl ?? null,
            is_connected: true,
            is_active: true,
            selected_model: null,
          };
          mock.providers = [
            ...mock.providers.map((provider) => ({ ...provider, is_active: false })),
            row,
          ];
          saveMock(mock);
          return row;
        },
      );
      if (!row) return null;
      set((s) => ({
        providers: [...s.providers.map((provider) => ({ ...provider, is_active: false })), row],
      }));
      if (row.is_connected) setOnboardedFlag(true);
      return row;
    }),

  selectProvider: async (providerId) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      const row = await withTauriOrDemoMock<ProviderSummary | null>(
        api,
        () =>
          api!.invoke<ProviderSummary>("provider_select", {
            providerConfigId: providerId,
          }),
        () => {
          const mock = loadMock();
          const selected = mock.providers.find((provider) => provider.id === providerId) ?? null;
          if (!selected || !selected.is_connected) return null;
          mock.providers = mock.providers.map((provider) => ({
            ...provider,
            is_active: provider.id === providerId,
          }));
          saveMock(mock);
          return { ...selected, is_active: true };
        },
      );
      if (!row) return null;
      set((s) => ({
        providers: s.providers.map((provider) => ({
          ...provider,
          is_active: provider.id === providerId,
        })),
      }));
      setOnboardedFlag(true);
      return row;
    }),

  disconnectProvider: async (providerId) =>
    runStoreAction(set, async () => {
      const api = await loadTauri();
      await withTauriOrDemoMock<void>(
        api,
        () =>
          api!.invoke<void>("provider_disconnect", {
            providerConfigId: providerId,
          }),
        () => {
          const mock = loadMock();
          mock.providers = mock.providers.filter((p) => p.id !== providerId);
          saveMock(mock);
        },
      );
      set((s) => {
        const providers = s.providers.filter((p) => p.id !== providerId);
        if (!hasConnectedProvider(providers)) setOnboardedFlag(false);
        return { providers };
      });
    }),

  setOnboarded: (v) => {
    const providers = get().providers;
    setOnboardedFlag(v && hasConnectedProvider(providers));
  },

  isOnboarded: () => {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem(ONBOARDED_KEY) === "true" && hasConnectedProvider(get().providers)
    );
  },
}));

export const selectActiveSessions = (state: State): SessionRow[] =>
  state.sessions.filter((s) => s.status !== "archived");

export const selectCurrentProject = (state: State): ProjectRow | null => {
  if (state.currentProjectId === null) return null;
  return state.projects.find((p) => p.id === state.currentProjectId) ?? null;
};

export const selectHasConnectedProvider = (state: State): boolean =>
  state.providers.some((p) => p.is_connected);
