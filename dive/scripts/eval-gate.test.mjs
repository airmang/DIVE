import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GATE_CONFIG,
  FALLBACK_QUESTION_MARKERS,
  evaluateGate,
  isQuestion,
  main,
  renderGate,
} from "./eval-gate.mjs";
import { validateEvalGateResult } from "./qa-ledger/schema.mjs";

const CLI = fileURLToPath(new URL("./eval-gate.mjs", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../eval/supervisor/examples/", import.meta.url));
const SRC_TAURI = fileURLToPath(new URL("../src-tauri/src/", import.meta.url));
const BASE = join(EXAMPLES, "report-recorded.json");
const HEAD = join(EXAMPLES, "report-candidate.json");
const JUDGE = join(EXAMPLES, "judge.json");

const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const clone = (value) => structuredClone(value);

/** The first shown result of `split` in `report` (mutable). */
function shownResult(report, split) {
  const group = report.groups.find((g) => g.key.split === split);
  return group.results.find((result) => result.outcome === "shown");
}

function holdoutResults(report) {
  return report.groups.find((g) => g.key.split === "holdout").results;
}

describe("eval-gate on the example reports", () => {
  it("passes a report against itself with no regressions", () => {
    const base = load(BASE);
    const result = evaluateGate(base, clone(base));
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.hardFails).toEqual([]);
    expect(result.regressions).toEqual([]);
  });

  it("fails the candidate on the holdout provoke drop and the changed control", () => {
    const result = evaluateGate(load(BASE), load(HEAD));
    expect(result.pass).toBe(false);
    expect(result.promptVersion).toBe("1.1.0+c0ffee12");
    expect(result.baseline).toBe("1.0.0+256c9520");
    const provoke = result.metrics.find((row) => row.metric === "provokeAgreement");
    expect(provoke).toMatchObject({ before: 1, pass: false });
    expect(result.hardFails.map((f) => [f.kind, f.fixtureId])).toEqual([
      ["control_drop_reason_changed", "verify-not-question-ko-work"],
    ]);
    expect(result.regressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureId: "diff-extra-page-en-guided",
          metric: "provokeAgreement",
          severity: "P1",
          split: "holdout",
        }),
        expect.objectContaining({
          fixtureId: "scope-new-area-en-guided",
          metric: "localeCompliance",
          severity: "P2",
          split: "dev",
        }),
      ]),
    );
  });

  it("emits the eval-gate result shape qa:triage --from-eval accepts", () => {
    const result = evaluateGate(load(BASE), load(HEAD));
    expect(validateEvalGateResult(result)).toEqual([]);
    expect(result.regressions.length).toBeGreaterThan(0);
  });
});

describe("tolerance (holdout, deterministic metrics)", () => {
  it("allows a rate drop within tolerance and rejects one beyond it", () => {
    const base = load(BASE);
    const head = clone(base);
    const flipped = holdoutResults(head).find((r) => r.checks.criterionLinked === true);
    flipped.checks.criterionLinked = false;
    // 1 of 5 checked = a 20 pp drop.
    expect(evaluateGate(base, head).pass).toBe(false);
    const loose = { ...DEFAULT_GATE_CONFIG, maxRateDrop: 0.25 };
    expect(evaluateGate(base, head, { config: loose }).pass).toBe(true);
  });

  it("never lets locale violations or over-limit questions increase", () => {
    const base = load(BASE);
    const loose = { ...DEFAULT_GATE_CONFIG, maxRateDrop: 1 };

    const locale = clone(base);
    shownResult(locale, "holdout").checks.localeCompliant = false;
    const localeResult = evaluateGate(base, locale, { config: loose });
    expect(localeResult.pass).toBe(false);
    expect(localeResult.failures.join("\n")).toMatch(/localeViolations: 0 → 1/);

    const long = clone(base);
    shownResult(long, "holdout").checks.questionChars = 141;
    const longResult = evaluateGate(base, long, { config: loose });
    expect(longResult.pass).toBe(false);
    expect(longResult.failures.join("\n")).toMatch(/overLimitQuestions: 0 → 1/);
  });

  it("gates only on the holdout split", () => {
    const base = load(BASE);
    const head = clone(base);
    const dev = head.groups.find((g) => g.key.split === "dev");
    dev.results.find((r) => r.checks.criterionLinked === true).checks.criterionLinked = false;
    const result = evaluateGate(base, head);
    expect(result.pass).toBe(true);
    expect(result.regressions).toEqual([
      expect.objectContaining({ metric: "criterionLinkage", severity: "P2", split: "dev" }),
    ]);
  });

  it("fails when the head is missing holdout fixtures", () => {
    const base = load(BASE);
    const head = clone(base);
    holdoutResults(head).pop();
    expect(evaluateGate(base, head).failures.join("\n")).toMatch(/missing holdout fixtures/);
  });
});

