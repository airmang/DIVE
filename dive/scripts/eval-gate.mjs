#!/usr/bin/env node
// `pnpm eval:gate` — before/after merge gate for a supervision change (spec
// 015, S-083, FR-071). Compares a base and a head SupervisorAgent eval report
// (schema: dive/eval/supervisor/README.md) and decides pass/fail from
// deterministic metrics only:
//
// - Tolerance (holdout split): no rate metric may drop by more than
//   `maxRateDrop` (default 5 percentage points); over-limit questions and
//   locale violations may not increase at all.
// - Hard fails (every split, regardless of tolerance): a shown question that is
//   not a question, a shown card without evidence refs, a static/fallback
//   question where a model call was expected, and a negative-control fixture
//   whose drop reason changed or no longer matches its expectation.
// - An LLM-judge file is advisory only and never affects pass/fail (D-015-05).
//
// Usage: node scripts/eval-gate.mjs <base.json> <head.json> [--json] [--judge <judge.json>]
//   --json   print the gate result (the eval-gate result shape of
//            scripts/qa-ledger/schema.md, consumed by `qa:triage --from-eval`)
// Exit codes: 0 pass, 1 fail, 2 bad input.

import { pathToFileURL } from "node:url";
import { CLAIM_NOTE, readJudge, readReport } from "./eval-report.mjs";

export const DEFAULT_GATE_CONFIG = Object.freeze({
  /** Split the tolerance applies to; hard fails are checked on every split. */
  split: "holdout",
  /** Largest allowed drop of a rate metric, as a fraction (0.05 = 5 pp). */
  maxRateDrop: 0.05,
  /** Largest allowed increase of a count metric. */
  maxCountIncrease: Object.freeze({ overLimitQuestions: 0, localeViolations: 0 }),
  /** `QUESTION_MAX_CHARS` in src-tauri/src/dive/supervisor/mod.rs. */
  questionMaxChars: 140,
});

/** Rate metrics: per-result check → [value, applies]. */
const RATE_METRICS = {
  provokeAgreement: (checks) => checks.provokeAgreement,
  dropReasonMatch: (checks) => checks.dropReasonMatch,
  localeCompliance: (checks) => checks.localeCompliant,
  criterionLinkage: (checks) => checks.criterionLinked,
  evidencePrecision: (checks) => checks.evidencePrecision,
  requiredEvidenceCited: (checks) => checks.requiredEvidenceCited,
};

/**
 * Deterministic fallback questions DIVE writes without a model
 * (`build_stage_c_supervisor_decision` in supervisor/decision.rs and
 * `build_diff_ready_supervisor_shell_decision` in ipc/provocation_agent.rs).
 * `eval-gate.test.mjs` asserts each marker still occurs in those sources.
 */
export const FALLBACK_QUESTION_MARKERS = [
  "but there is no evidence you've checked yourself yet",
  "완료를 보고했지만, 직접 확인한 증거가 아직 없습니다",
  "This refactor or rename has no verification evidence yet",
  "Can you check whether these changed files still match the current goal and plan scope before approving?",
  "이 리팩터/이름 변경에는 아직 검증 근거가 없습니다",
  "승인하기 전에 이 변경 파일들이 현재 목표와 계획 범위에 맞는지 확인할 수 있나요?",
];

/** Port of `is_question` in src-tauri/src/dive/supervisor/decision.rs. */
export function isQuestion(value) {
  const trimmed = String(value ?? "").trim();
  return ["?", "？", "나요", "까요", "습니까"].some((ending) => trimmed.endsWith(ending));
}

function resultsOf(report) {
  return report.groups.flatMap((group) =>
    group.results.map((result) => ({ ...result, split: result.split ?? group.key.split })),
  );
}

function versions(report, field) {
  return [...new Set(report.groups.map((group) => group.key[field]).filter(Boolean))].join(", ");
}

const isControl = (result) => typeof result.expected?.expectedDropReason === "string";
const round = (value) => (value === null ? null : Math.round(value * 1e6) / 1e6);

/** Aggregate metrics over `results`, recomputed from per-result checks. */
export function computeMetrics(results, config = DEFAULT_GATE_CONFIG) {
  const metrics = {};
  for (const [name, pick] of Object.entries(RATE_METRICS)) {
    const values = results
      .map((result) => pick(result.checks ?? {}))
      .filter((value) => value !== null && value !== undefined)
      .map(Number);
    metrics[name] = {
      checked: values.length,
      value: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    };
  }
  const shown = results.filter((result) => result.outcome === "shown");
  metrics.overLimitQuestions = {
    checked: shown.length,
    value: shown.filter((result) => (result.checks?.questionChars ?? 0) > config.questionMaxChars)
      .length,
  };
  metrics.localeViolations = {
    checked: shown.length,
    value: results.filter((result) => result.checks?.localeCompliant === false).length,
  };
  return metrics;
}

