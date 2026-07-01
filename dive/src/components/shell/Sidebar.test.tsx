// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { Sidebar } from "./Sidebar";

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
