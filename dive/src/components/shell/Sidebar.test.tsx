// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore, type ProjectRow } from "../../stores/project-session";
import { ToastProvider } from "../toast/ToastProvider";
import { Sidebar } from "./Sidebar";

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

describe("Sidebar loading vs false-empty (P1-36)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({
      loaded: false,
      projects: [],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      providers: [],
      error: null,
      // Keep `loaded` false so the initial-load skeleton stays on screen; the
      // effect calls loadAll().catch(), so it must return a promise.
      loadAll: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    useProjectSessionStore.setState({ loaded: false });
  });

  it("renders skeleton rows while the initial load is in flight", () => {
    render(<Sidebar />);
    expect(screen.getAllByTestId("sidebar-loading").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("project-list")).toBeNull();
  });

  it("shows the empty-state (no skeleton) once loaded with no projects", () => {
    useProjectSessionStore.setState({ loaded: true, projects: [] });
    render(<Sidebar />);
    expect(screen.queryByTestId("sidebar-loading")).toBeNull();
  });
});

describe("Sidebar archived projects section (S-056 D4)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({
      loaded: true,
      projects: [project(1, "active-one"), project(2, "shelved", "archived")],
      sessions: [],
      currentProjectId: 1,
      currentSessionId: null,
      providers: [],
      error: null,
      loadAll: vi.fn().mockResolvedValue(undefined),
      selectProject: vi.fn().mockResolvedValue(undefined),
      deleteProject: vi.fn().mockResolvedValue(undefined),
      archiveProject: vi.fn().mockResolvedValue(undefined),
      unarchiveProject: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue(null),
      selectSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    useProjectSessionStore.setState({ loaded: false });
  });

  it("keeps the active project list unaffected by archived projects", () => {
    render(<Sidebar />);
    const activeItems = screen.getAllByTestId("project-item");
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0].textContent).toContain("active-one");
  });

  it("renders the archived section collapsed by default and expands on toggle", () => {
    render(<Sidebar />);
    expect(screen.queryByTestId("archived-project-list")).toBeNull();

    fireEvent.click(screen.getByTestId("archived-projects-toggle"));

    const archivedItems = screen.getAllByTestId("archived-project-item");
    expect(archivedItems).toHaveLength(1);
    expect(archivedItems[0].textContent).toContain("shelved");
    expect(archivedItems[0].className).toMatch(/opacity-60/);
  });

  it("does not render the archived section when there are no archived projects", () => {
    useProjectSessionStore.setState({ projects: [project(1, "active-one")] });
    render(<Sidebar />);
    expect(screen.queryByTestId("archived-projects-toggle")).toBeNull();
  });

  it("opens an archived project normally when clicked", () => {
    const selectProject = vi.fn().mockResolvedValue(undefined);
    useProjectSessionStore.setState({ selectProject });
    render(<Sidebar />);

    fireEvent.click(screen.getByTestId("archived-projects-toggle"));
    fireEvent.click(screen.getByTestId("archived-project-item"));

    expect(selectProject).toHaveBeenCalledWith(2);
  });

  it("calls archiveProject/unarchiveProject from the row affordances", () => {
    const archiveProject = vi.fn().mockResolvedValue(undefined);
    const unarchiveProject = vi.fn().mockResolvedValue(undefined);
    useProjectSessionStore.setState({ archiveProject, unarchiveProject });
    render(<Sidebar />);

    fireEvent.click(screen.getByTestId("project-archive"));
    expect(archiveProject).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByTestId("archived-projects-toggle"));
    fireEvent.click(screen.getByTestId("project-unarchive"));
    expect(unarchiveProject).toHaveBeenCalledWith(2);
  });
});

describe("Sidebar mutation failures surface a toast instead of an unhandled rejection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
    useProjectSessionStore.setState({
      loaded: true,
      projects: [project(1, "active-one")],
      sessions: [],
      currentProjectId: 1,
      currentSessionId: null,
      providers: [],
      error: null,
      loadAll: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({ loaded: false });
  });

  it("shows an error toast when deleteProject rejects (delete confirmed)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleteProject = vi.fn().mockRejectedValue(new Error("disk full"));
    useProjectSessionStore.setState({ deleteProject });

    render(
      <ToastProvider>
        <Sidebar />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId("project-delete"));

    const toast = await screen.findByTestId("toast");
    expect(toast.dataset.variant).toBe("error");
    expect(toast.textContent).toContain("Could not delete project");
  });
});
