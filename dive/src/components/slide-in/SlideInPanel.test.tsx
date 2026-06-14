// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});
