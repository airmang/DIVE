// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setProjectSessionDemoFallback,
  useProjectSessionStore,
  type ProjectRow,
  type ProviderSummary,
  type SessionRow,
} from "./project-session";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshMenuRecents: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));

vi.mock("../lib/menu-events", () => ({
  refreshMenuRecents: mocks.refreshMenuRecents,
}));

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const CURRENT_PROJECT_KEY = "dive:current-project-id";
const CURRENT_SESSION_KEY = "dive:current-session-id";

function installTauriInternals() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

function project(id: number, name: string, status = "active"): ProjectRow {
  return {
    id,
    name,
    path: `/projects/${name}`,
    provider_default: null,
    model_default: null,
    status,
    created_at: id * 100,
    updated_at: id * 100,
  };
}

function session(id: number, projectId: number, status = "active"): SessionRow {
  return {
    id,
    project_id: projectId,
    title: `Session ${id}`,
    started_at: id * 100,
    ended_at: null,
    status,
  };
}

function resetStore() {
  useProjectSessionStore.setState({
    isTauri: false,
    loaded: false,
    projects: [],
    sessions: [],
    providers: [],
    currentProjectId: null,
    currentSessionId: null,
    error: null,
  });
}

describe("project-session store", () => {
  beforeEach(() => {
    installTauriInternals();
    window.localStorage.clear();
    mocks.invoke.mockReset();
    mocks.refreshMenuRecents.mockClear();
    setProjectSessionDemoFallback(false);
    resetStore();
  });

  it("selects a real fallback project when deleting the active project", async () => {
    const activeProject = project(1, "old");
    const fallbackProject = project(2, "fallback");
    const fallbackSessions = [session(20, 2), session(21, 2, "archived")];

    useProjectSessionStore.setState({
      isTauri: true,
      loaded: true,
      projects: [activeProject, fallbackProject],
      sessions: [session(10, 1)],
      currentProjectId: 1,
      currentSessionId: 10,
    });
    window.localStorage.setItem(CURRENT_PROJECT_KEY, "1");
    window.localStorage.setItem(CURRENT_SESSION_KEY, "10");

    mocks.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "project_delete") {
        expect(args).toEqual({ projectId: 1, deleteFolder: false });
        return undefined;
      }
      if (cmd === "project_select") {
        expect(args).toEqual({ projectId: 2 });
        return fallbackProject;
      }
      if (cmd === "session_list") {
        expect(args).toEqual({ projectId: 2 });
        return fallbackSessions;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useProjectSessionStore.getState().deleteProject(1);

    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "project_delete",
      "project_select",
      "session_list",
    ]);
    expect(useProjectSessionStore.getState()).toMatchObject({
      projects: [fallbackProject],
      sessions: fallbackSessions,
      currentProjectId: 2,
      currentSessionId: 20,
      error: null,
    });
    expect(window.localStorage.getItem(CURRENT_PROJECT_KEY)).toBe("2");
    expect(window.localStorage.getItem(CURRENT_SESSION_KEY)).toBe("20");
  });

  it("clears state and localStorage when deleting the last active project", async () => {
    const activeProject = project(1, "only");

    useProjectSessionStore.setState({
      isTauri: true,
      loaded: true,
      projects: [activeProject],
      sessions: [session(10, 1)],
      currentProjectId: 1,
      currentSessionId: 10,
    });
    window.localStorage.setItem(CURRENT_PROJECT_KEY, "1");
    window.localStorage.setItem(CURRENT_SESSION_KEY, "10");
    mocks.invoke.mockResolvedValue(undefined);

    await useProjectSessionStore.getState().deleteProject(1);

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("project_delete", {
      projectId: 1,
      deleteFolder: false,
    });
    expect(useProjectSessionStore.getState()).toMatchObject({
      projects: [],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      error: null,
    });
    expect(window.localStorage.getItem(CURRENT_PROJECT_KEY)).toBeNull();
    expect(window.localStorage.getItem(CURRENT_SESSION_KEY)).toBeNull();
  });

  it("preserves the project rail when startup project_select hits a stale path", async () => {
    const projects = [project(1, "moved"), project(2, "usable")];
    const providers: ProviderSummary[] = [];

    window.localStorage.setItem(CURRENT_PROJECT_KEY, "1");
    window.localStorage.setItem(CURRENT_SESSION_KEY, "99");

    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "project_list") return projects;
      if (cmd === "provider_list") return providers;
      if (cmd === "project_select") throw new Error("path does not exist");
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await expect(useProjectSessionStore.getState().loadAll()).resolves.toBeUndefined();

    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "project_list",
      "provider_list",
      "project_select",
    ]);
    expect(useProjectSessionStore.getState()).toMatchObject({
      isTauri: true,
      loaded: true,
      projects,
      providers,
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      error: "path does not exist",
    });
    expect(window.localStorage.getItem(CURRENT_PROJECT_KEY)).toBeNull();
    expect(window.localStorage.getItem(CURRENT_SESSION_KEY)).toBeNull();
  });

  it("archives the currently open project without switching away from it", async () => {
    const activeProject = project(1, "current");
    const otherProject = project(2, "other");

    useProjectSessionStore.setState({
      isTauri: true,
      loaded: true,
      projects: [activeProject, otherProject],
      sessions: [session(10, 1)],
      currentProjectId: 1,
      currentSessionId: 10,
    });

    mocks.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "project_archive") {
        expect(args).toEqual({ projectId: 1 });
        return undefined;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useProjectSessionStore.getState().archiveProject(1);

    expect(mocks.invoke).toHaveBeenCalledWith("project_archive", { projectId: 1 });
    const state = useProjectSessionStore.getState();
    // Deliberate deviation from archiveSession (which nulls currentSessionId
    // when the archived session was current): the archived project stays
    // open, and its session/currentSessionId are untouched — no auto-switch.
    expect(state.currentProjectId).toBe(1);
    expect(state.currentSessionId).toBe(10);
    expect(state.projects.find((p) => p.id === 1)?.status).toBe("archived");
    expect(state.projects.find((p) => p.id === 2)?.status).toBe("active");
  });

  it("unarchiveProject restores a project's status to active", async () => {
    const archivedProject = project(1, "shelved", "archived");

    useProjectSessionStore.setState({
      isTauri: true,
      loaded: true,
      projects: [archivedProject],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
    });

    mocks.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "project_unarchive") {
        expect(args).toEqual({ projectId: 1 });
        return undefined;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useProjectSessionStore.getState().unarchiveProject(1);

    expect(mocks.invoke).toHaveBeenCalledWith("project_unarchive", { projectId: 1 });
    expect(useProjectSessionStore.getState().projects[0].status).toBe("active");
  });

  it("skips an archived stored project on startup and lands on the first active one", async () => {
    const archivedProject = project(1, "archived-one", "archived");
    const activeProject = project(2, "active-two");
    const providers: ProviderSummary[] = [];

    window.localStorage.setItem(CURRENT_PROJECT_KEY, "1");

    mocks.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "project_list") return [archivedProject, activeProject];
      if (cmd === "provider_list") return providers;
      if (cmd === "project_select") {
        expect(args).toEqual({ projectId: 2 });
        return activeProject;
      }
      if (cmd === "session_list") {
        expect(args).toEqual({ projectId: 2 });
        return [];
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await useProjectSessionStore.getState().loadAll();

    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "project_list",
      "provider_list",
      "project_select",
      "session_list",
    ]);
    expect(useProjectSessionStore.getState().currentProjectId).toBe(2);
  });
});
