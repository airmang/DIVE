import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyFiles,
  parseQueueArgs,
  reasonKind,
  renderWorkOrder,
  selectScenarios,
} from "./queue.mjs";

const CLI = fileURLToPath(new URL("./queue.mjs", import.meta.url));

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const changed = (...paths) => paths.map((path) => ({ path, deleted: false }));
const deleted = (...paths) => paths.map((path) => ({ path, deleted: true }));

function scenario(id, overrides = {}) {
  return {
    id,
    title: `Scenario ${id}`,
    source: { kind: "ledger", ref: "x" },
    areas: ["chat"],
    pathGlobs: [],
    priority: "P1",
    lastPass: { runId: "2026-09-20-base", date: "2026-09-20" },
    ...overrides,
  };
}

function ledgerOf({ scenarios = [], defects = [], runs = [] }) {
  const entries = (records) => records.map((record) => ({ file: record.id, record }));
  const ledger = {
    scenarios: entries(scenarios),
    defects: entries(defects),
    runs: entries(runs),
  };
  ledger.byId = Object.fromEntries(
    ["scenarios", "defects", "runs"].map((k) => [
      k,
      new Map(ledger[k].map((e) => [e.record.id, e])),
    ]),
  );
  return ledger;
}

const BASE_RUN = { id: "2026-09-20-base", date: "2026-09-20", build: { commit: "base123" } };
const TODAY = "2026-09-29";

function select(ledger, options = {}) {
  const diff = options.diff ?? vi.fn(() => []);
  const result = selectScenarios(ledger, { today: TODAY, changedFilesSince: diff, ...options });
  return {
    diff,
    ...result,
    reasonsOf: Object.fromEntries(
      result.selected.map(({ scenario, reasons }) => [scenario.id, reasons]),
    ),
  };
}

describe("classifyFiles", () => {
  it("separates non-product, cross-cutting, mapped, unmapped and deleted-unmapped paths", () => {
    const out = classifyFiles([
      ...changed(
        "dive/src/hooks/useChatSession.test.ts",
        "docs/qa/ledger/README.md",
        "dive/src-tauri/src/lib.rs",
        "dive/src/hooks/useChatSession.ts",
        "dive/src/brand-new-module.ts",
        "dive/src/한글-파일.ts",
      ),
      ...deleted("dive/src/components/product/architectureLabels.ts"),
    ]);
    expect(out).toEqual({
      nonProduct: ["dive/src/hooks/useChatSession.test.ts", "docs/qa/ledger/README.md"],
      crossCutting: ["dive/src-tauri/src/lib.rs"],
      mapped: ["dive/src/hooks/useChatSession.ts"],
      unmapped: ["dive/src/brand-new-module.ts", "dive/src/한글-파일.ts"],
      deletedUnmapped: ["dive/src/components/product/architectureLabels.ts"],
    });
  });
});

