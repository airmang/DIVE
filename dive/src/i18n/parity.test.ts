import { describe, expect, it } from "vitest";
import ko from "./ko.json";
import en from "./en.json";

// Collect every leaf key path (dot-notation) in a locale resource tree.
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...keyPaths(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe("i18n en/ko key parity", () => {
  // The translate() fallback chain is active → ko → key (i18n/index.ts), so a key
  // missing from en silently substitutes Korean for an English user (P2-24). This
  // assertion locks both locales to the same key set so that can never ship.
  it("ko.json and en.json expose identical key sets", () => {
    const koKeys = new Set(keyPaths(ko));
    const enKeys = new Set(keyPaths(en));
    const koOnly = [...koKeys].filter((key) => !enKeys.has(key)).sort();
    const enOnly = [...enKeys].filter((key) => !koKeys.has(key)).sort();
    expect({ koOnly, enOnly }).toEqual({ koOnly: [], enOnly: [] });
  });
});
