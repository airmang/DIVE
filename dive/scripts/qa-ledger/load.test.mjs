import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AREAS, matchesGlob, scenarioGlobs } from "./areas.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger, nextDefectId } from "./load.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const tempRoots = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function ledgerWith(files) {
  const root = mkdtempSync(join(tmpdir(), "qa-ledger-"));
  tempRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

function defect(id, overrides = {}) {
  return {
    id,
    title: `Defect ${id}`,
    status: "open",
    severity: "P2",
    area: "chat",
    source: { kind: "user", ref: "owner report" },
    created: "2026-09-29",
    updated: "2026-09-29",
    ...overrides,
  };
}

function scenario(id, overrides = {}) {
  return {
    id,
    title: `Scenario ${id}`,
    source: { kind: "ledger", ref: "docs/qa/ledger/README.md" },
    areas: ["chat"],
    pathGlobs: [],
    priority: "P1",
    ...overrides,
  };
}

describe("loadLedger", () => {
  it("treats missing collection directories as empty", () => {
    const ledger = loadLedger(ledgerWith({ "README.md": "# ledger" }));
    expect(ledger.errors).toEqual([]);
    expect(ledger.defects).toEqual([]);
    expect(nextDefectId(ledger)).toBe("DEF-0001");
  });

  it("reports a missing ledger root", () => {
    const ledger = loadLedger(join(tmpdir(), "qa-ledger-does-not-exist"));
    expect(ledger.errors[0]).toMatch(/ledger root does not exist/);
  });

  it("prefixes record errors with the file and flags filename/id mismatch", () => {
    const root = ledgerWith({
      "defects/DEF-0001.json": defect("DEF-0002", { severity: "P9" }),
    });
    const { errors } = loadLedger(root);
    expect(errors.some((e) => e.startsWith("defects/DEF-0001.json: $.severity: must be"))).toBe(
      true,
    );
    expect(errors).toContain(
      'defects/DEF-0001.json: filename must be "DEF-0002.json" to match $.id',
    );
  });

  it("detects duplicate ids", () => {
    const root = ledgerWith({
      "scenarios/CHAT-01.json": scenario("CHAT-01"),
      "scenarios/CHAT-01-copy.json": scenario("CHAT-01"),
    });
    const { errors } = loadLedger(root);
    expect(errors).toContain(
      'scenarios/CHAT-01.json: duplicate id "CHAT-01" (also in scenarios/CHAT-01-copy.json)',
    );
  });

  it("reports invalid JSON and stray non-JSON files", () => {
    const root = ledgerWith({
      "defects/DEF-0001.json": "{ not json",
      "defects/DEF-0002.yaml": "id: DEF-0002",
      "defects/README.md": "allowed",
    });
    const { errors } = loadLedger(root);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^defects\/DEF-0001\.json: invalid JSON/);
    expect(errors[1]).toBe("defects/DEF-0002.yaml: only <id>.json records belong in defects/");
  });

  it("checks cross-record references", () => {
    const root = ledgerWith({
      "defects/DEF-0001.json": defect("DEF-0001", {
        status: "duplicate",
        duplicateOf: "DEF-0009",
      }),
      "defects/DEF-0002.json": defect("DEF-0002", {
        status: "duplicate",
        duplicateOf: "DEF-0001",
      }),
      "defects/DEF-0003.json": defect("DEF-0003", {
        status: "fixed",
        guard: { kind: "live-scenario", ref: "SUP-09" },
      }),
      "scenarios/CHAT-01.json": scenario("CHAT-01", {
        lastPass: { runId: "2026-09-28-missing", date: "2026-09-28" },
      }),
      "runs/2026-09-29-smoke.json": {
        id: "2026-09-29-smoke",
        date: "2026-09-29",
        build: { version: "1.0.0-rc.10", commit: "f371910c" },
        platform: "macos-arm64",
        scenarios: [
          { id: "CHAT-01", result: "pass" },
          { id: "CHAT-02", result: "fail" },
        ],
        defectsOpened: ["DEF-0042"],
        defectsVerified: ["DEF-0003"],
        evidence: [],
      },
    });
    const { errors } = loadLedger(root);
    expect(errors).toEqual([
      'defects/DEF-0001.json: $.duplicateOf: unknown defect "DEF-0009"',
      'defects/DEF-0002.json: $.duplicateOf: "DEF-0001" is itself a duplicate',
      'defects/DEF-0003.json: $.guard.ref: unknown scenario "SUP-09"',
      'scenarios/CHAT-01.json: $.lastPass.runId: unknown run "2026-09-28-missing"',
      'runs/2026-09-29-smoke.json: $.scenarios[1].id: unknown scenario "CHAT-02"',
      'runs/2026-09-29-smoke.json: $.defectsOpened[0]: unknown defect "DEF-0042"',
    ]);
  });

  it("allocates the next defect id past the highest existing one", () => {
    const root = ledgerWith({
      "defects/DEF-0001.json": defect("DEF-0001"),
      "defects/DEF-0007.json": defect("DEF-0007"),
    });
    expect(nextDefectId(loadLedger(root))).toBe("DEF-0008");
  });
});

describe("real ledger (docs/qa/ledger)", () => {
  it("validates with zero errors", () => {
    const ledger = loadLedger(DEFAULT_LEDGER_ROOT);
    expect(ledger.errors).toEqual([]);
    expect(ledger.scenarios.length).toBeGreaterThan(0);
  });
});

describe("area table", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  it("has globs that each match at least one tracked file", () => {
    const orphaned = [];
    for (const [area, globs] of Object.entries(AREAS)) {
      for (const glob of globs) {
        if (!tracked.some((file) => matchesGlob(file, glob))) orphaned.push(`${area}: ${glob}`);
      }
    }
    expect(orphaned).toEqual([]);
  });

  it("matches `**` across segments and `*` within one", () => {
    expect(matchesGlob("dive/src/a/b/c.ts", "dive/src/**")).toBe(true);
    expect(matchesGlob("dive/src/x.ts", "dive/src/**/x.ts")).toBe(true);
    expect(matchesGlob("dive/src/a/b/x.ts", "dive/src/**/x.ts")).toBe(true);
    expect(matchesGlob("dive/src/a/x.ts", "dive/src/*.ts")).toBe(false);
    expect(matchesGlob("dive/src/plan_a.rs", "dive/src/plan_*.rs")).toBe(true);
    expect(matchesGlob("dive/srcXplan.rs", "dive/src.plan.rs")).toBe(false);
  });

  it("merges a scenario's area globs with its extra pathGlobs", () => {
    const globs = scenarioGlobs({ areas: ["mcp"], pathGlobs: ["dive/src/App.tsx"] });
    expect(globs).toEqual(["dive/src/App.tsx", ...AREAS.mcp]);
  });
});
