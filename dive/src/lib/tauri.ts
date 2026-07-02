export type TauriApi = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  convertFileSrc: (path: string) => string;
};

export async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return {
    invoke: core.invoke as TauriApi["invoke"],
    convertFileSrc: core.convertFileSrc,
  };
}
