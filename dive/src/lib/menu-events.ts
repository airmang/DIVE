import { useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { isTauriEnv } from "./tauri-dialog";

export type MenuEventId =
  | "menu:new-project"
  | "menu:open-project"
  | "menu:open-recent"
  | "menu:settings"
  | "menu:toggle-theme"
  | "menu:help-docs"
  | "menu:help-issue"
  | "menu:help-about"
  | "menu:help-tutorial";

export type MenuEventHandlers = Partial<Record<MenuEventId, (payload?: unknown) => void>>;

/** Listen to Rust-emitted native menu events in Tauri only. */
export function useMenuEvents(handlers: MenuEventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isTauriEnv()) return;

    let cancelled = false;
    let unlisteners: Array<() => void> = [];
    const eventIds = Object.keys(handlersRef.current) as MenuEventId[];

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const nextUnlisteners = await Promise.all(
        eventIds.map((eventId) =>
          listen(eventId, (event) => {
            handlersRef.current[eventId]?.(event.payload);
          }),
        ),
      );
      if (cancelled) {
        nextUnlisteners.forEach((unlisten) => unlisten());
      } else {
        unlisteners = nextUnlisteners;
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      unlisteners = [];
    };
  }, []);
}

/** Ask Rust to rebuild File > Open Recent from the latest project rows. */
export async function refreshMenuRecents(): Promise<void> {
  if (!isTauriEnv()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("menu_refresh_recents");
}

/** Keep native menu labels aligned with the active app locale. */
export async function syncNativeMenuLocale(locale: Locale): Promise<void> {
  if (!isTauriEnv()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("menu_set_locale", { locale });
}