describe("hard fails ignore tolerance and apply to every split", () => {
  const anything = { ...DEFAULT_GATE_CONFIG, maxRateDrop: 1 };
  const cases = [
    ["shown_non_question", (r) => (r.decision.question = "Check the diff before approving.")],
    ["shown_without_evidence", (r) => (r.decision.evidenceRefIds = [])],
    ["static_fallback_question", (r) => (r.promptSent = false)],
    [
      "static_fallback_question",
      (r) =>
        (r.decision.question =
          "Can you check whether these changed files still match the current goal and plan scope before approving?"),
    ],
  ];
  for (const [kind, mutate] of cases) {
    for (const split of ["dev", "holdout"]) {
      it(`${kind} on ${split}`, () => {
        const base = load(BASE);
        const head = clone(base);
        mutate(shownResult(head, split));
        const result = evaluateGate(base, head, { config: anything });
        expect(result.pass).toBe(false);
        expect(result.hardFails.map((f) => f.kind)).toContain(kind);
        const regression = result.regressions.find((r) => r.hardFail === kind);
        expect(regression).toMatchObject({ severity: "P1", split });
      });
    }
  }

  it("control_drop_reason_changed even when the new reason still drops", () => {
    const base = load(BASE);
    const head = clone(base);
    const control = head.groups
      .flatMap((g) => g.results)
      .find((r) => typeof r.expected.expectedDropReason === "string");
    control.dropReason = "content_too_long";
    const result = evaluateGate(base, head, { config: anything });
    expect(result.pass).toBe(false);
    expect(result.hardFails[0]).toMatchObject({
      kind: "control_drop_reason_changed",
      fixtureId: control.fixtureId,
    });
  });
});

describe("LLM judgment is advisory (D-015-05)", () => {
  it("never changes pass/fail", () => {
    const base = load(BASE);
    const judge = load(JUDGE);
    for (const item of judge.items) {
      for (const key of Object.keys(item.scores)) item.scores[key] = false;
    }
    const withJudge = evaluateGate(base, clone(base), { judge });
    expect(withJudge.pass).toBe(true);
    expect(withJudge.advisory.judge).toMatch(/advisory only/);
    expect(evaluateGate(load(BASE), load(HEAD), { judge }).pass).toBe(false);
  });
});

describe("fallback markers track the Rust fallback questions", () => {
  it("each marker still occurs in the deterministic fallback sources", () => {
    const sources = [
      readFileSync(join(SRC_TAURI, "dive/supervisor/decision.rs"), "utf8"),
      readFileSync(join(SRC_TAURI, "ipc/provocation_agent.rs"), "utf8"),
    ].join("\n");
    for (const marker of FALLBACK_QUESTION_MARKERS) {
      expect(sources, marker).toContain(marker);
    }
  });

  it("isQuestion mirrors the Rust validator", () => {
    expect(isQuestion("Did it work?")).toBe(true);
    expect(isQuestion("확인했나요")).toBe(true);
    expect(isQuestion("볼까요 ")).toBe(true);
    expect(isQuestion("맞습니까")).toBe(true);
    expect(isQuestion("정말？")).toBe(true);
    expect(isQuestion("Check the diff.")).toBe(false);
    expect(isQuestion("")).toBe(false);
  });
});

describe("CLI", () => {
  let dir = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

  it("exits 0 on pass and 1 on fail, with a readable summary", () => {
    const pass = run(BASE, BASE);
    expect(pass.status).toBe(0);
    expect(pass.stdout).toMatch(/^eval-gate: PASS/);
    const fail = run("--", BASE, HEAD);
    expect(fail.status).toBe(1);
    expect(fail.stdout).toMatch(/^eval-gate: FAIL/);
    expect(fail.stdout).toContain("control_drop_reason_changed");
    expect(fail.stdout).toContain("not evidence of student supervision skill");
  });

  it("prints the gate result with --json", () => {
    const out = run(BASE, HEAD, "--json", "--judge", JUDGE);
    expect(out.status).toBe(1);
    const result = JSON.parse(out.stdout);
    expect(result.kind).toBe("supervisor-eval-gate");
    expect(validateEvalGateResult(result)).toEqual([]);
    expect(result.advisory.judge).toMatch(/advisory only/);
  });

  it("exits 2 on bad input", () => {
    dir = mkdtempSync(join(tmpdir(), "eval-gate-"));
    const notReport = join(dir, "not-report.json");
    writeFileSync(notReport, JSON.stringify({ kind: "something-else" }));
    const garbled = join(dir, "garbled.json");
    writeFileSync(garbled, "{");
    const noHoldout = join(dir, "no-holdout.json");
    const report = load(BASE);
    report.groups = report.groups.filter((g) => g.key.split !== "holdout");
    writeFileSync(noHoldout, JSON.stringify(report));

    for (const args of [
      [BASE],
      [BASE, join(dir, "missing.json")],
      [BASE, garbled],
      [BASE, notReport],
      [BASE, noHoldout],
      [BASE, HEAD, "--bogus"],
    ]) {
      const out = run(...args);
      expect(out.status, args.join(" ")).toBe(2);
      expect(out.stderr).toMatch(/^eval-gate: /);
    }
  });

  it("renders from main() without a subprocess", () => {
    let stdout = "";
    const code = main([BASE, BASE], { write: (s) => (stdout += s) }, { write: () => {} });
    expect(code).toBe(0);
    expect(stdout).toBe(renderGate(evaluateGate(load(BASE), load(BASE))));
  });
});
