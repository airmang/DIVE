// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { PermissionCardPrimer, WebFetchPermissionCardPrimer } from "./PermissionCardPrimer";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => path,
}));

function installTauriInternals() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("PermissionCardPrimer (P1-19)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    installTauriInternals();
    useLocaleStore.setState({ locale: "en" });
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      permissionCardPrimerDismissed: false,
      webPermissionCardPrimerDismissed: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the honest 3-tier model when guided help is on and not dismissed", () => {
    render(<PermissionCardPrimer />);

    expect(screen.getByTestId("permission-card-primer")).toBeTruthy();
    expect(screen.getByText("How permissions work")).toBeTruthy();
    expect(screen.getByText("Green = read-only — runs automatically.")).toBeTruthy();
    expect(screen.getByText("Red = delete or run commands — you judge it and allow.")).toBeTruthy();
    expect(
      screen.getByText("Truly destructive commands are blocked by DIVE outright."),
    ).toBeTruthy();
  });

  it("logs generic shown once per mount and does not re-log on re-render", async () => {
    const { rerender } = render(<PermissionCardPrimer />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("log_ui_event", {
        sessionId: null,
        eventType: "permission_primer.shown",
        payload: { variant: "generic" },
      }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);

    rerender(<PermissionCardPrimer />);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("dismisses one-time through persisted store state and stays hidden after re-render", () => {
    const { rerender } = render(<PermissionCardPrimer />);

    fireEvent.click(screen.getByTestId("permission-card-primer-dismiss"));

    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(true);
    expect(screen.queryByTestId("permission-card-primer")).toBeNull();

    rerender(<PermissionCardPrimer />);
    expect(screen.queryByTestId("permission-card-primer")).toBeNull();
  });

  it("logs generic dismissed on click", async () => {
    render(<PermissionCardPrimer />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("permission-card-primer-dismiss"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("log_ui_event", {
        sessionId: null,
        eventType: "permission_primer.dismissed",
        payload: { variant: "generic" },
      }),
    );
    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(true);
  });

  it.each([false, true])(
    "stays hidden when guided help is off, dismissed=%s",
    (permissionCardPrimerDismissed) => {
      useUiPreferencesStore.setState({
        tutorialEnabled: false,
        permissionCardPrimerDismissed,
        webPermissionCardPrimerDismissed: false,
      });

      render(<PermissionCardPrimer />);

      expect(screen.queryByTestId("permission-card-primer")).toBeNull();
      expect(screen.queryByTestId("permission-card-primer-dismiss")).toBeNull();
    },
  );

  it("shows the web primer even after the generic permission primer was dismissed", () => {
    useUiPreferencesStore.setState({
      permissionCardPrimerDismissed: true,
      webPermissionCardPrimerDismissed: false,
    });

    render(<WebFetchPermissionCardPrimer />);

    expect(screen.getByTestId("web-permission-card-primer")).toBeTruthy();
    expect(screen.getByText("The AI can look things up online")).toBeTruthy();
  });

  it("logs web primer shown once per mount and does not re-log on re-render", async () => {
    const { rerender } = render(<WebFetchPermissionCardPrimer />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("log_ui_event", {
        sessionId: null,
        eventType: "permission_primer.shown",
        payload: { variant: "web_fetch" },
      }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);

    rerender(<WebFetchPermissionCardPrimer />);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("dismisses the web primer with its own persisted flag", () => {
    const { rerender } = render(<WebFetchPermissionCardPrimer />);

    fireEvent.click(screen.getByTestId("web-permission-card-primer-dismiss"));

    expect(useUiPreferencesStore.getState().webPermissionCardPrimerDismissed).toBe(true);
    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(false);
    expect(screen.queryByTestId("web-permission-card-primer")).toBeNull();

    rerender(<WebFetchPermissionCardPrimer />);
    expect(screen.queryByTestId("web-permission-card-primer")).toBeNull();
  });

  it("logs web primer dismissed on click", async () => {
    render(<WebFetchPermissionCardPrimer />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("web-permission-card-primer-dismiss"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("log_ui_event", {
        sessionId: null,
        eventType: "permission_primer.dismissed",
        payload: { variant: "web_fetch" },
      }),
    );
    expect(useUiPreferencesStore.getState().webPermissionCardPrimerDismissed).toBe(true);
  });
});