/** Violations that fail the gate on their own, on every split of `report`. */
export function hardFailures(base, head) {
  const failures = [];
  const baseControls = new Map(
    resultsOf(base)
      .filter(isControl)
      .map((result) => [`${result.fixtureId}#${result.recordingIndex ?? 0}`, result]),
  );
  for (const result of resultsOf(head)) {
    const where = {
      fixtureId: result.fixtureId,
      split: result.split,
      recordingIndex: result.recordingIndex ?? 0,
    };
    if (result.outcome === "shown") {
      const question = result.decision?.question ?? "";
      if (!isQuestion(question)) {
        failures.push({ kind: "shown_non_question", ...where, detail: question });
      }
      if (!(result.decision?.evidenceRefIds?.length > 0)) {
        failures.push({ kind: "shown_without_evidence", ...where, detail: "no evidenceRefIds" });
      }
      const marker = FALLBACK_QUESTION_MARKERS.find((text) => question.includes(text));
      if (result.promptSent === false || marker) {
        failures.push({
          kind: "static_fallback_question",
          ...where,
          detail: marker
            ? `fallback text "${marker}"`
            : "card shown although no prompt reached a model",
        });
      }
    }
    if (isControl(result)) {
      const expected = result.expected.expectedDropReason;
      const before = baseControls.get(`${result.fixtureId}#${where.recordingIndex}`);
      if (result.dropReason !== expected) {
        failures.push({
          kind: "control_drop_reason_changed",
          ...where,
          detail: `expected ${expected}, got ${result.dropReason ?? "none"}`,
        });
      } else if (before && before.dropReason !== result.dropReason) {
        failures.push({
          kind: "control_drop_reason_changed",
          ...where,
          detail: `${before.dropReason ?? "none"} → ${result.dropReason ?? "none"}`,
        });
      }
    }
  }
  return failures;
}

function compareMetric(name, before, after, config) {
  const row = { metric: name, before: before.value, after: after.value, limit: null, pass: true };
  if (name in config.maxCountIncrease) {
    row.limit = `increase ≤ ${config.maxCountIncrease[name]}`;
    row.pass = after.value - before.value <= config.maxCountIncrease[name];
    return row;
  }
  row.limit = `drop ≤ ${Math.round(config.maxRateDrop * 100)} pp`;
  if (before.value === null || after.value === null) {
    row.note = "not comparable (nothing checked on one side)";
    return row;
  }
  row.pass = before.value - after.value <= config.maxRateDrop + 1e-9;
  return row;
}

function fixtureChecks(results) {
  const byFixture = new Map();
  for (const result of results) {
    const entry = byFixture.get(result.fixtureId) ?? { split: result.split, results: [] };
    entry.results.push(result);
    byFixture.set(result.fixtureId, entry);
  }
  return byFixture;
}

const METRIC_FOR_HARD_FAIL = {
  shown_non_question: "notQuestion",
  shown_without_evidence: "missingEvidence",
  static_fallback_question: "staticFallback",
  control_drop_reason_changed: "dropReasonMatch",
};

/**
 * Per-fixture regressions in the eval-gate result shape: a hard fail, or a
 * rate metric that got worse for that fixture (P1 when it is on the gated
 * split and its metric broke tolerance, P2 otherwise).
 */
