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

const HAND = "hand-authored";
const LIVE = "openrouter/anthropic/claude-sonnet-5";

function group(report, split, model = HAND) {
  return report.groups.find((g) => g.key.split === split && g.key.model === model);
}

/** The first shown result of the `split`/`model` group in `report` (mutable). */
function shownResult(report, split, model = HAND) {
  return group(report, split, model).results.find((result) => result.outcome === "shown");
}

function holdoutResults(report, model = HAND) {
  return group(report, "holdout", model).results;
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
    const dev = group(head, "dev");
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
    expect(evaluateGate(base, head).failures.join("\n")).toMatch(
      /holdout\/hand-authored: head is missing fixtures/,
    );
  });
});

describe("like-for-like model groups", () => {
  it("the example baseline mixes hand-authored and live groups", () => {
    const base = load(BASE);
    expect(base.groups.map((g) => `${g.key.split}/${g.key.model}`).sort()).toEqual(
      [`dev/${HAND}`, `dev/${LIVE}`, `holdout/${HAND}`, `holdout/${LIVE}`].sort(),
    );
    // Live groups hold only gate-passing fixtures.
    expect(holdoutResults(base, LIVE).length).toBeLessThan(holdoutResults(base).length);
  });

  it("gates each model against itself and never fails a live group for lacking negatives", () => {
    const base = load(BASE);
    const result = evaluateGate(base, clone(base));
    expect(result.pass).toBe(true);
    expect(result.groups.gated.map((g) => g.model).sort()).toEqual([HAND, LIVE].sort());
    expect(new Set(result.metrics.map((row) => row.model))).toEqual(new Set([HAND, LIVE]));
    expect(validateEvalGateResult(result)).toEqual([]);
  });

  it("does not let one model's results mask another's", () => {
    const base = load(BASE);
    const head = clone(base);
    for (const result of holdoutResults(head, LIVE)) {
      if (result.checks.criterionLinked === true) result.checks.criterionLinked = false;
    }
    const result = evaluateGate(base, head);
    expect(result.pass).toBe(false);
    expect(result.failures.join("\n")).toMatch(new RegExp(`holdout/${LIVE} criterionLinkage`));
    expect(
      result.metrics.find((r) => r.model === HAND && r.metric === "criterionLinkage").pass,
    ).toBe(true);
    expect(validateEvalGateResult(result)).toEqual([]);
    expect(result.regressions.every((r) => r.model === LIVE)).toBe(true);
  });

  it("--model restricts tolerance to one model; hard fails still cover every group", () => {
    const base = load(BASE);
    const head = clone(base);
    holdoutResults(head).find((r) => r.checks.criterionLinked === true).checks.criterionLinked =
      false;
    expect(evaluateGate(base, head).pass).toBe(false);
    const liveOnly = evaluateGate(base, head, { model: LIVE });
    expect(liveOnly.pass).toBe(true);
    expect(liveOnly.model).toBe(LIVE);
    expect(new Set(liveOnly.metrics.map((row) => row.model))).toEqual(new Set([LIVE]));

    shownResult(head, "dev").decision.evidenceRefIds = [];
    const hard = evaluateGate(base, head, { model: LIVE });
    expect(hard.pass).toBe(false);
    expect(hard.hardFails[0]).toMatchObject({ kind: "shown_without_evidence", model: HAND });
  });

  it("fails a missing base group only when its model is under evaluation", () => {
    const base = load(BASE);
    const head = clone(base);
    head.groups = head.groups.filter((g) => g.key.model !== LIVE);
    const every = evaluateGate(base, head);
    expect(every.pass).toBe(true);
    expect(every.groups.missingInHead).toEqual([
      { split: "holdout", model: LIVE, failsGate: false },
    ]);
    const live = evaluateGate(base, head, { model: LIVE });
    expect(live.pass).toBe(false);
    expect(live.failures.join("\n")).toMatch(/model under evaluation/);
    expect(validateEvalGateResult(live)).toEqual([]);
  });

  it("reports a head-only model as new and not gated", () => {
    const base = load(BASE);
    const head = clone(base);
    const fresh = clone(group(head, "holdout", LIVE));
    fresh.key.model = "new-model";
    for (const result of fresh.results) {
      result.model = "new-model";
      result.checks.criterionLinked = false;
    }
    head.groups.push(fresh);
    const result = evaluateGate(base, head);
    expect(result.pass).toBe(true);
    expect(result.groups.newInHead).toEqual([{ split: "holdout", model: "new-model" }]);
    expect(result.metrics.some((row) => row.model === "new-model")).toBe(false);
    expect(() => evaluateGate(base, head, { model: "new-model" })).toThrow(/no like-for-like/);
  });

  it("never pairs two different models, even one group per split each", () => {
    const base = load(BASE);
    base.groups = base.groups.filter((g) => g.key.model === HAND);
    const head = load(BASE);
    head.groups = head.groups.filter((g) => g.key.model === LIVE);
    expect(() => evaluateGate(base, head)).toThrow(/no like-for-like holdout group pair/);
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
      .filter((g) => g.key.model === HAND)
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

  it("gates one model with --model", () => {
    const out = run(BASE, BASE, "--model", LIVE, "--json");
    expect(out.status).toBe(0);
    const result = JSON.parse(out.stdout);
    expect(result.model).toBe(LIVE);
    expect(result.groups.gated).toEqual([expect.objectContaining({ model: LIVE })]);
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
    const onlyBase = load(BASE);
    onlyBase.groups = onlyBase.groups.filter((g) => g.key.model === HAND);
    const onlyBaseFile = join(dir, "only-hand.json");
    writeFileSync(onlyBaseFile, JSON.stringify(onlyBase));

    for (const args of [
      [BASE],
      [BASE, join(dir, "missing.json")],
      [BASE, garbled],
      [BASE, notReport],
      [noHoldout, BASE],
      [BASE, HEAD, "--bogus"],
      [BASE, HEAD, "--model"],
      [onlyBaseFile, onlyBaseFile, "--model", LIVE],
    ]) {
      const out = run(...args);
      expect(out.status, args.join(" ")).toBe(2);
      expect(out.stderr).toMatch(/^eval-gate: /);
    }
    // A head that dropped the holdout groups of the models it was run with
    // fails the gate (exit 1) rather than being bad input.
    const dropped = run(BASE, noHoldout);
    expect(dropped.status).toBe(1);
    expect(dropped.stdout).toMatch(/missing from head — FAIL \(model under evaluation\)/);
  });

  it("renders from main() without a subprocess", () => {
    let stdout = "";
    const code = main([BASE, BASE], { write: (s) => (stdout += s) }, { write: () => {} });
    expect(code).toBe(0);
    expect(stdout).toBe(renderGate(evaluateGate(load(BASE), load(BASE))));
  });
});
