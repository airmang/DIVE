import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headCommit } from "./git.mjs";
import { loadLedger } from "./load.mjs";
import { applyDraft, commitWrites, createDraft, defaultPlatform, slugify } from "./run.mjs";

const CLI = fileURLToPath(new URL("./run.mjs", import.meta.url));

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-ledger-run-"));
  tempDirs.push(dir);
  return dir;
};

function scenario(id) {
  return {
    id,
    title: id,
    source: { kind: "ledger", ref: "x" },
    areas: ["supervision"],
    pathGlobs: [],
    priority: "P1",
  };
}

function defect(id, overrides = {}) {
  return {
    id,
    title: id,
    status: "fixed",
    severity: "P2",
    area: "supervision",
    source: { kind: "review", ref: "r" },
    fixCommit: "aaaaaaa",
    guard: { kind: "cargo", ref: "a::b" },
    created: "2026-09-01",
    updated: "2026-09-01",
    ...overrides,
  };
}

function ledgerOf({ scenarios = [], defects = [], runs = [] }) {
  const entries = (records, dir) =>
    records.map((record) => ({ file: `${dir}/${record.id}.json`, record }));
  const ledger = {
    scenarios: entries(scenarios, "scenarios"),
    defects: entries(defects, "defects"),
    runs: entries(runs, "runs"),
  };
  ledger.byId = Object.fromEntries(
    ["scenarios", "defects", "runs"].map((k) => [
      k,
      new Map(ledger[k].map((e) => [e.record.id, e])),
    ]),
  );
  return ledger;
}

const BUILD = { version: "1.0.0-rc.11", commit: "bbbbbbb" };

function draftFor(ledger, overrides = {}) {
  const { draft } = createDraft(ledger, {
    scenarios: ["SUP-01", "SUP-02"],
    build: BUILD,
    date: "2026-09-29",
    platform: "macos-arm64",
  });
  return { ...draft, ...overrides };
}

describe("createDraft", () => {
  it("builds an id from date + slug and TODO results per scenario", () => {
    const ledger = ledgerOf({ scenarios: [scenario("SUP-01"), scenario("SUP-02")] });
    const { draft, errors } = createDraft(ledger, {
      scenarios: ["SUP-01", "SUP-02", "SUP-01"],
      build: BUILD,
      date: "2026-09-29",
      platform: "macos-arm64",
    });
    expect(errors).toEqual([]);
    expect(draft.id).toBe("2026-09-29-1-0-0-rc-11");
    expect(draft.build).toEqual(BUILD);
    expect(draft.scenarios.map((s) => [s.id, s.result])).toEqual([
      ["SUP-01", "TODO"],
      ["SUP-02", "TODO"],
    ]);
  });

  it("rejects unknown scenarios, no scenarios and an existing run id", () => {
    const run = { id: "2026-09-29-smoke" };
    const ledger = ledgerOf({ scenarios: [scenario("SUP-01")], runs: [run] });
    const args = { build: BUILD, date: "2026-09-29", platform: "p", slug: "smoke" };
    expect(createDraft(ledger, { ...args, scenarios: ["NOPE-01"] }).errors).toContain(
      'unknown scenario "NOPE-01"',
    );
    expect(createDraft(ledger, { ...args, scenarios: [] }).errors[0]).toMatch(/at least one/);
    expect(createDraft(ledger, { ...args, scenarios: ["SUP-01"] }).errors[0]).toMatch(
      /already exists/,
    );
  });

  it("slugifies and names the platform", () => {
    expect(slugify(" RC.11 Smoke! ")).toBe("rc-11-smoke");
    expect(defaultPlatform("darwin", "arm64")).toBe("macos-arm64");
    expect(defaultPlatform("win32", "x64")).toBe("windows-x64");
  });
});

