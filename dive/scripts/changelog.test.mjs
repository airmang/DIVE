// Guard for DEF-0017: CHANGELOG link definitions drifted behind the released
// versions twice (stale at rc.4, then at rc.9). Every version heading needs a
// link definition, and [Unreleased] must compare from the newest release.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const changelog = readFileSync(
  fileURLToPath(new URL("../../CHANGELOG.md", import.meta.url)),
  "utf8",
);

// `## [Yanked] 1.0.0-rc.1 — …` names its version after the bracket.
const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?: (\S+))?/gm)].map((m) =>
  m[1] === "Yanked" ? m[2] : m[1],
);
const linkDefs = new Map(
  [...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1], m[2]]),
);

describe("CHANGELOG link definitions", () => {
  it("defines a link for every version heading", () => {
    const missing = headings.filter((heading) => !linkDefs.has(heading));
    expect(missing).toEqual([]);
  });

  it("compares [Unreleased] from the newest released version", () => {
    const newest = headings.find((heading) => heading !== "Unreleased");
    expect(newest).toBeDefined();
    expect(linkDefs.get("Unreleased")).toMatch(
      new RegExp(`/compare/v${newest.replace(/\./g, "\\.")}\\.\\.\\.HEAD$`),
    );
  });

  it("ends the newest release's compare range at its own tag", () => {
    const newest = headings.find((heading) => heading !== "Unreleased");
    expect(linkDefs.get(newest)).toMatch(new RegExp(`\\.\\.\\.v${newest.replace(/\./g, "\\.")}$`));
  });
});
