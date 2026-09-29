import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FIXTURE_ROOT,
  EVENTS,
  LOCALES,
  MODES,
  REQUIRED_CONTROL_DROP_REASONS,
  checkCoverage,
  computeContextHash,
  coverageSummary,
  loadFixtures,
  validateFixture,
  validateTree,
} from "./eval-fixtures.mjs";

const CLI = fileURLToPath(new URL("./eval-fixtures.mjs", import.meta.url));

function realFixture(id) {
  const { fixtures } = loadFixtures();
  const entry = fixtures.find(({ fixture }) => fixture.id === id);
  return { ...entry, fixture: structuredClone(entry.fixture) };
}

describe("supervisor eval fixtures (real tree)", () => {
  it("every fixture matches the format and the set covers the required matrix", () => {
    const { fixtures, problems } = validateTree();
    expect(problems).toEqual([]);
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
  });

  it("reproduces the Rust-computed contextHash of every fixture", () => {
    // The committed hashes were written by `SupervisorContext::compute_context_hash`;
    // the Node port must agree so hand edits can be rehashed without Rust.
    for (const { fixture } of loadFixtures().fixtures) {
      expect(computeContextHash(fixture.context), fixture.id).toBe(fixture.context.contextHash);
    }
  });

  it("covers every event × locale × mode, both splits per event, and each negative control", () => {
    const { fixtures } = loadFixtures();
    const summary = coverageSummary(fixtures);
    expect(Object.keys(summary.byEvent).sort()).toEqual([...EVENTS].sort());
    expect(Object.keys(summary.byLocale).sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(summary.byMode).sort()).toEqual([...MODES].sort());
    const controls = fixtures
      .map(({ fixture }) => fixture.expect.expectedDropReason)
      .filter(Boolean);
    expect(controls.sort()).toEqual([...REQUIRED_CONTROL_DROP_REASONS].sort());
  });

  it("keeps the ledger's documented eval-fixture guard example resolvable", () => {
    // scripts/qa-ledger/schema.md uses this id as the eval-fixture guard example.
    const ids = loadFixtures().fixtures.map(({ fixture }) => fixture.id);
    expect(ids).toContain("verify-claim-done-ko-work");
  });
});

describe("validateFixture", () => {
  it("flags a context edited without rehashing", () => {
    const { file, split, fixture } = realFixture("verify-claim-done-ko-work");
    fixture.context.verificationState.concreteEvidence = true;
    const problems = validateFixture(fixture, { file, split });
    expect(problems.join("\n")).toMatch(/contextHash does not match its content/);
    fixture.context.contextHash = computeContextHash(fixture.context);
    expect(validateFixture(fixture, { file, split })).toEqual([]);
  });

  it("flags expectations that point outside the context", () => {
    const { file, split, fixture } = realFixture("diff-auth-file-ko-work");
    fixture.expect.requiredEvidenceRefIds = ["diff.nowhere"];
    fixture.expect.criterionTerms = ["달력"];
    const problems = validateFixture(fixture, { file, split }).join("\n");
    expect(problems).toMatch(/"diff\.nowhere" is not in context\.evidenceRefs/);
    expect(problems).toMatch(/"달력" does not appear in the context/);
    expect(problems).toMatch(/must include required id "diff\.nowhere"/);
  });

  it("flags a provoking fixture whose gate is closed and a control on a negative", () => {
    const { file, split, fixture } = realFixture("claim-done-ko-work");
    fixture.expect.shouldProvoke = true;
    let problems = validateFixture(fixture, { file, split }).join("\n");
    expect(problems).toMatch(/a closed gate sends no prompt/);
    expect(problems).toMatch(/relevantEvidenceRefIds is required/);

    fixture.expect.shouldProvoke = false;
    fixture.expect.expectedDropReason = "not_question";
    problems = validateFixture(fixture, { file, split }).join("\n");
    expect(problems).toMatch(/bad recording on a context that should provoke/);
  });

  it("flags an assessment on the wrong event, unknown keys, and malformed recordings", () => {
    const { file, split, fixture } = realFixture("retry-test-timeout-en-work");
    fixture.context.scopeExpansion = { expanded: true, reasonCodes: [], evidenceRefs: [] };
    fixture.extra = true;
    fixture.recorded = {
      "1.0.0": [{ rawOutput: 1, model: "", recordedAt: "yesterday", source: "llm", attempt: -1 }],
    };
    const problems = validateFixture(fixture, { file, split }).join("\n");
    expect(problems).toMatch(/context\.scopeExpansion belongs to scope_expansion only/);
    expect(problems).toMatch(/unknown key "extra"/);
    expect(problems).toMatch(/"1\.0\.0" is not a <semver>\+<8-hex> promptVersion/);
    expect(problems).toMatch(/rawOutput must be a string/);
    expect(problems).toMatch(/model must be a non-empty string/);
    expect(problems).toMatch(/recordedAt must be an ISO date/);
    expect(problems).toMatch(/source must be one of hand-authored, live/);
    expect(problems).toMatch(/attempt must be a non-negative integer/);
  });

  it("requires the file name and split directory to match", () => {
    const { fixture } = realFixture("plan-broad-step-en-work");
    const problems = validateFixture(fixture, { file: "/x/other.json", split: "train" });
    expect(problems).toContain("file name must be plan-broad-step-en-work.json");
    expect(problems).toContain("fixture must live under dev/ or holdout/");
  });
});

