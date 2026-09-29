import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AREAS, AREA_NAMES } from "./areas.mjs";
import { loadLedger } from "./load.mjs";
import { validateEvalGateResult } from "./schema.mjs";
import {
  AREA_LABELS_KO,
  clusterDefects,
  designStagePayload,
  evalDefects,
  parseTriageArgs,
  proposedGuard,
  specStub,
} from "./triage.mjs";

const CLI = fileURLToPath(new URL("./triage.mjs", import.meta.url));

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-triage-"));
  tempDirs.push(dir);
  return dir;
};

function defect(id, area, overrides = {}) {
  return {
    id,
    title: `Defect ${id}`,
    status: "open",
    severity: "P2",
    area,
    source: { kind: "review", ref: "docs/qa/post-cleanup-review-2026-07-22.md", findingId: "L1" },
    created: "2026-09-29",
    updated: "2026-09-29",
    ...overrides,
  };
}

const EVAL_RESULT = {
  promptVersion: "1.2.0+abc123",
  baseline: "1.1.0+def456",
  regressions: [
    {
      fixtureId: "verify-ko-work",
      metric: "localeCompliance",
      before: 1,
      after: 0.8,
      severity: "P1",
    },
    {
      fixtureId: "diff-en-guided",
      metric: "criterionLinkage",
      before: 0.9,
      after: 0.7,
      severity: "P2",
      area: "verification",
    },
  ],
};

describe("clusterDefects", () => {
  it("groups open/fixing defects by area and orders clusters by severity then size", () => {
    const clusters = clusterDefects([
      defect("DEF-0001", "plan"),
      defect("DEF-0002", "plan", { status: "fixing" }),
      defect("DEF-0003", "recovery", { severity: "P1" }),
      defect("DEF-0004", "chat", { status: "fixed", guard: { kind: "cargo", ref: "a::b" } }),
      defect("DEF-0005", "chat", { status: "wontfix", notes: "n" }),
    ]);
    expect(clusters.map((c) => [c.id, c.severity, c.priority, c.defects.map((d) => d.id)])).toEqual(
      [
        ["recovery", "P1", 70, ["DEF-0003"]],
        ["plan", "P2", 50, ["DEF-0001", "DEF-0002"]],
      ],
    );
  });

  it("merges areas whose defects share a specRef or stageRef (transitively)", () => {
    const clusters = clusterDefects([
      defect("DEF-0001", "plan", { specRef: "specs/004/spec.md" }),
      defect("DEF-0002", "prd", { specRef: "specs/004/spec.md", stageRef: "S-090" }),
      defect("DEF-0003", "roadmap", { stageRef: "S-090", severity: "P0" }),
      defect("DEF-0004", "chat"),
    ]);
    expect(clusters.map((c) => c.id)).toEqual(["plan+prd+roadmap", "chat"]);
    expect(clusters[0]).toMatchObject({
      areas: ["plan", "prd", "roadmap"],
      severity: "P0",
      priority: 90,
      refs: ["S-090", "specs/004/spec.md"],
    });
    expect(clusters[0].defects.map((d) => d.id)).toEqual(["DEF-0003", "DEF-0001", "DEF-0002"]);
  });
});

describe("drafts", () => {
  const [cluster] = clusterDefects([
    defect("DEF-0004", "recovery", { severity: "P1", repro: "restore | save race" }),
    defect("DEF-0011", "recovery", { guard: { kind: "vitest", ref: "dive/src/a.test.ts::x" } }),
  ]);

  it("builds a strict design_stage payload with a Korean title and area-glob scope", () => {
    const payload = designStagePayload(cluster);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "acceptance",
        "code_changes_expected",
        "dependency_stage_ids",
        "intent",
        "priority",
        "project_id",
        "scope",
        "title",
      ].sort(),
    );
    expect(payload.project_id).toBe("dive-2");
    expect(payload.title).toMatch(/[가-힣]/);
    expect(payload.title).toBe("QA 원장 정비 — 복구·체크포인트 결함 2건 (P1)");
    expect(payload.priority).toBe(70);
    expect(payload.dependency_stage_ids).toEqual([]);
    expect(payload.code_changes_expected).toBe(true);
    expect(payload.acceptance).toHaveLength(3);
    expect(payload.scope.every((s) => s.repo_slug === "airmang/DIVE-2")).toBe(true);
    expect(payload.scope.map((s) => s.path)).toEqual(
      [...AREAS.recovery, "docs/qa/ledger/**"].sort(),
    );
  });

  it("writes a spec-theme stub with source refs, acceptance and guards per defect", () => {
    const md = specStub(cluster, { date: "2026-09-29" });
    expect(md).toMatch(
      /^### Theme — QA 원장 정비 — 복구·체크포인트 결함 2건 \(P1\) → Stage \*\*S-\?\?\?\*\* \(draft\)/,
    );
    expect(md).toContain("| DEF-0004 | P1 | review: post-cleanup-review-2026-07-22.md L1 |");
    expect(md).toContain("DEF-0004 no longer reproduces — Defect DEF-0004");
    expect(md).toContain("vitest `dive/src/a.test.ts::x` (already set)");
    expect(md).toContain("- DEF-0004: restore | save race");
    expect(md).not.toMatch(/\n\n\n/);
  });

  it("proposes a guard kind from where the area's code lives", () => {
    expect(proposedGuard(defect("D", "agent-tools"))).toMatch(/^cargo test/);
    expect(proposedGuard(defect("D", "theme-ui"))).toMatch(/^vitest/);
    expect(proposedGuard(defect("D", "recovery"))).toMatch(/^vitest or cargo/);
    expect(proposedGuard(defect("D", "docs-spec"))).toMatch(/scripts/);
  });

  it("has a Korean label for every area", () => {
    expect(
      AREA_NAMES.filter((area) => !/[가-힣]|^MCP$|^PRD$/.test(AREA_LABELS_KO[area] ?? "")),
    ).toEqual([]);
  });
});

