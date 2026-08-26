import type { KeyboardEvent } from "react";

// S-073 (D-014-07): the one composer keyboard contract every chat-style
// textarea shares — the main chat, the PRD interview rail, and the Socratic
// panel. Plain Enter sends and Shift+Enter inserts a newline. An Enter the
// browser reports as part of an IME composition never sends; that covers the
// `isComposing` flag and the legacy `keyCode === 229` placeholder some engines
// still emit. Known limitation (D-014-11): on WebKit the Enter that closes a
// candidate window in candidate-based IMEs can arrive after compositionend
// with `isComposing === false`, and this helper cannot tell it from a send.

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
