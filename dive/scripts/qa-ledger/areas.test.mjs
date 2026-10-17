import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AREAS,
  CROSS_CUTTING_AREA,
  NON_PRODUCT,
  globError,
  globToRegExp,
  isNonProduct,
  matchesGlob,
} from "./areas.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger } from "./load.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const tracked = execFileSync("git", ["-c", "core.quotePath=false", "ls-files"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

describe("glob syntax", () => {
  it("rejects `**` inside a segment", () => {
    expect(globError("dive/src/**")).toBeNull();
    expect(globError("dive/**/x.ts")).toBeNull();
    expect(globError("dive/src**")).toMatch(/whole path segment/);
    expect(globError("dive/**.ts")).toMatch(/whole path segment/);
    expect(() => globToRegExp("dive/a**/b")).toThrow(/invalid glob/);
  });

  it("keeps every area and NON_PRODUCT glob valid", () => {
    const globs = [...Object.values(AREAS).flat(), ...NON_PRODUCT.map(({ glob }) => glob)];
    expect(globs.filter((glob) => globError(glob) !== null)).toEqual([]);
  });

  it("gives every NON_PRODUCT entry a reason", () => {
    expect(NON_PRODUCT.filter(({ reason }) => !reason?.trim())).toEqual([]);
  });
});

describe("area coverage (T071)", () => {
  it("puts every tracked file in an area or NON_PRODUCT, so qa:queue never guesses", () => {
    const globs = Object.values(AREAS).flat();
    const unmapped = tracked.filter(
      (file) => !isNonProduct(file) && !globs.some((glob) => matchesGlob(file, glob)),
    );
    expect(unmapped).toEqual([]);
  });

  it("treats tests, dev-only demo routes and docs as non-product", () => {
    for (const path of [
      "dive/src/hooks/useChatSession.test.ts",
      "dive/src/components/product/StepDetailSlideIn.test.tsx",
      "dive/src-tauri/src/ipc/tests.rs",
      "dive/src/pages/chat-demo.tsx",
      "dive/scripts/qa-ledger/queue.mjs",
      "docs/qa/ledger/README.md",
      "CHANGELOG.md",
    ]) {
      expect(isNonProduct(path), path).toBe(true);
    }
    expect(isNonProduct("dive/package.json")).toBe(true);
    expect(isNonProduct("dive/pnpm-lock.yaml")).toBe(false);
    expect(isNonProduct("dive/src-tauri/Cargo.toml")).toBe(false);
    expect(isNonProduct("dive/src/hooks/useChatSession.ts")).toBe(false);
    expect(isNonProduct("dive/src/pages/settings.tsx")).toBe(false);
  });

  it("lists no scenario under the cross-cutting area", () => {
    const { scenarios } = loadLedger(DEFAULT_LEDGER_ROOT);
    const offenders = scenarios.filter(({ record }) => record.areas.includes(CROSS_CUTTING_AREA));
    expect(offenders.map(({ record }) => record.id)).toEqual([]);
  });
});

describe("scenario area fitness (T071)", () => {
  const { scenarios } = loadLedger(DEFAULT_LEDGER_ROOT);
  const byId = Object.fromEntries(scenarios.map(({ record }) => [record.id, record]));

  it("gives LLM and supervision/verification scenarios the pi-sidecar area", () => {
    const missing = scenarios
      .map(({ record }) => record)
      .filter(
        (s) =>
          (s.requiresLlm || s.areas.includes("supervision") || s.areas.includes("verification")) &&
          !s.areas.includes("pi-sidecar"),
      )
      .map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it("no longer tags STATIC-01 with terminal (its only mention is 'no dev server')", () => {
    expect(byId["STATIC-01"].areas).not.toContain("terminal");
  });

  it("derives journey areas from the journey text instead of one blanket set", () => {
    const journeys = scenarios
      .map(({ record }) => record)
      .filter((s) => s.source.kind === "e2e-journey");
    expect(journeys).toHaveLength(50);
    const distinct = new Set(journeys.map((s) => [...s.areas].sort().join(",")));
    expect(distinct.size).toBeGreaterThan(10);
  });
});
