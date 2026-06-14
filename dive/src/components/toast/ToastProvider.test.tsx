// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useToast } from "./toast-context";
import { ToastProvider } from "./ToastProvider";

function ToastTrigger() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() => toast({ variant: "info", title: "Saved" })}
      data-testid="toast-trigger"
    >
      Show toast
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "ko" });
  });

  it("localizes toast region and dismiss aria labels", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("toast-trigger"));

    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeTruthy();
    expect(screen.queryByLabelText("알림")).toBeNull();
    expect(screen.queryByLabelText("토스트 닫기")).toBeNull();
  });
});
