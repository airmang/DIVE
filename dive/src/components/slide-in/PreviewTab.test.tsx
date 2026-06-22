// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useSlideInStore } from "../../stores/slideIn";
import { PreviewTab } from "./PreviewTab";

const invokeMock = vi.fn();
const convertFileSrcMock = vi.fn((path: string) => `asset:${path}`);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => convertFileSrcMock(path),
}));

function installTauriInternals() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("PreviewTab", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useSlideInStore.setState({
      isOpen: true,
      activeTab: "preview",
      changedFiles: [],
      changeSummary: null,
      emptyReason: null,
      selectedFilePath: null,
      previewUrl: null,
      previewSession: null,
      previewRequestContext: { sessionId: 12, cardId: 34, source: "review_action" },
      runtimeEvidence: [],
      terminalLines: [],
    });
    invokeMock.mockReset();
    convertFileSrcMock.mockClear();
    installTauriInternals();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens a static HTML target through preview_open without shell approval copy", async () => {
    invokeMock.mockResolvedValueOnce({
      requestId: "preview-1",
      status: "ready",
      kind: "static_file",
      previewUrl: "http://127.0.0.1:49152/index.html",
      assetFilePath: "/project/index.html",
      targetLabel: "index.html",
      reasonCode: null,
      message: "Preview opened.",
      logs: [],
      commandSummary: null,
      resolvedAt: 123,
    });

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-static-candidate"));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("preview_open", expect.anything()));
    expect(invokeMock.mock.calls[0][1]).toEqual({
      request: {
        sessionId: 12,
        cardId: 34,
        kind: "static_file",
        target: "index.html",
        source: "review_action",
      },
    });
    await screen.findByTestId("preview-iframe");
    expect(screen.getByTestId("preview-iframe").getAttribute("src")).toBe(
      "http://127.0.0.1:49152/index.html",
    );
    expect(convertFileSrcMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/approval/i)).toBeNull();
    expect(screen.queryByText(/shell command/i)).toBeNull();
    expect(useSlideInStore.getState().previewSession?.status).toBe("ready");
  });

  it("opens a loopback URL and rejects external URLs before IPC", async () => {
    invokeMock.mockResolvedValueOnce({
      requestId: "preview-2",
      status: "ready",
      kind: "local_url",
      previewUrl: "http://127.0.0.1:5173/",
      assetFilePath: null,
      targetLabel: "http://127.0.0.1:5173/",
      reasonCode: null,
      message: "Preview opened.",
      logs: [],
      commandSummary: null,
      resolvedAt: 124,
    });

    render(<PreviewTab />);
    fireEvent.change(screen.getByTestId("preview-url-input"), {
      target: { value: "http://127.0.0.1:5173/" },
    });
    fireEvent.click(screen.getByTestId("preview-load"));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("preview-iframe").getAttribute("src")).toBe("http://127.0.0.1:5173/");

    fireEvent.change(screen.getByTestId("preview-url-input"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByTestId("preview-load"));

    expect((await screen.findByTestId("preview-error")).textContent).toContain("local");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("renders preview-specific unavailable state", async () => {
    invokeMock.mockResolvedValueOnce({
      requestId: "preview-3",
      status: "unavailable",
      kind: "static_file",
      previewUrl: null,
      assetFilePath: null,
      targetLabel: "notes.txt",
      reasonCode: "unsupported_extension",
      message: "Preview supports local .html and .htm files.",
      logs: [],
      commandSummary: null,
      resolvedAt: 125,
    });

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-static-candidate"));

    expect((await screen.findByTestId("preview-error")).textContent).toContain(".html");
    expect(screen.queryByTestId("preview-iframe")).toBeNull();
    expect(useSlideInStore.getState().previewSession?.status).toBe("unavailable");
  });
});
