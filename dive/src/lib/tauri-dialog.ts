/**
 * Tauri dialog plugin wrapper.
 * - Tauri runtime uses the native folder picker.
 * - Browser-based previews/tests return null so text-entry fallback remains usable.
 * - User cancellation also returns null.
 */

export interface FolderPickerOptions {
  title?: string;
  defaultPath?: string;
}

export async function pickFolder(opts: FolderPickerOptions = {}): Promise<string | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) {
    return null;
  }

  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    title: opts.title ?? "프로젝트 폴더 선택",
    defaultPath: opts.defaultPath,
  });

  if (picked === null || picked === undefined) return null;
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked;
}

export function isTauriEnv(): boolean {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  return !!w?.__TAURI_INTERNALS__;
}