describe("applyDraft", () => {
  const hashFile = vi.fn(() => "c".repeat(64));

  it("refuses unfinished results", () => {
    const ledger = ledgerOf({ scenarios: [scenario("SUP-01"), scenario("SUP-02")] });
    const { errors } = applyDraft(ledger, draftFor(ledger), { isAncestor: () => true, hashFile });
    expect(errors).toEqual([
      "scenario SUP-01: result must be one of pass | fail | blocked | skipped",
      "scenario SUP-02: result must be one of pass | fail | blocked | skipped",
    ]);
  });

  it("opens new defects, verifies fixed ones, hashes evidence and sets lastPass", () => {
    const ledger = ledgerOf({
      scenarios: [scenario("SUP-01"), scenario("SUP-02")],
      defects: [
        defect("DEF-0007"),
        defect("DEF-0003", { guard: { kind: "live-scenario", ref: "SUP-01" } }),
      ],
    });
    const draft = draftFor(ledger, {
      scenarios: [
        { id: "SUP-01", result: "pass", notes: "" },
        { id: "SUP-02", result: "fail", notes: "card never rendered" },
      ],
      opened: [{ title: "Card missing", severity: "P1", area: "supervision", repro: "SUP-02" }],
      verify: ["DEF-0007", "DEF-0003"],
      evidence: ["shots/sup-01.png"],
    });
    const isAncestor = vi.fn(() => true);
    const { writes, errors } = applyDraft(ledger, draft, { isAncestor, hashFile });
    expect(errors).toEqual([]);
    expect(isAncestor).toHaveBeenCalledWith("aaaaaaa", "bbbbbbb");
    const byPath = Object.fromEntries(writes.map((w) => [w.path, w.record]));
    expect(byPath["defects/DEF-0008.json"]).toMatchObject({
      status: "open",
      source: { kind: "live-run", ref: draft.id },
      repro: "SUP-02",
    });
    expect(byPath["defects/DEF-0007.json"]).toMatchObject({
      status: "verified",
      updated: "2026-09-29",
      verified: {
        commit: "bbbbbbb",
        buildVersion: "1.0.0-rc.11",
        date: "2026-09-29",
        evidence: [{ path: "shots/sup-01.png", sha256: "c".repeat(64) }],
      },
    });
    expect(byPath["scenarios/SUP-01.json"].lastPass).toEqual({
      runId: draft.id,
      date: "2026-09-29",
    });
    expect(byPath["scenarios/SUP-02.json"]).toBeUndefined();
    expect(byPath[`runs/${draft.id}.json`]).toMatchObject({
      defectsOpened: ["DEF-0008"],
      defectsVerified: ["DEF-0007", "DEF-0003"],
      scenarios: [
        { id: "SUP-01", result: "pass" },
        { id: "SUP-02", result: "fail", notes: "card never rendered" },
      ],
    });
  });

  it("refuses to verify without proof the build contains the fix", () => {
    const ledger = ledgerOf({
      scenarios: [scenario("SUP-01"), scenario("SUP-02")],
      defects: [
        defect("DEF-0001"),
        defect("DEF-0002", { fixCommit: undefined }),
        defect("DEF-0003", { status: "open", guard: undefined }),
        defect("DEF-0004", { guard: { kind: "live-scenario", ref: "SUP-02" } }),
      ],
    });
    const draft = draftFor(ledger, {
      scenarios: [
        { id: "SUP-01", result: "pass" },
        { id: "SUP-02", result: "blocked" },
      ],
      verify: ["DEF-0001", "DEF-0002", "DEF-0003", "DEF-0004", "DEF-0099"],
    });
    const isAncestor = (fix) => fix !== "aaaaaaa";
    const { errors } = applyDraft(ledger, draft, { isAncestor, hashFile });
    expect(errors).toEqual([
      "verify DEF-0001: build bbbbbbb does not contain fix commit aaaaaaa",
      "verify DEF-0002: no fixCommit, so this build cannot be shown to contain the fix",
      'verify DEF-0003: status is "open", only "fixed" can become verified',
      "verify DEF-0004: build bbbbbbb does not contain fix commit aaaaaaa",
      "verify DEF-0099: unknown defect",
    ]);
    const passing = applyDraft(ledger, draft, { isAncestor: () => true, hashFile }).errors;
    expect(passing).toContain(
      "verify DEF-0004: its guard scenario SUP-02 did not pass in this run",
    );
  });

  it("reports opened-defect schema problems and missing evidence", () => {
    const ledger = ledgerOf({ scenarios: [scenario("SUP-01"), scenario("SUP-02")] });
    const draft = draftFor(ledger, {
      scenarios: [
        { id: "SUP-01", result: "pass" },
        { id: "SUP-02", result: "pass" },
      ],
      opened: [{ title: "x", severity: "P5", area: "supervision" }],
      evidence: ["missing.png"],
    });
    const failingHash = () => {
      throw new Error("file does not exist");
    };
    const { errors } = applyDraft(ledger, draft, { isAncestor: () => true, hashFile: failingHash });
    expect(errors).toContain("evidence missing.png: file does not exist");
    expect(errors.some((e) => e.startsWith("opened[0]: $.severity: must be one of"))).toBe(true);
  });
});