function fixtureRegressions(base, head, hardFails, failedMetrics, config) {
  const regressions = [];
  const seen = new Set();
  for (const failure of hardFails) {
    const metric = METRIC_FOR_HARD_FAIL[failure.kind];
    const key = `${failure.fixtureId}:${metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Control regressions read as a match rate (1 → 0); the other hard fails
    // as a violation count (0 → 1).
    const matchRate = metric === "dropReasonMatch";
    regressions.push({
      fixtureId: failure.fixtureId,
      metric,
      before: matchRate ? 1 : 0,
      after: matchRate ? 0 : 1,
      severity: "P1",
      split: failure.split,
      hardFail: failure.kind,
    });
  }
  const baseFixtures = fixtureChecks(resultsOf(base));
  for (const [fixtureId, headEntry] of fixtureChecks(resultsOf(head))) {
    const baseEntry = baseFixtures.get(fixtureId);
    if (!baseEntry) continue;
    const before = computeMetrics(baseEntry.results, config);
    const after = computeMetrics(headEntry.results, config);
    for (const metric of [...Object.keys(RATE_METRICS), "overLimitQuestions"]) {
      const b = before[metric].value;
      const a = after[metric].value;
      if (b === null || a === null) continue;
      const worse = metric === "overLimitQuestions" ? a > b : a < b - 1e-9;
      const key = `${fixtureId}:${metric}`;
      if (!worse || seen.has(key)) continue;
      seen.add(key);
      regressions.push({
        fixtureId,
        metric,
        before: b,
        after: a,
        severity: headEntry.split === config.split && failedMetrics.has(metric) ? "P1" : "P2",
        split: headEntry.split,
      });
    }
  }
  return regressions;
}

/** The gate decision for `head` against `base`. */
export function evaluateGate(base, head, { config = DEFAULT_GATE_CONFIG, judge = null } = {}) {
  const gatedBase = resultsOf(base).filter((result) => result.split === config.split);
  const gatedHead = resultsOf(head).filter((result) => result.split === config.split);
  if (gatedBase.length === 0 || gatedHead.length === 0) {
    throw new Error(`both reports need ${config.split} results`);
  }
  const failures = [];
  const missing = [...new Set(gatedBase.map((r) => r.fixtureId))].filter(
    (id) => !gatedHead.some((result) => result.fixtureId === id),
  );
  if (missing.length)
    failures.push(`head is missing ${config.split} fixtures: ${missing.join(", ")}`);

  const before = computeMetrics(gatedBase, config);
  const after = computeMetrics(gatedHead, config);
  const metrics = Object.keys(before).map((name) =>
    compareMetric(name, before[name], after[name], config),
  );
  const failedMetrics = new Set(metrics.filter((row) => !row.pass).map((row) => row.metric));
  for (const row of metrics.filter((r) => !r.pass)) {
    failures.push(`${config.split} ${row.metric}: ${row.before} → ${row.after} (${row.limit})`);
  }
  const hardFails = hardFailures(base, head);
  for (const failure of hardFails) {
    failures.push(
      `hard fail ${failure.kind}: ${failure.fixtureId} (${failure.split}) — ${failure.detail}`,
    );
  }
  return {
    schemaVersion: 1,
    kind: "supervisor-eval-gate",
    pass: failures.length === 0,
    promptVersion: versions(head, "promptVersion"),
    baseline: versions(base, "promptVersion"),
    policyVersion: versions(head, "policyVersion"),
    baselinePolicyVersion: versions(base, "policyVersion"),
    split: config.split,
    tolerance: {
      maxRateDrop: config.maxRateDrop,
      maxCountIncrease: { ...config.maxCountIncrease },
    },
    metrics,
    hardFails,
    failures,
    regressions: fixtureRegressions(base, head, hardFails, failedMetrics, config),
    advisory: {
      judge: judge
        ? `${judge.items.length} AI-judged question(s) supplied; advisory only, not part of pass/fail (D-015-05)`
        : null,
    },
    claim: CLAIM_NOTE,
  };
}

const COUNT_METRICS = new Set(["overLimitQuestions", "localeViolations"]);

function formatValue(value, metric) {
  if (value === null || value === undefined) return "–";
  return COUNT_METRICS.has(metric) ? String(value) : `${(value * 100).toFixed(1)}%`;
}

export function renderGate(result) {
  const lines = [
    `eval-gate: ${result.pass ? "PASS" : "FAIL"} — ${result.promptVersion} vs ${result.baseline}`,
    `policy ${result.policyVersion} vs ${result.baselinePolicyVersion}; tolerance on ${result.split}`,
    "",
    ...result.metrics.map(
      (row) =>
        `  ${row.pass ? "ok  " : "FAIL"} ${row.metric.padEnd(22)} ${formatValue(row.before, row.metric).padStart(7)} → ${formatValue(row.after, row.metric).padEnd(7)} (${row.limit})${row.note ? ` ${row.note}` : ""}`,
    ),
  ];
  if (result.hardFails.length) {
    lines.push("", "Hard fails:");
    for (const failure of result.hardFails) {
      lines.push(
        `  - ${failure.kind}: ${failure.fixtureId} (${failure.split}) — ${failure.detail}`,
      );
    }
  }
  if (result.regressions.length) {
    lines.push("", `Fixture regressions (${result.regressions.length}):`);
    for (const r of result.regressions) {
      lines.push(
        `  - [${r.severity}] ${r.fixtureId} (${r.split}) ${r.metric}: ${r.before} → ${r.after}`,
      );
    }
  }
  if (result.advisory.judge) lines.push("", `AI judgment: ${result.advisory.judge}`);
  lines.push("", result.claim);
  return `${lines.join("\n")}\n`;
}

export function parseArgs(argv) {
  const args = { files: [], json: false, judge: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--json") args.json = true;
    else if (arg === "--judge") {
      const next = argv[(i += 1)];
      if (next === undefined || next.startsWith("--")) throw new Error("--judge needs a file");
      args.judge = next;
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument "${arg}"`);
    else args.files.push(arg);
  }
  if (!args.help && args.files.length !== 2) throw new Error("expected <base.json> <head.json>");
  return args;
}

const USAGE = "Usage: pnpm eval:gate <base.json> <head.json> [--json] [--judge <judge.json>]";

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  let args;
  let result;
  try {
    args = parseArgs(argv);
    if (args.help) {
      out.write(`${USAGE}\n`);
      return 0;
    }
    const judge = args.judge ? readJudge(args.judge) : null;
    result = evaluateGate(readReport(args.files[0]), readReport(args.files[1]), { judge });
  } catch (error) {
    err.write(`eval-gate: ${error.message}\n${USAGE}\n`);
    return 2;
  }
  out.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : renderGate(result));
  return result.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
