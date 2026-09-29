import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { formatReport, parseVerifyArgs } from "./verify.mjs";

const CLI = fileURLToPath(new URL("./verify.mjs", import.meta.url));

const tempRoots = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function ledgerWith(files) {
  const root = mkdtempSync(join(tmpdir(), "qa-ledger-verify-"));
  tempRoots.push(root);
  for (const dir of ["defects", "scenarios", "runs"]) mkdirSync(join(root, dir));
  for (const [path, record] of Object.entries(files)) {
    writeFileSync(join(root, path), JSON.stringify(record));
  }
  return root;
}

const SCENARIO = {
  id: "SUP-01",
  title: "Card renders",
  source: { kind: "ledger", ref: "x" },
  areas: ["supervision"],
  pathGlobs: [],
  priority: "P0",
};

const DEFECT = {
  id: "DEF-0001",
  title: "Card parse error",
  status: "fixed",
  severity: "P1",
  area: "supervision",
  source: { kind: "live-run", ref: "2026-09-20-rc11" },
  guard: { kind: "live-scenario", ref: "SUP-01" },
  created: "2026-09-10",
  updated: "2026-09-10",
};

const RUN = {
  id: "2026-09-20-rc11",
  date: "2026-09-20",
  startedAt: "2026-09-20T10:00:00Z",
  build: { version: "1.0.0-rc.11", commit: "f371910c", dirty: false },
  platform: "macos-arm64",
  scenarios: [{ id: "SUP-01", result: "pass" }],
  defectsOpened: [],
  defectsVerified: [],
  evidence: [],
};

const runCli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

describe("parseVerifyArgs", () => {
  it("defaults to every kind and accepts a --kinds subset (with pnpm's bare --)", () => {
    expect(parseVerifyArgs([]).kinds).toEqual(["vitest", "cargo", "live-scenario", "eval-fixture"]);
    expect(parseVerifyArgs(["--", "--kinds", "vitest, eval-fixture"]).kinds).toEqual([
      "vitest",
      "eval-fixture",
    ]);
  });

  it("rejects unknown kinds, missing values and unknown flags", () => {
    expect(() => parseVerifyArgs(["--kinds", "vitest,jest"])).toThrow(/--kinds takes/);
    expect(() => parseVerifyArgs(["--kinds"])).toThrow(/--kinds needs a value/);
    expect(() => parseVerifyArgs(["--root", "--kinds", "cargo"])).toThrow(/--root needs a value/);
    expect(() => parseVerifyArgs(["--all"])).toThrow(/unknown argument/);
    expect(() => parseVerifyArgs(["--cargo-dir"])).toThrow(/--cargo-dir needs a value/);
    expect(parseVerifyArgs(["--cargo-dir", "/tmp/wt/dive/src-tauri"]).cargoDir).toBe(
      "/tmp/wt/dive/src-tauri",
    );
  });
});

describe("formatReport", () => {
  it("summarizes per kind and lists each failure", () => {
    const failure = {
      id: "DEF-0002",
      kind: "cargo",
      ref: "db::tests::slow",
      outcome: "ignored",
      detail: "test is #[ignore]d",
    };
    const lines = formatReport({
      results: [
        { id: "DEF-0001", kind: "vitest", ref: "a", outcome: "resolved" },
        failure,
        { id: "DEF-0003", kind: "live-scenario", ref: "SUP-01", outcome: "not-checked" },
      ],
      failed: [failure],
    });
    expect(lines).toEqual([
      "  vitest: 1 resolved, 0 unresolved, 0 ignored",
      "  cargo: 0 resolved, 0 unresolved, 1 ignored",
      "  live-scenario: 1 not checked (excluded by --kinds)",
      "  FAIL DEF-0002 [cargo] db::tests::slow — test is #[ignore]d",
    ]);
  });
});

describe("verify:qa-ledger CLI", () => {
  it("exits 0 when every checked guard resolves", () => {
    const root = ledgerWith({
      "scenarios/SUP-01.json": SCENARIO,
      "defects/DEF-0001.json": DEFECT,
      "runs/2026-09-20-rc11.json": RUN,
    });
    const result = runCli("--root", root, "--kinds", "live-scenario");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("live-scenario: 1 resolved, 0 unresolved, 0 ignored");
  });

  it("exits 1 on an unresolved guard", () => {
    const root = ledgerWith({
      "scenarios/SUP-01.json": SCENARIO,
      "defects/DEF-0001.json": { ...DEFECT, updated: "2026-09-25" },
      "runs/2026-09-20-rc11.json": RUN,
    });
    const result = runCli("--root", root, "--kinds", "live-scenario");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "FAIL DEF-0001 [live-scenario] SUP-01 — 1 run(s) of SUP-01, none dated on/after 2026-09-25",
    );
  });

  it("exits 1 on schema problems before resolving anything", () => {
    const root = ledgerWith({ "defects/DEF-0001.json": { ...DEFECT, guard: undefined } });
    const result = runCli("--root", root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("schema problem(s)");
  });

  it("exits 2 on bad arguments", () => {
    expect(runCli("--kinds", "nope").status).toBe(2);
  });
});
