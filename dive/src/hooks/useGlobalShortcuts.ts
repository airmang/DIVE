import { useEffect } from "react";

export interface GlobalShortcutHandlers {
  onNewProject?: () => void;
  onManualCheckpoint?: () => void;
  onOpenPromptHelper?: () => void;
  onOpenSettings?: () => void;
  onToggleSlidePanel?: () => void;
  onToggleWorkmap?: () => void;
}

function isTypingInFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;
      if (e.altKey) return;

      switch (e.key) {
        case ",": {
          if (e.shiftKey) return;
          if (handlers.onOpenSettings) {
            e.preventDefault();
            handlers.onOpenSettings();
          }
          break;
        }
        case "/": {
          if (e.shiftKey) return;
          if (handlers.onOpenPromptHelper) {
            e.preventDefault();
            handlers.onOpenPromptHelper();
          }
          break;
        }
        case "n":
        case "N": {
          if (e.shiftKey) return;
          if (isTypingInFormField(e.target)) return;
          if (handlers.onNewProject) {
            e.preventDefault();
            handlers.onNewProject();
          }
          break;
        }
        case "s":
        case "S": {
          if (e.shiftKey) return;
          if (handlers.onManualCheckpoint) {
            e.preventDefault();
            handlers.onManualCheckpoint();
          }
          break;
        }
        case "e":
        case "E": {
          if (e.shiftKey) return;
          if (isTypingInFormField(e.target)) return;
          if (handlers.onToggleSlidePanel) {
            e.preventDefault();
            handlers.onToggleSlidePanel();
          }
          break;
        }
        case "w":
        case "W": {
          if (e.shiftKey) return;
          if (isTypingInFormField(e.target)) return;
          if (handlers.onToggleWorkmap) {
            e.preventDefault();
            handlers.onToggleWorkmap();
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handlers]);
}
