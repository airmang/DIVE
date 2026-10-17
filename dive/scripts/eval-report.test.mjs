import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAIM_NOTE,
  JUDGE_HEADING,
  failedChecks,
  formatDelta,
  pairGroups,
  parseArgs,
  readJudge,
  readReport,
  renderComparison,
  renderReport,
  validateReport,
} from "./eval-report.mjs";

const CLI = fileURLToPath(new URL("./eval-report.mjs", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../eval/supervisor/examples/", import.meta.url));
const BASE = join(EXAMPLES, "report-recorded.json");
const HEAD = join(EXAMPLES, "report-candidate.json");
const JUDGE = join(EXAMPLES, "judge.json");

const load = (file) => JSON.parse(readFileSync(file, "utf8"));

describe("example reports", () => {
  it("match the report schema documented in eval/supervisor/README.md", () => {
    expect(validateReport(load(BASE))).toEqual([]);
    expect(validateReport(load(HEAD))).toEqual([]);
    expect(readJudge(JUDGE).items.length).toBeGreaterThan(0);
  });

  it("cover every fixture once per split group", () => {
    const report = readReport(BASE);
    const ids = report.groups.flatMap((group) => group.results.map((result) => result.fixtureId));
    expect(new Set(ids).size).toBe(report.fixtureCount);
    for (const group of report.groups) {
      expect(group.results.every((result) => result.split === group.key.split)).toBe(true);
      const outcomes = Object.values(group.outcomes).reduce((sum, count) => sum + count, 0);
      expect(outcomes).toBe(group.resultCount);
    }
  });
});

describe("renderReport", () => {
  const markdown = renderReport(readReport(BASE));

  it("renders the report the Rust runner wrote (Rust → Node round trip)", () => {
    // examples/report-recorded.json is output of `eval_supervisor recorded`;
    // tests/eval_supervisor_recorded.rs checks it against the writer's schema.
    expect(markdown).toContain(CLAIM_NOTE);
    expect(markdown).toContain("written by the Rust recorded runner");
  });

  it("summarizes each (promptVersion, policyVersion, model, split) group", () => {
    expect(markdown).toContain(
      "| dev | 1.0.0+256c9520 | 1.0.0 | hand-authored | 23 | 15 | 4 | 3 | 1 | 19/19 (100.0%) | 4/4 (100.0%) |",
    );
    expect(markdown).toContain("| holdout | 1.0.0+256c9520 | 1.0.0 | hand-authored | 11 |");
    expect(markdown).toContain(
      "provoke_false: 4, disallowed_concern: 1, not_question: 1, parse_error: 1, unknown_evidence_ref: 1",
    );
  });

  it("scores final outcomes and shows every call compactly", () => {
    expect(markdown).toMatch(/\| dev \| 1\.0\.0\+256c9520 \|.*\| 0 \| 19 \(0\) \|$/m);
    expect(markdown).toContain("| group | final outcomes | every call |");
  });

  it("lists every fixture and flags only the results that failed a check", () => {
    // The live baseline has questions that name the error, not the criterion.
    expect(markdown).toMatch(
      /\| retry-fetch-401-en-guided \| dev \| openrouter\/anthropic\/claude-sonnet-5 \| retry_loop \| en-US \| guided \| card \| shown \| criterion link \|/,
    );
    const flagged = markdown.slice(
      markdown.indexOf("## Flagged results"),
      markdown.indexOf("<details>"),
    );
    expect(flagged).not.toContain("| hand-authored |");
    expect(flagged.match(/\| criterion link \|/g)).toHaveLength(4);
    expect(markdown).toContain(
      "| diff-parse-error-ko-guided | dev | diff_ready | ko-KR | guided |",
    );
    expect(markdown).not.toContain(JUDGE_HEADING);
  });

  it("flags failed checks and adds the advisory judge section on request", () => {
    const candidate = renderReport(readReport(HEAD), { judge: readJudge(JUDGE) });
    expect(candidate).toMatch(
      /\| scope-new-area-en-guided \| dev \| hand-authored \| scope_expansion \| en-US \| guided \| card \| shown \| locale \|/,
    );
    expect(candidate).toMatch(
      /\| verify-not-question-ko-work \| .* \| control: not_question \| shown \| drop reason \|/,
    );
    expect(candidate).toContain(`## ${JUDGE_HEADING}`);
    expect(candidate).toContain("never gates a merge on its own");
    expect(candidate).toContain("| criterionLinked | 2/3 | 66.7% |");
    expect(candidate).toContain(
      "| scope-new-area-en-guided | 0 | answerableByObservation, nonLeading |",
    );
  });
});

describe("renderComparison", () => {
  const markdown = renderComparison(readReport(BASE), readReport(HEAD));

  it("shows both versions and per-metric deltas per split", () => {
    expect(markdown).toContain(CLAIM_NOTE);
    expect(markdown).toContain("| promptVersion | 1.0.0+256c9520 | 1.1.0+c0ffee12 |");
    expect(markdown).toContain("| drop-reason match (controls) | 100.0% | 75.0% | −25.0 pp |");
    expect(markdown).toContain("| locale compliance | 100.0% | 93.8% | −6.3 pp |");
    expect(markdown).toContain("| missed provokes | 0 | 1 | +1 |");
    // Secondary attempts block: the candidate needed one retry.
    expect(markdown).toContain("| model calls | 19 | 20 | +1 |");
    expect(markdown).toContain("| retries | 0 | 1 | +1 |");
    expect(markdown).toContain("| not_question | 1 | 0 | −1 |");
  });

  it("lists fixtures whose outcome or checks changed", () => {
    expect(markdown).toContain(
      "| diff-extra-page-en-guided | holdout | shown | none (provoke_false) [provoke agreement] |",
    );
    expect(markdown).toContain(
      "| verify-not-question-ko-work | dev | dropped (not_question) | shown [drop reason] |",
    );
    expect(markdown).not.toContain("| diff-auth-file-ko-work |");
  });

  it("compares trials of the same model only and lists the other model as unmatched", () => {
    // Base has hand-authored + live groups; the candidate only hand-authored.
    expect(markdown).toContain("## dev · hand-authored");
    expect(markdown).toContain(
      "| base | dev · 1.0.0+256c9520 · policy 1.0.0 · openrouter/anthropic/claude-sonnet-5 |",
    );
    expect(markdown).not.toContain("| retry-fetch-401-en-guided |");
  });

  it("reports nothing changed for identical reports", () => {
    const same = renderComparison(readReport(BASE), readReport(BASE));
    expect(same).toContain("No fixture changed outcome or checks.");
    expect(same).not.toMatch(/\| [+−]\d[^|]* \|$/m);
  });
});

describe("helpers", () => {
  it("formats deltas as percentage points, ratios and counts", () => {
    expect(formatDelta(0.5, 0.75, "rate")).toBe("+25.0 pp");
    expect(formatDelta(1, 0.9, "ratio")).toBe("−0.10");
    expect(formatDelta(3, 3, "count")).toBe("±0");
    expect(formatDelta(null, 2, "count")).toBeNull();
  });

  it("treats precision below 1 and false checks as failures, null as not applicable", () => {
    expect(
      failedChecks({
        checks: { evidencePrecision: 0.5, localeCompliant: null, criterionLinked: false },
      }),
    ).toEqual(["criterionLinked", "evidencePrecision"]);
  });

  it("pairs groups per split, by model when a split has several groups", () => {
    const group = (split, model) => ({ key: { split, model, promptVersion: "p" }, results: [] });
    const { pairs, unmatched } = pairGroups(
      { groups: [group("dev", "a"), group("dev", "b"), group("holdout", "a")] },
      { groups: [group("dev", "b"), group("dev", "c"), group("holdout", "z")] },
    );
    expect(
      pairs.map(([left, right]) => `${left.key.split}:${left.key.model}->${right.key.model}`),
    ).toEqual(["dev:b->b", "holdout:a->z"]);
    expect(unmatched.map(({ side, group: g }) => `${side}:${g.key.model}`)).toEqual([
      "base:a",
      "head:c",
    ]);
  });

  it("validates arguments and report shape", () => {
    expect(() => parseArgs(["--compare", BASE])).toThrow(/--compare needs <base.json> <head.json>/);
    expect(() => parseArgs(["a.json", "b.json"])).toThrow(/exactly one/);
    expect(() => parseArgs(["a.json", "--judge"])).toThrow(/--judge needs a file/);
    expect(parseArgs(["--", "--compare", "a", "b", "--judge", "j"])).toMatchObject({
      compare: true,
      files: ["a", "b"],
      judge: "j",
    });
    expect(validateReport({ schemaVersion: 1, kind: "x", mode: "live", groups: [{}] })).toEqual([
      'kind must be "supervisor-eval-report"',
      "groups[0].key needs promptVersion, model and split strings",
      "groups[0].outcomes must be an object",
      "groups[0].results must be an array",
    ]);
  });
});

describe("eval-report CLI", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

  it("renders a report and a comparison, optionally to --out", () => {
    const single = run(BASE);
    expect(single.status).toBe(0);
    expect(single.stdout).toContain("# Supervisor eval — recorded");

    const dir = mkdtempSync(join(tmpdir(), "eval-report-"));
    dirs.push(dir);
    const out = join(dir, "compare.md");
    const compared = run("--", "--compare", BASE, HEAD, "--judge", JUDGE, "--out", out);
    expect(compared.status).toBe(0);
    const written = readFileSync(out, "utf8");
    expect(written).toContain("# Supervisor eval comparison");
    expect(written).toContain(`## ${JUDGE_HEADING}`);
  });

  it("exits 1 on an unreadable or malformed report and 2 on bad arguments", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-report-"));
    dirs.push(dir);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ schemaVersion: 2 }));
    const result = run(bad);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not a supervisor eval report");
    expect(run().status).toBe(2);
  });
});