describe("selectScenarios", () => {
  it("(a) selects a defect's live-scenario guard, else its 3 narrowest area scenarios", () => {
    const ledger = ledgerOf({
      scenarios: [scenario("CHAT-01"), scenario("SUP-01", { areas: ["supervision"] })],
      defects: [
        { id: "DEF-0001", status: "fixed", area: "chat" },
        {
          id: "DEF-0002",
          status: "fixed",
          area: "i18n",
          guard: { kind: "live-scenario", ref: "SUP-01" },
        },
        { id: "DEF-0003", status: "verified", area: "supervision" },
      ],
      runs: [BASE_RUN],
    });
    const { reasonsOf } = select(ledger);
    expect(reasonsOf["CHAT-01"]).toEqual([
      "can verify fixed DEF-0001 (narrowest scenario in the defect's area)",
    ]);
    expect(reasonsOf["SUP-01"]).toEqual(["verifies fixed DEF-0002 (its live-scenario guard)"]);
  });

  it("(a) caps area-matched scenarios per defect at the 3 narrowest", () => {
    const wide = ["chat", "prd", "plan", "roadmap"];
    const ledger = ledgerOf({
      scenarios: [
        scenario("J-01", { areas: wide }),
        scenario("J-02", { areas: ["chat", "prd"], priority: "P2" }),
        scenario("J-03", { areas: ["chat", "prd"], priority: "P0" }),
        scenario("J-04", { areas: ["chat"] }),
        scenario("J-05", { areas: wide }),
      ],
      defects: [
        { id: "DEF-0001", status: "fixed", area: "chat", guard: { kind: "cargo", ref: "a::b" } },
      ],
      runs: [BASE_RUN],
    });
    const { reasonsOf } = select(ledger);
    expect(Object.keys(reasonsOf).sort()).toEqual(["J-02", "J-03", "J-04"]);
  });

  it("(b) selects and warns when a base commit can't be diffed, instead of aborting", () => {
    const ledger = ledgerOf({
      scenarios: [scenario("CHAT-01"), scenario("CHAT-02", { lastPass: undefined })],
      runs: [BASE_RUN],
    });
    const diff = () => {
      throw new Error("git diff --name-status base123 HEAD failed: bad object base123");
    };
    const { reasonsOf, warnings } = select(ledger, { diff });
    expect(reasonsOf["CHAT-01"]).toEqual([
      "base commit base123 unknown — cannot diff since its last pass",
    ]);
    expect(warnings).toEqual([
      "cannot diff from base123 (git diff --name-status base123 HEAD failed: bad object base123); " +
        "scenarios based on it were selected. Fetch full history or pass --since <ref>.",
    ]);
  });

  it("(b) diffs each scenario from its lastPass build, or everything from --since", () => {
    const ledger = ledgerOf({
      scenarios: [scenario("CHAT-01"), scenario("REC-01", { areas: ["recovery"] })],
      runs: [BASE_RUN],
    });
    const diff = vi.fn(() => changed("dive/src/hooks/useChatSession.ts", "docs/x.md"));
    const perScenario = select(ledger, { diff });
    expect(diff).toHaveBeenCalledTimes(1);
    expect(diff).toHaveBeenCalledWith("base123");
    expect(perScenario.reasonsOf).toEqual({
      "CHAT-01": ["its areas changed since base123: dive/src/hooks/useChatSession.ts"],
    });

    const sinceDiff = vi.fn(() => changed("dive/src-tauri/src/checkpoint/mod.rs"));
    const since = select(ledger, { diff: sinceDiff, since: "HEAD~3" });
    expect(sinceDiff).toHaveBeenCalledWith("HEAD~3");
    expect(Object.keys(since.reasonsOf)).toEqual(["REC-01"]);
  });

  it("(c) selects never-passed and stale scenarios", () => {
    const ledger = ledgerOf({
      scenarios: [
        scenario("CHAT-01", { lastPass: undefined }),
        scenario("CHAT-02", { lastPass: { runId: "2026-08-01-old", date: "2026-08-01" } }),
        scenario("CHAT-03"),
      ],
      runs: [BASE_RUN, { id: "2026-08-01-old", date: "2026-08-01", build: { commit: "old1234" } }],
    });
    const { reasonsOf } = select(ledger);
    expect(reasonsOf["CHAT-01"]).toEqual(["never passed in a recorded run"]);
    expect(reasonsOf["CHAT-02"]).toEqual(["last pass 2026-08-01 (59 days ago)"]);
    expect(reasonsOf["CHAT-03"]).toBeUndefined();
    expect(select(ledger, { staleDays: 60 }).reasonsOf["CHAT-02"]).toBeUndefined();
  });

  it("(d) selects every scenario on a cross-cutting or unmapped change and warns on unmapped", () => {
    const ledger = ledgerOf({
      scenarios: [scenario("CHAT-01"), scenario("REC-01", { areas: ["recovery"] })],
      runs: [BASE_RUN],
    });
    const cross = select(ledger, { diff: () => changed("dive/src-tauri/src/lib.rs") });
    expect(Object.keys(cross.reasonsOf)).toEqual(["CHAT-01", "REC-01"]);
    expect(cross.warnings).toEqual([]);

    const unmapped = select(ledger, { diff: () => changed("dive/src/brand-new.ts") });
    expect(Object.keys(unmapped.reasonsOf)).toEqual(["CHAT-01", "REC-01"]);
    expect(unmapped.warnings[0]).toMatch(/map to no area \(dive\/src\/brand-new\.ts\).*areas\.mjs/);

    const gone = select(ledger, { diff: () => deleted("dive/src/old.ts") });
    expect(Object.keys(gone.reasonsOf)).toEqual(["CHAT-01", "REC-01"]);
    expect(gone.warnings[0]).toMatch(/deleted since base123 matched no current area/);
  });

  it("ignores non-product-only changes and sorts by priority then id", () => {
    const ledger = ledgerOf({
      scenarios: [
        scenario("B-01", { priority: "P2", lastPass: undefined }),
        scenario("A-01", { priority: "P2", lastPass: undefined }),
        scenario("Z-01", { priority: "P0", lastPass: undefined }),
        scenario("CHAT-01"),
      ],
      runs: [BASE_RUN],
    });
    const { selected } = select(ledger, { diff: () => changed("dive/src/App.test.tsx") });
    expect(selected.map(({ scenario: s }) => s.id)).toEqual(["Z-01", "A-01", "B-01"]);
  });
});

