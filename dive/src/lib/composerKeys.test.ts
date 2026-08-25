import { describe, expect, it } from "vitest";
import type { KeyboardEvent } from "react";

import { isImeComposing, isShiftEnter, shouldSendOnEnter } from "./composerKeys";

interface KeyStub {
  key?: string;
  shiftKey?: boolean;
  keyCode?: number;
  isComposing?: boolean;
}

function keyEvent(stub: KeyStub = {}): KeyboardEvent<HTMLElement> {
  const key = stub.key ?? "Enter";
  return {
    key,
    shiftKey: stub.shiftKey ?? false,
    keyCode: stub.keyCode ?? (key === "Enter" ? 13 : 0),
    nativeEvent: { isComposing: stub.isComposing ?? false },
  } as unknown as KeyboardEvent<HTMLElement>;
}

describe("composerKeys (S-073 / D-014-07)", () => {
  it("sends on a plain Enter", () => {
    expect(shouldSendOnEnter(keyEvent())).toBe(true);
  });

  it("does not send on Shift+Enter (that is the newline gesture)", () => {
    const event = keyEvent({ shiftKey: true });
    expect(shouldSendOnEnter(event)).toBe(false);
    expect(isShiftEnter(event)).toBe(true);
  });

  it("does not send while an IME composition is in progress", () => {
    const event = keyEvent({ isComposing: true });
    expect(isImeComposing(event)).toBe(true);
    expect(shouldSendOnEnter(event)).toBe(false);
  });

  it("treats the legacy keyCode 229 placeholder as composing", () => {
    const event = keyEvent({ keyCode: 229 });
    expect(isImeComposing(event)).toBe(true);
    expect(shouldSendOnEnter(event)).toBe(false);
  });

  it("ignores every other key", () => {
    for (const key of ["a", "Tab", "Escape", " ", "ArrowDown"]) {
      expect(shouldSendOnEnter(keyEvent({ key }))).toBe(false);
      expect(isShiftEnter(keyEvent({ key, shiftKey: true }))).toBe(false);
    }
  });
});