describe("eval-gate regressions", () => {
  const ledgerOf = (defects) => ({
    defects: defects.map((record) => ({ file: record.id, record })),
    byId: { defects: new Map(defects.map((record) => [record.id, { record }])) },
  });

  it("validates the minimal eval-gate result shape", () => {
    expect(validateEvalGateResult(EVAL_RESULT)).toEqual([]);
    const errors = validateEvalGateResult({
      promptVersion: "x",
      regressions: [{ fixtureId: "f", metric: "m", before: "1", after: 0, severity: "P7" }],
    });
    expect(errors).toContain("$.baseline: is required");
    expect(errors).toContain("$.regressions[0].before: must be a number (got string)");
    expect(errors.some((e) => e.startsWith("$.regressions[0].severity: must be one of"))).toBe(
      true,
    );
  });

  it("opens one eval defect per regression with an eval-fixture guard, skipping ones already open", () => {
    const existing = defect("DEF-0007", "supervision", {
      source: { kind: "eval", ref: "old", findingId: "diff-en-guided:criterionLinkage" },
    });
    const { writes, skipped, errors } = evalDefects(ledgerOf([existing]), EVAL_RESULT, {
      date: "2026-09-29",
    });
    expect(errors).toEqual([]);
    expect(skipped).toEqual(["diff-en-guided:criterionLinkage"]);
    expect(writes).toEqual([
      {
        path: "defects/DEF-0008.json",
        record: {
          id: "DEF-0008",
          title: "Eval regression: localeCompliance on verify-ko-work (1 → 0.8) at 1.2.0+abc123",
          status: "open",
          severity: "P1",
          area: "supervision",
          source: {
            kind: "eval",
            ref: "1.2.0+abc123 vs 1.1.0+def456",
            findingId: "verify-ko-work:localeCompliance",
          },
          guard: { kind: "eval-fixture", ref: "verify-ko-work" },
          created: "2026-09-29",
          updated: "2026-09-29",
        },
      },
    ]);
  });

  it("reports an invalid eval-gate result instead of writing", () => {
    const { writes, errors } = evalDefects(
      ledgerOf([]),
      { regressions: [] },
      { date: "2026-09-29" },
    );
    expect(writes).toEqual([]);
    expect(errors).toContain("eval-gate result $.promptVersion: is required");
  });
});

describe("qa:triage CLI", () => {
  it("parses arguments", () => {
    expect(parseTriageArgs(["--", "--json", "--date", "2026-09-29"])).toMatchObject({
      json: true,
      date: "2026-09-29",
    });
    expect(() => parseTriageArgs(["--from-eval"])).toThrow(/needs a value/);
    expect(() => parseTriageArgs(["--date", "29/09"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseTriageArgs(["--bogus"])).toThrow(/unknown argument/);
  });

  it("imports eval regressions through the atomic writer, then drafts every cluster", () => {
    const root = tempDir();
    for (const dir of ["defects", "scenarios", "runs"]) mkdirSync(join(root, dir));
    writeFileSync(join(root, "defects/DEF-0001.json"), JSON.stringify(defect("DEF-0001", "plan")));
    const evalFile = join(tempDir(), "gate.json");
    writeFileSync(evalFile, JSON.stringify(EVAL_RESULT));
    const out = join(tempDir(), "drafts");
    const run = (...extra) =>
      spawnSync(
        process.execPath,
        [CLI, "--root", root, "--out", out, "--date", "2026-09-29", "--json", ...extra],
        { encoding: "utf8" },
      );

    const first = run("--from-eval", evalFile);
    expect(first.status, first.stderr).toBe(0);
    const summary = JSON.parse(first.stdout);
    expect(summary.evalOpened).toEqual(["DEF-0002", "DEF-0003"]);
    expect(summary.clusters.map((c) => c.cluster)).toEqual(["supervision", "plan", "verification"]);
    expect(loadLedger(root).errors).toEqual([]);
    for (const cluster of ["supervision", "plan", "verification"]) {
      expect(existsSync(join(out, `${cluster}.md`))).toBe(true);
      const payload = JSON.parse(readFileSync(join(out, `${cluster}.design_stage.json`), "utf8"));
      expect(payload.title).toMatch(/[가-힣]/);
    }
    expect(readFileSync(join(out, "index.md"), "utf8")).toContain("Drafts only");

    const again = run("--from-eval", evalFile);
    expect(JSON.parse(again.stdout)).toMatchObject({
      evalOpened: [],
      evalSkipped: ["verify-ko-work:localeCompliance", "diff-en-guided:criterionLinkage"],
    });
  });
});
