// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { PatchPreviewPanel } from "./PatchPreviewPanel";

describe("PatchPreviewPanel", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => cleanup());

  it("renders every diff entry when multi-file previews are present", () => {
    render(
      <PatchPreviewPanel
        diff={null}
        diffPreviews={[
          { path: "src/one.ts", before: "OldName();", after: "NewName();" },
          { path: "src/two.ts", before: "OldName.test();", after: "NewName.test();" },
        ]}
        expected
        onViewed={vi.fn()}
      />,
    );

    expect(screen.getByText(/across 2 files/)).toBeTruthy();
    expect(screen.getByTestId("multi-diff-preview-list")).toBeTruthy();
    expect(screen.getAllByTestId("diff-viewer")).toHaveLength(2);
    expect(screen.getAllByTestId("diff-path").map((node) => node.textContent)).toEqual([
      "src/one.ts",
      "src/two.ts",
    ]);
  });

  it("keeps the single diff preview branch when only diffPreview is present", () => {
    render(
      <PatchPreviewPanel
        diff={{ path: "src/App.tsx", before: "old", after: "new" }}
        expected
        onViewed={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Review the exact before/after file change. Nothing here is applied until you allow it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("multi-diff-preview-list")).toBeNull();
    expect(screen.getAllByTestId("diff-viewer")).toHaveLength(1);
    expect(screen.getByTestId("diff-path").textContent).toBe("src/App.tsx");
  });

  it("surfaces the secret callout even with no diff to scroll (P1-25)", () => {
    render(
      <PatchPreviewPanel
        diff={null}
        expected
        approvalWarnings={{
          secretFlagged: true,
          secretReasons: ["named_secret"],
          wholeFileOverwrite: null,
        }}
        onViewed={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("diff-viewer")).toBeNull();
    expect(screen.getByTestId("diff-secret-callout")).toBeTruthy();
  });

  it("renders nothing when there is no diff and no warning to show", () => {
    const { container } = render(
      <PatchPreviewPanel diff={null} expected={false} onViewed={vi.fn()} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
