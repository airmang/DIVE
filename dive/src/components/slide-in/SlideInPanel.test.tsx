// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useSlideInStore } from "../../stores/slideIn";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { CheckpointTimeline } from "./CheckpointTimeline";
import { SlideInPanel } from "./SlideInPanel";

describe("SlideInPanel i18n", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useLocaleStore.setState({ locale: "en" });
    useUiPreferencesStore.setState({ enableProvocationCards: false });
    useSlideInStore.setState({
      isOpen: true,
      activeTab: "preview",
      changedFiles: [],
      changeSummary: null,
      emptyReason: null,
      selectedFilePath: null,
      previewUrl: null,
      terminalLines: [],
    });
  });

  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "ko" });
    useSlideInStore.setState({
      isOpen: false,
      activeTab: "code",
      changedFiles: [],
      changeSummary: null,
      emptyReason: null,
      selectedFilePath: null,
      previewUrl: null,
      terminalLines: [],
    });
  });

  it("renders the panel, preview tab, terminal tab, and checkpoint surface in English", () => {
    const { rerender } = render(<SlideInPanel />);

    expect(screen.getByRole("heading", { name: "Code / Preview / Terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close panel" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check result" })).toBeTruthy();
    expect(screen.getByText("Choose a local URL to view the result.")).toBeTruthy();

    useSlideInStore.setState({ activeTab: "terminal" });
    rerender(<SlideInPanel />);

    expect(screen.getByText("Terminal — 0 lines")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByText("No output yet.")).toBeTruthy();

    render(<CheckpointTimeline sessionId={1} mockItems={[]} />);

    expect(screen.getByText("No checkpoints yet.")).toBeTruthy();
  });

  it("keeps Escape from closing the panel while the preview iframe is focused (S-031)", () => {
    useSlideInStore.setState({ previewUrl: "http://127.0.0.1:5173/" });
    render(<SlideInPanel />);
    const iframe = screen.getByTestId("preview-iframe");

    // Focus inside the preview content — Escape must not steal close-on-Esc.
    iframe.focus();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useSlideInStore.getState().isOpen).toBe(true);

    // Focus outside the preview — Escape closes the panel as usual.
    iframe.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useSlideInStore.getState().isOpen).toBe(false);
  });
});

describe("CheckpointTimeline accessibility", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "ko" });
  });

  it("opens restore controls from keyboard focus and preserves a non-color kind cue", () => {
    const onRestore = vi.fn();
    render(
      <CheckpointTimeline
        sessionId={1}
        currentCheckpointId={2}
        onRestore={onRestore}
        mockItems={[
          {
            id: 2,
            session_id: 1,
            card_id: null,
            git_sha: "abcdef123",
            kind: "manual",
            label: "Before refactor",
            created_at: 1_720_000_000_000,
            changed_files: ["src/App.tsx"],
          },
        ]}
      />,
    );

    const dot = screen.getByRole("button", {
      name: "Checkpoint Before refactor, manual, current checkpoint",
    });
    expect(dot.textContent).toBe("M");

    fireEvent.focus(dot);

    const restore = screen.getByRole("button", { name: "Restore" });
    fireEvent.blur(dot, { relatedTarget: restore });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledWith(2);
  });
});
