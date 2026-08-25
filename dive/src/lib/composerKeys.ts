import type { KeyboardEvent } from "react";

// S-073 (D-014-07): the one composer keyboard contract every chat-style
// textarea shares — the main chat, the PRD interview rail, and the Socratic
// panel. Plain Enter sends, Shift+Enter inserts a newline, and an Enter that is
// still part of an IME composition (Korean / Japanese / Chinese input) never
// sends: browsers report that either via `isComposing` or, on older WebKit /
// Chromium builds, via the legacy `keyCode === 229` placeholder.

/** True while the keydown belongs to an in-progress IME composition. */
export function isImeComposing(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing === true || event.keyCode === 229;
}

/** Shift+Enter — the newline gesture; callers let the default insert happen. */
export function isShiftEnter(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" && event.shiftKey;
}

/** Plain Enter outside an IME composition — the send gesture. */
export function shouldSendOnEnter(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !isImeComposing(event);
}
