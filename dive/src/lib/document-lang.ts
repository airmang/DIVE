import type { Locale } from "../i18n";

/**
 * Map an app locale to the BCP-47 value for the document `lang` attribute.
 * Assistive tech and OS speech engines pick pronunciation/voice from
 * `<html lang>`, so this must track the active locale (S-044 / P1-33).
 */
export function localeToLang(locale: Locale): string {
  return locale === "ko" ? "ko" : "en";
}

/** Keep `<html lang>` in sync with the active locale. No-op outside a DOM. */
export function applyDocumentLang(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = localeToLang(locale);
}
