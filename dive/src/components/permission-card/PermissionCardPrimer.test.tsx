// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useLocaleStore } from "../../i18n";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { PermissionCardPrimer } from "./PermissionCardPrimer";

describe("PermissionCardPrimer (P1-19)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
    useUiPreferencesStore.setState({
      tutorialEnabled: true,
      permissionCardPrimerDismissed: false,
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

  it("dismisses one-time through persisted store state and stays hidden after re-render", () => {
    const { rerender } = render(<PermissionCardPrimer />);

    fireEvent.click(screen.getByTestId("permission-card-primer-dismiss"));

    expect(useUiPreferencesStore.getState().permissionCardPrimerDismissed).toBe(true);
    expect(screen.queryByTestId("permission-card-primer")).toBeNull();

    rerender(<PermissionCardPrimer />);
    expect(screen.queryByTestId("permission-card-primer")).toBeNull();
  });

  it.each([false, true])(
    "stays hidden when guided help is off, dismissed=%s",
    (permissionCardPrimerDismissed) => {
      useUiPreferencesStore.setState({
        tutorialEnabled: false,
        permissionCardPrimerDismissed,
      });

      render(<PermissionCardPrimer />);

      expect(screen.queryByTestId("permission-card-primer")).toBeNull();
      expect(screen.queryByTestId("permission-card-primer-dismiss")).toBeNull();
    },
  );
});