describe("renderWorkOrder", () => {
  it("includes the recipe, the qa:run command, reasons, steps and expected results", () => {
    const md = renderWorkOrder(
      {
        selected: [
          {
            scenario: scenario("SUP-01", {
              title: "Card renders",
              priority: "P0",
              requiresLlm: true,
              preconditions: "Session at verify",
              steps: ["Drive a step to verify", "Observe the card"],
              expected: "Card with evidence",
            }),
            reasons: ["never passed in a recorded run"],
          },
        ],
        warnings: ["1 changed file(s) map to no area"],
      },
      { date: TODAY, head: "abc1234", since: "HEAD~2", staleDays: 30, total: 104 },
    );
    expect(md).toContain("`pnpm qa:queue --since HEAD~2` at HEAD `abc1234`");
    expect(md).toContain("1 of 104 scenarios selected (1 need a live LLM call)");
    expect(md).toContain("## Warnings\n\n- 1 changed file(s) map to no area");
    expect(md).toContain("pnpm tauri build --bundles app");
    expect(md).toContain("DIVE_SESSION_ORIGIN=qa DIVE_QA_APP_DATA_DIR=/tmp/dive-qa-2026-09-29");
    expect(md).toContain("computer-use");
    expect(md).toContain("`$DIVE_QA_APP_DATA_DIR/session-origin`");
    expect(md).toContain("`pnpm qa:run init --scenarios SUP-01`");
    expect(md).toContain("### SUP-01 — Card renders (P0, LLM)");
    expect(md).toContain("Why:\n- never passed in a recorded run");
    expect(md).toContain("Steps:\n1. Drive a step to verify\n2. Observe the card");
    expect(md).toContain("Expected: Card with evidence");
  });
});

describe("reasonKind", () => {
  it("maps every reason line to its selection rule", () => {
    expect(reasonKind("verifies fixed DEF-0002 (its live-scenario guard)")).toMatch(/^\(a\)/);
    expect(reasonKind("can verify fixed DEF-0001, DEF-0003 (narrowest …)")).toMatch(/^\(a\)/);
    expect(reasonKind("its areas changed since HEAD~1: x")).toMatch(/^\(b\)/);
    expect(reasonKind("base commit abc unknown — cannot diff")).toMatch(/^\(b\)/);
    expect(reasonKind("never passed in a recorded run")).toBe("(c) never passed");
    expect(reasonKind("last pass 2026-08-01 (59 days ago)")).toBe("(c) stale");
    expect(reasonKind("cross-cutting change since HEAD: x")).toMatch(/^\(d\)/);
    expect(reasonKind("unmapped change since HEAD: x")).toMatch(/^\(d\)/);
  });
});

describe("qa:queue CLI", () => {
  it("parses arguments, including pnpm's bare --", () => {
    expect(parseQueueArgs(["--", "--since", "HEAD~3", "--stale-days", "7"])).toMatchObject({
      since: "HEAD~3",
      staleDays: 7,
    });
    expect(() => parseQueueArgs(["--since"])).toThrow(/needs a value/);
    expect(() => parseQueueArgs(["--stale-days", "-1"])).toThrow(/non-negative/);
    expect(() => parseQueueArgs(["--bogus"])).toThrow(/unknown argument/);
  });

  it("writes a work order for the real ledger", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-queue-"));
    tempDirs.push(dir);
    const out = join(dir, "order.md");
    const result = spawnSync(
      process.execPath,
      [CLI, "--since", "HEAD", "--out", out, "--today", TODAY],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/qa:queue: \d+ of \d+ scenario\(s\) selected/);
    expect(readFileSync(out, "utf8")).toMatch(/^# Live QA work order — 2026-09-29/);
  });
});
