import { readFileSync } from "fs";

import { describe, expect, it } from "vitest";
// `fs` is typed by the local ambient shim src/styles/fs-node-shim.d.ts (vitest
// stubs `.css?raw` imports to empty, and @types/node is not a project dep).

/**
 * S-044 (010 Theme 4) — WCAG AA contrast lock.
 *
 * Parses the real design-token file and asserts that every load-bearing
 * small-text pairing a beginner reads while supervising the AI clears the
 * WCAG 2.1 AA 4.5:1 minimum, in BOTH the default dark theme and the
 * OS-opt-in light theme. This is the regression guard for the token values
 * chosen in specs/010-beginner-readiness-ux/design-s044.md — if anyone later
 * lightens a foreground tier or brightens the light-mode accent back past the
 * threshold, this test fails.
 *
 * Findings locked here: P1-02, P1-27, P1-32, P1-38, P2-23, P2-29, P2-34,
 * P2-35, P2-36 (and the latent white-on-accent primary-button failure).
 */

type RGB = [number, number, number];

const AA = 4.5; // normal-size text

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `color` at `alpha` over opaque `bg` (straight alpha, as CSS rgba). */
function over(color: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => alpha * color[i] + (1 - alpha) * bg[i]) as RGB;
}

function parseBlock(text: string): Record<string, RGB> {
  const out: Record<string, RGB> = {};
  const re = /--color-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const splitAt = css.indexOf(":root.light");
if (splitAt < 0) throw new Error("contrast.test: could not find :root.light block in globals.css");
const dark = parseBlock(css.slice(0, splitAt));
const light = parseBlock(css.slice(splitAt));

const WHITE: RGB = [255, 255, 255];

// Each case: text token, background (token name | ["over", token, alpha, baseToken]).
type Bg = string | ["over", string, number, string];

function resolveBg(tokens: Record<string, RGB>, bg: Bg): RGB {
  if (Array.isArray(bg)) {
    const [, colorTok, alpha, baseTok] = bg;
    return over(tokens[colorTok], alpha as number, tokens[baseTok]);
  }
  return tokens[bg];
}

interface Case {
  label: string;
  fg: string | "__white__";
  bg: Bg;
}

const darkCases: Case[] = [
  { label: "P1-02 why-line fg-subtle on bg", fg: "fg-subtle", bg: "bg" },
  { label: "P1-02 why-line fg-subtle on panel2", fg: "fg-subtle", bg: "bg-panel2" },
  {
    label: "P1-32 disabled-reason fg-subtle on accent-subtle",
    fg: "fg-subtle",
    bg: "accent-subtle",
  },
  { label: "P2-35 micro fg-muted on panel2", fg: "fg-muted", bg: "bg-panel2" },
  { label: "P2-23 selected-card fg-muted on accent-subtle", fg: "fg-muted", bg: "accent-subtle" },
];

const lightCases: Case[] = [
  { label: "P2-34 empty-state fg-subtle on panel", fg: "fg-subtle", bg: "bg-panel" },
  { label: "P1-38 recovery fg-subtle on bg", fg: "fg-subtle", bg: "bg" },
  { label: "P2-35 fg-muted on panel", fg: "fg-muted", bg: "bg-panel" },
  { label: "P1-35 settings warn on panel", fg: "warn", bg: "bg-panel" },
  { label: "P1-32 warn on white card", fg: "warn", bg: "bg-panel2" },
  {
    label: "P1-32 Needs-review label warn on warn/10",
    fg: "warn",
    bg: ["over", "warn", 0.1, "bg-panel"],
  },
  { label: "P1-32 saved success on bg", fg: "success", bg: "bg" },
  { label: "P1-27 diff-add success on panel", fg: "success", bg: "bg-panel" },
  { label: "P1-27 diff-del danger on panel", fg: "danger", bg: "bg-panel" },
  { label: "P2-29 criterion-id accent on white", fg: "accent", bg: "bg-panel2" },
  { label: "P1-27 links accent on panel", fg: "accent", bg: "bg-panel" },
  { label: "P2-36 SUPERVISED accent on accent-subtle", fg: "accent", bg: "accent-subtle" },
  { label: "primary button white on accent", fg: "__white__", bg: "accent" },
  { label: "primary button white on accent-hover", fg: "__white__", bg: "accent-hover" },
  { label: "primary button white on accent-active", fg: "__white__", bg: "accent-active" },
  // Pervasive status-chip / Badge pattern: text-X on a bg-X/{10,15} tint. These
  // were sub-AA before S-044; the darkened tokens must clear them too.
  { label: "chip accent on accent/10", fg: "accent", bg: ["over", "accent", 0.1, "bg-panel"] },
  {
    label: "badge success on success/15",
    fg: "success",
    bg: ["over", "success", 0.15, "bg-panel"],
  },
  { label: "chip success on success/10", fg: "success", bg: ["over", "success", 0.1, "bg-panel"] },
  { label: "badge warn on warn/15", fg: "warn", bg: ["over", "warn", 0.15, "bg-panel"] },
  { label: "badge info on info/15", fg: "info", bg: ["over", "info", 0.15, "bg-panel"] },
  { label: "chip info on info/10", fg: "info", bg: ["over", "info", 0.1, "bg-panel"] },
  { label: "badge danger on danger/15", fg: "danger", bg: ["over", "danger", 0.15, "bg-panel"] },
  { label: "chip danger on danger/10", fg: "danger", bg: ["over", "danger", 0.1, "bg-panel"] },
];

function run(tokens: Record<string, RGB>, cases: Case[]) {
  for (const c of cases) {
    it(`${c.label} >= ${AA}:1`, () => {
      const fg = c.fg === "__white__" ? WHITE : tokens[c.fg];
      expect(fg, `missing token ${c.fg}`).toBeDefined();
      const bg = resolveBg(tokens, c.bg);
      expect(bg, `missing bg ${JSON.stringify(c.bg)}`).toBeDefined();
      const ratio = contrast(fg, bg);
      expect(ratio, `${c.label}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });
  }
}

describe("WCAG AA contrast — dark theme (default)", () => {
  run(dark, darkCases);
});

describe("WCAG AA contrast — light theme (OS opt-in)", () => {
  run(light, lightCases);
});

describe("foreground tier ordering preserved", () => {
  it("dark: fg brighter than fg-muted brighter than fg-subtle", () => {
    expect(luminance(dark.fg)).toBeGreaterThan(luminance(dark["fg-muted"]));
    expect(luminance(dark["fg-muted"])).toBeGreaterThan(luminance(dark["fg-subtle"]));
  });
  it("light: fg darker than fg-muted darker than fg-subtle (more subtle = lighter)", () => {
    expect(luminance(light.fg)).toBeLessThan(luminance(light["fg-muted"]));
    expect(luminance(light["fg-muted"])).toBeLessThan(luminance(light["fg-subtle"]));
  });
});
