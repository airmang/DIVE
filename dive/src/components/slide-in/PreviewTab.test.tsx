// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { useSlideInStore } from "../../stores/slideIn";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { PreviewTab } from "./PreviewTab";
import { previewModeHint } from "./previewModeHint";

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

function readyPreviewResponse(
  overrides: Partial<{
    requestId: string;
    status: "ready" | "unavailable" | "failed";
    kind: "static_file" | "local_url" | "dev_server" | "auto";
    previewUrl: string | null;
    assetFilePath: string | null;
    targetLabel: string;
    reasonCode: string | null;
    message: string;
    logs: string[];
    commandSummary: string | null;
    resolvedAt: number;
  }> = {},
) {
  return {
    requestId: "preview-1",
    status: "ready" as const,
    kind: "static_file" as const,
    previewUrl: "http://127.0.0.1:49152/index.html",
    assetFilePath: "/project/index.html",
    targetLabel: "index.html",
    reasonCode: null,
    message: "Preview opened.",
    logs: [],
    commandSummary: null,
    resolvedAt: 123,
    ...overrides,
  };
}

describe("PreviewTab", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
    useProjectSessionStore.setState({
      currentProjectId: null,
      currentSessionId: null,
    });
    useUiPreferencesStore.setState({
      tutorialEnabled: false,
      previewOnboardingDismissed: false,
      previewModeByProject: {},
    });
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

  it("maps preview mode hints over the full resolved kind union", () => {
    expect(previewModeHint("static_file")).toBe("static");
    expect(previewModeHint("local_url")).toBe("server");
    expect(previewModeHint("dev_server")).toBe("server");
    expect(previewModeHint(undefined)).toBeNull();
  });

  it("opens Show my result through Auto and uses the resolved static kind for the hint", async () => {
    useProjectSessionStore.setState({ currentProjectId: 7 });
    invokeMock.mockResolvedValueOnce(readyPreviewResponse());

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-auto-connect"));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("preview_open", expect.anything()));
    expect(screen.getByTestId("preview-auto-connect").textContent).toContain("Show my result");
    expect(invokeMock.mock.calls[0][1]).toEqual({
      request: {
        sessionId: 12,
        cardId: 34,
        kind: "auto",
        target: "",
        source: "review_action",
      },
    });
    expect((await screen.findByTestId("preview-mode-badge")).textContent).toContain(
      "Static file preview",
    );
    expect(useSlideInStore.getState().previewSession?.kind).toBe("static_file");
    expect(useUiPreferencesStore.getState().previewModeByProject[7]).toEqual({
      kind: "static_file",
      lastUrl: "http://127.0.0.1:49152/index.html",
    });
  });

  it("hides and shows the legacy preview mechanisms under Other ways to preview", () => {
    render(<PreviewTab />);

    expect(screen.queryByTestId("preview-static-candidate")).toBeNull();
    expect(screen.queryByTestId("preview-candidate")).toBeNull();
    expect(screen.queryByTestId("preview-static-path-input")).toBeNull();
    expect(screen.queryByTestId("preview-static-path-open")).toBeNull();

    fireEvent.click(screen.getByTestId("preview-other-ways-toggle"));

    expect(screen.getByTestId("preview-static-candidate")).toBeTruthy();
    expect(screen.getAllByTestId("preview-candidate")).toHaveLength(2);
    expect(screen.getByTestId("preview-static-path-input")).toBeTruthy();
    expect(screen.getByTestId("preview-static-path-open")).toBeTruthy();

    fireEvent.click(screen.getByTestId("preview-other-ways-toggle"));

    expect(screen.queryByTestId("preview-static-candidate")).toBeNull();
    expect(screen.queryByTestId("preview-candidate")).toBeNull();
    expect(screen.queryByTestId("preview-static-path-input")).toBeNull();
    expect(screen.queryByTestId("preview-static-path-open")).toBeNull();
  });

  it("uses remembered project preview mode as defaults without opening preview on mount", () => {
    useProjectSessionStore.setState({ currentProjectId: 7 });
    useUiPreferencesStore.setState({
      previewModeByProject: {
        7: { kind: "dev_server", lastUrl: "http://127.0.0.1:5173/" },
        9: { kind: "static_file", lastUrl: "index.html" },
      },
    });

    render(<PreviewTab />);

    expect((screen.getByTestId("preview-url-input") as HTMLInputElement).value).toBe(
      "http://127.0.0.1:5173/",
    );
    expect(screen.getByTestId("preview-reopen-last").textContent).toContain("Reopen last preview");
    expect(screen.getByTestId("preview-remembered-mode").textContent).toContain(
      "Dev-server preview",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("opens a static HTML target through preview_open without shell approval copy", async () => {
    invokeMock.mockResolvedValueOnce(readyPreviewResponse());

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-other-ways-toggle"));
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
    expect(screen.getByTestId("preview-mode-badge").textContent).toContain("Static file preview");
  });

  it("exposes modals/forms sandbox, responsive width, and reload (S-031)", async () => {
    invokeMock.mockResolvedValueOnce(
      readyPreviewResponse({ requestId: "preview-4", resolvedAt: 200 }),
    );

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-other-ways-toggle"));
    fireEvent.click(screen.getByTestId("preview-static-candidate"));
    const iframe = await screen.findByTestId("preview-iframe");

    // Sandbox now permits confirm()/alert() and <form> submit, but not top-nav/popups.
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-modals");
    expect(sandbox).toContain("allow-forms");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");

    // Responsive width: defaults to full, mobile constrains the frame to 375px.
    expect(screen.getByTestId("preview-viewport-readout").textContent).toContain("Full");
    fireEvent.click(screen.getByTestId("preview-viewport-mobile"));
    expect(screen.getByTestId("preview-viewport-readout").textContent).toContain("375px");
    expect((screen.getByTestId("preview-viewport-frame") as HTMLElement).style.width).toBe("375px");

    // Reload remounts the iframe (real reload, not a no-op re-click of the same src).
    const before = screen.getByTestId("preview-iframe");
    fireEvent.click(screen.getByTestId("preview-reload"));
    expect(screen.getByTestId("preview-iframe")).not.toBe(before);
  });

  it("opens a non-index project page via the project-page input (S-031)", async () => {
    invokeMock.mockResolvedValueOnce(
      readyPreviewResponse({
        requestId: "preview-5",
        previewUrl: "http://127.0.0.1:49152/about.html",
        assetFilePath: "/project/about.html",
        targetLabel: "about.html",
        resolvedAt: 210,
      }),
    );

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-other-ways-toggle"));
    fireEvent.change(screen.getByTestId("preview-static-path-input"), {
      target: { value: "about.html" },
    });
    fireEvent.click(screen.getByTestId("preview-static-path-open"));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("preview_open", expect.anything()));
    expect(invokeMock.mock.calls[0][1]).toEqual({
      request: {
        sessionId: 12,
        cardId: 34,
        kind: "static_file",
        target: "about.html",
        source: "review_action",
      },
    });
    expect((await screen.findByTestId("preview-iframe")).getAttribute("src")).toBe(
      "http://127.0.0.1:49152/about.html",
    );
  });

  it("renders the dev-server mode hint from a resolved dev_server response", async () => {
    invokeMock.mockResolvedValueOnce(
      readyPreviewResponse({
        requestId: "preview-dev",
        kind: "dev_server",
        previewUrl: "http://127.0.0.1:5173/",
        assetFilePath: null,
        targetLabel: "http://127.0.0.1:5173/",
        commandSummary: "pnpm dev",
        resolvedAt: 211,
      }),
    );

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-auto-connect"));

    expect((await screen.findByTestId("preview-mode-badge")).textContent).toContain(
      "Dev-server preview",
    );
    expect(useSlideInStore.getState().previewSession?.kind).toBe("dev_server");
  });

  it("opens a loopback URL and rejects external URLs before IPC", async () => {
    invokeMock.mockResolvedValueOnce(
      readyPreviewResponse({
        requestId: "preview-2",
        kind: "local_url",
        previewUrl: "http://127.0.0.1:5173/",
        assetFilePath: null,
        targetLabel: "http://127.0.0.1:5173/",
        resolvedAt: 124,
      }),
    );

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
    invokeMock.mockResolvedValueOnce(
      readyPreviewResponse({
        requestId: "preview-3",
        status: "unavailable",
        previewUrl: null,
        assetFilePath: null,
        targetLabel: "notes.txt",
        reasonCode: "unsupported_extension",
        message: "Preview supports local .html and .htm files.",
        resolvedAt: 125,
      }),
    );

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-other-ways-toggle"));
    fireEvent.click(screen.getByTestId("preview-static-candidate"));

    expect((await screen.findByTestId("preview-error")).textContent).toContain(".html");
    expect(screen.queryByTestId("preview-iframe")).toBeNull();
    expect(useSlideInStore.getState().previewSession?.status).toBe("unavailable");
  });

  it("resolves backend reason codes to translated preview copy", async () => {
    invokeMock.mockResolvedValueOnce(
      readyPreviewResponse({
        requestId: "preview-missing-package",
        status: "failed",
        kind: "dev_server",
        previewUrl: null,
        assetFilePath: null,
        targetLabel: "project preview",
        reasonCode: "missing_package_json",
        message: "The selected project does not include a package.json.",
        resolvedAt: 126,
      }),
    );

    render(<PreviewTab />);
    fireEvent.click(screen.getByTestId("preview-auto-connect"));

    expect((await screen.findByTestId("preview-error")).textContent).toContain(
      "This project does not have a package.json",
    );
    expect(useSlideInStore.getState().previewSession?.errorReason).toBe("missing_package_json");
  });
});