describe("checkCoverage", () => {
  it("reports missing matrix cells, splits, controls, size, and stale recordings", () => {
    const { fixtures } = loadFixtures();
    const without = fixtures.filter(
      ({ fixture, split }) =>
        !(fixture.event === "retry_loop" && (split === "holdout" || fixture.locale === "en-US")) &&
        fixture.expect.expectedDropReason !== "parse_error",
    );
    const stale = structuredClone(without);
    stale[0].fixture.recorded["9.9.9+0123abcd"] = [
      {
        rawOutput: "{}",
        model: "hand-authored",
        recordedAt: "2026-10-01",
        source: "hand-authored",
      },
    ];
    const problems = checkCoverage(stale).join("\n");
    expect(problems).toMatch(/no fixture for retry_loop × en-US × work/);
    expect(problems).toMatch(/no holdout fixture for retry_loop/);
    expect(problems).toMatch(/no negative-control fixture with expectedDropReason "parse_error"/);
    expect(problems).toMatch(/fixtures; at least 30 are required/);
    expect(problems).toMatch(/no recording for the newest promptVersion 9\.9\.9\+0123abcd/);
  });

  it("reports duplicate ids and a lopsided split", () => {
    const { fixtures } = loadFixtures();
    const dup = [...fixtures, fixtures[0]];
    expect(checkCoverage(dup).join("\n")).toMatch(/duplicate id/);
    const allDev = fixtures.map((entry) => ({ ...entry, split: "dev" }));
    expect(checkCoverage(allDev).join("\n")).toMatch(/holdout is 0% of fixtures/);
  });
});

describe("eval-fixtures CLI", () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function copyTree() {
    const root = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    roots.push(root);
    cpSync(DEFAULT_FIXTURE_ROOT, root, { recursive: true });
    return root;
  }

  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

  it("exits 0 on the real tree", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/eval-fixtures: OK — \d+ fixture\(s\)/);
  });

  it("exits 1 listing problems, and --rehash repairs an edited context", () => {
    const root = copyTree();
    const file = join(root, "dev", "verify-claim-done-ko-work.json");
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    fixture.context.feasibility.runnable = true;
    writeFileSync(file, JSON.stringify(fixture));

    const failed = run("--", "--root", root);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/dev\/verify-claim-done-ko-work\.json: context\.contextHash/);

    const repaired = run("--root", root, "--rehash");
    expect(repaired.status).toBe(0);
    expect(repaired.stdout).toMatch(/rehashed 1 fixture/);
  });

  it("exits 2 on an unknown argument", () => {
    expect(run("--bogus").status).toBe(2);
  });
});
