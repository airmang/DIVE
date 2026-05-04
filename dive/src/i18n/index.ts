/**
 * DIVE i18n — lightweight custom implementation.
 *
 * Architectural decisions (necessary to preserve):
 * - Avoid `react-i18next` / `i18next` runtime deps; DIVE only ships 2 locales
 *   (ko-KR / en-US, spec §12.3), a custom `t()` + Zustand store is enough.
 * - Resources bundled at build time (no async loading).
 * - Interpolation: `{{placeholder}}` tokens; dot-notation nested keys.
 * - Fallback chain: active locale → ko → key string (tests can detect misses).
 * - OS detection on first run, `localStorage` persistence (`dive:locale`).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import koResources from "./ko.json";
import enResources from "./en.json";

export type Locale = "ko" | "en";

const resources: Record<Locale, Record<string, unknown>> = {
  ko: koResources as Record<string, unknown>,
  en: enResources as Record<string, unknown>,
};

export const SUPPORTED_LOCALES: Locale[] = ["ko", "en"];
export const LOCALE_LABEL: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
};

export function detectOsLocale(): Locale {
  if (typeof navigator === "undefined") return "ko";
  const preferred = navigator.languages?.[0] ?? navigator.language ?? "";
  return preferred.toLowerCase().startsWith("ko") ? "ko" : "en";
}

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: detectOsLocale(),
      setLocale: (locale) => set({ locale }),
    }),
    { name: "dive:locale" },
  ),
);

function resolveKey(tree: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split(".");
  let cursor: unknown = tree;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined ? `{{${name}}}` : String(value);
  });
}

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const active = resources[locale];
  const primary = resolveKey(active, key);
  if (primary !== undefined) return interpolate(primary, params);
  const fallback = resolveKey(resources.ko, key);
  if (fallback !== undefined) return interpolate(fallback, params);
  return key;
}

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
}

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}