describe("commitWrites", () => {
  function tempLedger() {
    const root = tempDir();
    writeFileSync(join(root, "README.md"), "#");
    for (const dir of ["defects", "scenarios", "runs"]) mkdirSync(join(root, dir));
    return root;
  }

  it("writes nothing when the resulting ledger would be invalid", () => {
    const root = tempLedger();
    const errors = commitWrites(root, [
      { path: "scenarios/SUP-01.json", record: scenario("SUP-01") },
      { path: "defects/DEF-0001.json", record: defect("DEF-0001", { guard: undefined }) },
    ]);
    expect(errors.some((e) => e.includes("$.guard: is required"))).toBe(true);
    expect(existsSync(join(root, "scenarios/SUP-01.json"))).toBe(false);
  });

  it("writes every record when the result validates", () => {
    const root = tempLedger();
    expect(
      commitWrites(root, [{ path: "scenarios/SUP-01.json", record: scenario("SUP-01") }]),
    ).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, "scenarios/SUP-01.json"), "utf8")).id).toBe("SUP-01");
  });
});

describe("qa:run CLI", () => {
  it(
    "init → fill → apply records a run, verifies a defect and sets lastPass",
    { timeout: 30_000 },
    () => {
      const root = tempDir();
      const head = headCommit();
      const write = (path, record) => writeFileSync(join(root, path), JSON.stringify(record));
      for (const dir of ["defects", "scenarios", "runs"]) mkdirSync(join(root, dir));
      write("scenarios/SUP-01.json", scenario("SUP-01"));
      write("defects/DEF-0001.json", defect("DEF-0001", { fixCommit: head }));
      const draftPath = join(root, "draft.json");

      const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
      const init = run(
        "init",
        "--root",
        root,
        "--scenarios",
        "SUP-01",
        "--slug",
        "t",
        "--out",
        draftPath,
      );
      expect(init.status, init.stderr).toBe(0);

      const draft = JSON.parse(readFileSync(draftPath, "utf8"));
      expect(draft.build.commit).toBe(head);
      draft.scenarios[0].result = "pass";
      draft.verify = ["DEF-0001"];
      draft.evidence = ["dive/package.json"];
      writeFileSync(draftPath, JSON.stringify(draft));

      const apply = run("apply", draftPath, "--root", root);
      expect(apply.status, apply.stderr).toBe(0);
      const ledger = loadLedger(root);
      expect(ledger.errors).toEqual([]);
      expect(ledger.byId.defects.get("DEF-0001").record.status).toBe("verified");
      expect(ledger.byId.scenarios.get("SUP-01").record.lastPass.runId).toBe(draft.id);
      expect(ledger.byId.runs.get(draft.id).record.evidence[0].sha256).toMatch(/^[0-9a-f]{64}$/);

      expect(run("apply", draftPath, "--root", root).status).toBe(1);
    },
  );
});
