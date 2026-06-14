// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { UserMessage } from "./UserMessage";

describe("UserMessage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "ko" });
  });

  it("localizes edit and resend button aria labels", () => {
    render(
      <UserMessage
        message={{ id: "m1", kind: "user", content: "Please retry", createdAt: 1 }}
        onEdit={vi.fn()}
        onResend={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend message" })).toBeTruthy();
    expect(screen.queryByLabelText("메시지 편집")).toBeNull();
    expect(screen.queryByLabelText("메시지 재전송")).toBeNull();
  });
});
