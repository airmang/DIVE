// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { NewProjectDialog } from "./NewProjectDialog";

describe("NewProjectDialog beginner guidance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "ko" });
    useProjectSessionStore.setState({
      loaded: true,
      providers: [],
      projects: [],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      error: null,
      createProject: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the new-empty-folder hint and no .dive/ jargon (P1-07, P2-05)", () => {
    render(<NewProjectDialog open onOpenChange={vi.fn()} />);

    const hint = screen.getByTestId("np-folder-hint");
    expect(hint.textContent).toContain("비어 있는 새 폴더를 고르세요");
    // The purpose+safety description replaced the ".dive/" dotfolder jargon.
    expect(screen.getByTestId("new-project-dialog").textContent).not.toContain(".dive/");
  });

  it("surfaces a non-blocking note for a home/Desktop root but not a real project folder (P1-07)", () => {
    render(<NewProjectDialog open onOpenChange={vi.fn()} />);
    const path = screen.getByTestId("np-path");
    const create = screen.getByTestId("np-create") as HTMLButtonElement;

    fireEvent.change(path, { target: { value: "/Users/alice" } });
    expect(screen.getByTestId("np-folder-root-note")).toBeTruthy();
    // Non-blocking: the note never disables Create (Constitution V).
    expect(create.disabled).toBe(false);

    fireEvent.change(path, { target: { value: "/Users/alice/projects/my-app" } });
    expect(screen.queryByTestId("np-folder-root-note")).toBeNull();
    expect(create.disabled).toBe(false);
  });
});
