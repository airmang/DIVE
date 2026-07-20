export type TauriApi = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  convertFileSrc: (path: string) => string;
};

export type TauriEventApi = TauriApi & {
  listen: <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>;
};

function hasTauriInternals(): boolean {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  return Boolean(w?.__TAURI_INTERNALS__);
}

export async function loadTauri(): Promise<TauriApi | null> {
  if (!hasTauriInternals()) return null;
  const core = await import("@tauri-apps/api/core");
  return {
    invoke: core.invoke as TauriApi["invoke"],
    convertFileSrc: core.convertFileSrc,
  };
}

/** Variant of {@link loadTauri} for call sites that also need `@tauri-apps/api/event`'s `listen`. */
export async function loadTauriEvents(): Promise<TauriEventApi | null> {
  if (!hasTauriInternals()) return null;
  const [core, events] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return {
    invoke: core.invoke as TauriApi["invoke"],
    convertFileSrc: core.convertFileSrc,
    listen: events.listen as unknown as TauriEventApi["listen"],
  };
}
