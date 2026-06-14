// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "../../i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

describe("DialogContent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "ko" });
  });

  it("localizes the close control", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>Review this action.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.queryByText("닫기")).toBeNull();
  });
});
