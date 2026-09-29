#!/usr/bin/env node
// `pnpm eval:report` — Markdown summary of a SupervisorAgent eval report
// (spec 015, S-079, FR-032–FR-034). The JSON report is written by the Rust
// runner (`eval::supervisor`, target/eval/supervisor-<promptVersion>.json); its
// schema is in dive/eval/supervisor/README.md. This script only renders: every
// metric is computed by the runner.
//
// Usage: node scripts/eval-report.mjs <report.json> [--judge <judge.json>] [--out <file.md>]
//        node scripts/eval-report.mjs --compare <base.json> <head.json> [--judge <judge.json>] [--out <file.md>]
//   --judge  adds an "AI judgment (advisory, not a merge gate)" section (D-015-05);
//            with --compare it describes the head report

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CLAIM_NOTE =
  "These metrics describe SupervisorAgent output on synthetic fixtures (card-quality proxies). " +
  "They are not evidence of student supervision skill, metacognition, or reduced AI overreliance.";

export const JUDGE_HEADING = "AI judgment (advisory, not a merge gate)";

export const JUDGE_CRITERIA = [
  "specific",
  "criterionLinked",
  "answerableByObservation",
  "nonLeading",
];

const OUTCOMES = ["shown", "none", "dropped", "error"];
const CHECK_LABELS = {
  provokeAgreement: "provoke agreement",
  dropReasonMatch: "drop reason",
  localeCompliant: "locale",
  criterionLinked: "criterion link",
  requiredEvidenceCited: "required evidence",
  evidencePrecision: "evidence precision",
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Minimal shape check; returns problems (empty when renderable). */
export function validateReport(report) {
  const problems = [];
  if (!isObject(report)) return ["report must be a JSON object"];
  if (report.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (report.kind !== "supervisor-eval-report")
    problems.push('kind must be "supervisor-eval-report"');
  if (!["recorded", "live"].includes(report.mode))
    problems.push('mode must be "recorded" or "live"');
  if (!Array.isArray(report.groups)) return [...problems, "groups must be an array"];
  report.groups.forEach((group, index) => {
    const where = `groups[${index}]`;
    const key = group?.key;
    if (
      !isObject(key) ||
      !["promptVersion", "model", "split"].every((field) => typeof key[field] === "string")
    ) {
      problems.push(`${where}.key needs promptVersion, model and split strings`);
    }
    if (!isObject(group?.outcomes)) problems.push(`${where}.outcomes must be an object`);
    if (!Array.isArray(group?.results)) problems.push(`${where}.results must be an array`);
  });
  return problems;
}

export function validateJudge(judge) {
  const problems = [];
  if (!isObject(judge)) return ["judge file must be a JSON object"];
  if (judge.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (judge.kind !== "supervisor-eval-judgment") {
    problems.push('kind must be "supervisor-eval-judgment"');
  }
  if (!Array.isArray(judge.items)) problems.push("items must be an array");
  else {
    judge.items.forEach((item, index) => {
      if (typeof item?.fixtureId !== "string" || !isObject(item?.scores)) {
        problems.push(`items[${index}] needs fixtureId and scores`);
      }
    });
  }
  return problems;
}

function readJson(file, validate, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: cannot read ${label}: ${error.message}`);
  }
  const problems = validate(parsed);
  if (problems.length) throw new Error(`${file}: not a ${label}: ${problems.join("; ")}`);
  return parsed;
}

export const readReport = (file) => readJson(file, validateReport, "supervisor eval report");
export const readJudge = (file) => readJson(file, validateJudge, "supervisor eval judgment");

function cell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

function percent(rate) {
  return rate === null || rate === undefined ? null : `${(rate * 100).toFixed(1)}%`;
}

function fraction(count, checked, rate) {
  if (!checked) return null;
  return `${count}/${checked} (${percent(rate ?? count / checked)})`;
}

function number(value, digits = 0) {
  return value === null || value === undefined ? null : Number(value).toFixed(digits);
}

function distribution(map) {
  const entries = Object.entries(map ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([name, count]) => `${name}: ${count}`).join(", ") : null;
}

function shownRate(group) {
  return group.resultCount ? (group.outcomes?.shown ?? 0) / group.resultCount : null;
}

/** Checks a result failed (`false`, or precision below 1). */
export function failedChecks(result) {
  const checks = result.checks ?? {};
  return Object.keys(CHECK_LABELS).filter((name) =>
    name === "evidencePrecision"
      ? typeof checks[name] === "number" && checks[name] < 1
      : checks[name] === false,
  );
}

function outcomeLabel(result) {
  return result.dropReason ? `${result.outcome} (${result.dropReason})` : result.outcome;
}

function expectedLabel(result) {
  const expected = result.expected ?? {};
  if (expected.expectedDropReason) return `control: ${expected.expectedDropReason}`;
  return expected.shouldProvoke ? "card" : "no card";
}

function groupLabel(key) {
  return `${key.split} · ${key.promptVersion} · policy ${key.policyVersion ?? "—"} · ${key.model}`;
}

function summaryRows(groups) {
  return groups.map((group) => {
    const { key, outcomes = {} } = group;
    const agreement = group.provokeAgreement ?? {};
    const drop = group.dropReasonMatch ?? {};
    const locale = group.localeCompliance ?? {};
    const linkage = group.criterionLinkage ?? {};
    const precision = group.evidencePrecision ?? {};
    const length = group.questionLength ?? {};
    return [
      key.split,
      key.promptVersion,
      key.policyVersion,
      key.model,
      group.resultCount,
      ...OUTCOMES.map((outcome) => outcomes[outcome] ?? 0),
      fraction(agreement.agree, agreement.checked, agreement.rate),
      fraction(drop.matched, drop.checked, drop.rate),
      fraction(locale.compliant, locale.checked, locale.rate),
      fraction(linkage.linked, linkage.checked, linkage.rate),
      precision.checked ? `${number(precision.mean, 2)} (n=${precision.checked})` : null,
      fraction(precision.requiredCited, precision.requiredChecked),
      length.count ? `${number(length.median)} / ${length.max}` : null,
      length.overLimit,
    ];
  });
}

const SUMMARY_HEADER = [
  "split",
  "promptVersion",
  "policyVersion",
  "model",
  "results",
  ...OUTCOMES,
  "provoke agreement",
  "drop-reason match (controls)",
  "locale compliance",
  "criterion linkage",
  "evidence precision",
  "required evidence cited",
  "question chars (median / max)",
  "over 140",
];

function judgeSection(judge) {
  const items = judge.items;
  const lines = [
    "",
    `## ${JUDGE_HEADING}`,
    "",
    `> Scored by ${judge.judgeModel ?? "an unnamed judge model"}` +
      `${judge.rubricVersion ? ` (rubric ${judge.rubricVersion})` : ""}. LLM judgment is ` +
      "advisory (D-015-05): it never gates a merge on its own; the gate uses the deterministic " +
      "metrics above.",
    "",
  ];
  if (items.length === 0) return [...lines, "No judged questions."];
  lines.push(
    ...table(
      ["criterion", "pass", "rate"],
      JUDGE_CRITERIA.map((criterion) => {
        const scored = items.filter((item) => typeof item.scores[criterion] === "boolean");
        const passed = scored.filter((item) => item.scores[criterion]).length;
        return [
          criterion,
          `${passed}/${scored.length}`,
          percent(scored.length ? passed / scored.length : null),
        ];
      }),
    ),
  );
  const flagged = items.filter((item) =>
    JUDGE_CRITERIA.some((criterion) => item.scores[criterion] === false),
  );
  if (flagged.length) {
    lines.push(
      "",
      ...table(
        ["fixture", "recording", "failed criteria", "judge rationale"],
        flagged.map((item) => [
          item.fixtureId,
          item.recordingIndex ?? 0,
          JUDGE_CRITERIA.filter((criterion) => item.scores[criterion] === false).join(", "),
          item.rationale,
        ]),
      ),
    );
  }
  return lines;
}

function header(title, note) {
  const lines = [`# ${title}`, "", `> ${CLAIM_NOTE}`, ""];
  if (note) lines.push(`_${note}_`, "");
  return lines;
}

export function renderReport(report, { judge } = {}) {
  const results = report.groups.flatMap((group) => group.results);
  const lines = [
    ...header(`Supervisor eval — ${report.mode}`, report.note),
    `- Generated: ${report.generatedAt ?? "—"}; fixtures: ${report.fixtureCount ?? "—"}; results: ${results.length}.`,
    "- Provoke agreement excludes negative-control recordings (scored as drop-reason match); " +
      "locale, criterion, evidence and length metrics cover shown questions only.",
    "",
    "## Summary",
    "",
    ...table(SUMMARY_HEADER, summaryRows(report.groups)),
    "",
    "## Drop reasons",
    "",
    ...table(
      ["group", "drop reasons"],
      report.groups.map((group) => [groupLabel(group.key), distribution(group.dropReasons)]),
    ),
    "",
    "## Flagged results",
    "",
  ];
  const flagged = results.filter((result) => failedChecks(result).length > 0);
  if (flagged.length === 0) {
    lines.push("No result failed a deterministic check.");
  } else {
    lines.push(
      ...table(
        [
          "fixture",
          "split",
          "event",
          "locale",
          "mode",
          "expected",
          "outcome",
          "failed checks",
          "question",
        ],
        flagged.map((result) => [
          result.fixtureId,
          result.split,
          result.event,
          result.locale,
          result.mode,
          expectedLabel(result),
          outcomeLabel(result),
          failedChecks(result)
            .map((name) => CHECK_LABELS[name])
            .join(", "),
          result.decision?.question,
        ]),
      ),
    );
  }
  lines.push(
    "",
    "<details><summary>All results</summary>",
    "",
    ...table(
      [
        "fixture",
        "split",
        "event",
        "locale",
        "mode",
        "model",
        "expected",
        "outcome",
        "question chars",
        "question",
      ],
      results.map((result) => [
        result.fixtureId,
        result.split,
        result.event,
        result.locale,
        result.mode,
        result.model,
        expectedLabel(result),
        outcomeLabel(result),
        result.checks?.questionChars,
        result.decision && result.outcome === "shown" ? result.decision.question : null,
      ]),
    ),
    "",
    "</details>",
  );
  if (judge) lines.push(...judgeSection(judge));
  return `${lines.join("\n")}\n`;
}

/**
 * Pairs base and head groups per split: the only group on each side, or else
 * the groups with the same model. Returns { pairs, unmatched }.
 */
export function pairGroups(base, head) {
  const pairs = [];
  const unmatched = [];
  const splits = [...new Set([...base.groups, ...head.groups].map((group) => group.key.split))];
  for (const split of splits) {
    const left = base.groups.filter((group) => group.key.split === split);
    const right = head.groups.filter((group) => group.key.split === split);
    if (left.length === 1 && right.length === 1) {
      pairs.push([left[0], right[0]]);
      continue;
    }
    const used = new Set();
    for (const group of left) {
      const match = right.find(
        (candidate) => !used.has(candidate) && candidate.key.model === group.key.model,
      );
      if (match) {
        used.add(match);
        pairs.push([group, match]);
      } else unmatched.push({ side: "base", group });
    }
    for (const group of right) if (!used.has(group)) unmatched.push({ side: "head", group });
  }
  return { pairs, unmatched };
}

// Metric rows for the delta table: [label, value(group), kind].
const DELTA_METRICS = [
  ["results", (group) => group.resultCount, "count"],
  ["shown rate", shownRate, "rate"],
  ["provoke agreement", (group) => group.provokeAgreement?.rate ?? null, "rate"],
  ["false provokes", (group) => group.provokeAgreement?.falseProvoke ?? null, "count"],
  ["missed provokes", (group) => group.provokeAgreement?.missedProvoke ?? null, "count"],
  ["drop-reason match (controls)", (group) => group.dropReasonMatch?.rate ?? null, "rate"],
  ["locale compliance", (group) => group.localeCompliance?.rate ?? null, "rate"],
  ["criterion linkage", (group) => group.criterionLinkage?.rate ?? null, "rate"],
  ["evidence precision (mean)", (group) => group.evidencePrecision?.mean ?? null, "ratio"],
  [
    "required evidence cited",
    (group) =>
      group.evidencePrecision?.requiredChecked
        ? group.evidencePrecision.requiredCited / group.evidencePrecision.requiredChecked
        : null,
    "rate",
  ],
  ["median question chars", (group) => group.questionLength?.median ?? null, "count"],
  ["questions over 140 chars", (group) => group.questionLength?.overLimit ?? null, "count"],
];

function formatMetric(value, kind) {
  if (value === null || value === undefined) return null;
  if (kind === "rate") return percent(value);
  if (kind === "ratio") return number(value, 2);
  return String(value);
}

export function formatDelta(before, after, kind) {
  if (before === null || before === undefined || after === null || after === undefined) return null;
  const diff = after - before;
  if (Math.abs(diff) < 1e-9) return "±0";
  const sign = diff > 0 ? "+" : "−";
  const magnitude = Math.abs(diff);
  if (kind === "rate") return `${sign}${(magnitude * 100).toFixed(1)} pp`;
  if (kind === "ratio") return `${sign}${magnitude.toFixed(2)}`;
  return `${sign}${Number.isInteger(magnitude) ? magnitude : magnitude.toFixed(1)}`;
}

function resultSummary(results) {
  if (!results?.length) return null;
  return results
    .map((result) => {
      const failed = failedChecks(result).map((name) => CHECK_LABELS[name]);
      return failed.length
        ? `${outcomeLabel(result)} [${failed.join(", ")}]`
        : outcomeLabel(result);
    })
    .join("; ");
}

function byFixture(report) {
  const map = new Map();
  for (const result of report.groups.flatMap((group) => group.results)) {
    const key = `${result.split}\u0000${result.fixtureId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(result);
  }
  return map;
}

function versionsOf(report, field) {
  return [...new Set(report.groups.map((group) => group.key[field]))].join(", ") || "—";
}

export function renderComparison(base, head, { judge } = {}) {
  const lines = [
    ...header("Supervisor eval comparison"),
    ...table(
      ["", "base", "head"],
      [
        ["mode", base.mode, head.mode],
        ["generated", base.generatedAt, head.generatedAt],
        ["promptVersion", versionsOf(base, "promptVersion"), versionsOf(head, "promptVersion")],
        ["policyVersion", versionsOf(base, "policyVersion"), versionsOf(head, "policyVersion")],
        ["model", versionsOf(base, "model"), versionsOf(head, "model")],
        ["fixtures", base.fixtureCount, head.fixtureCount],
      ],
    ),
  ];
  if (base.note || head.note) {
    lines.push("", `- Base note: ${base.note ?? "—"}`, `- Head note: ${head.note ?? "—"}`);
  }
  const { pairs, unmatched } = pairGroups(base, head);
  for (const [left, right] of pairs) {
    const model =
      left.key.model === right.key.model
        ? left.key.model
        : `${left.key.model} → ${right.key.model}`;
    lines.push(
      "",
      `## ${left.key.split} · ${model}`,
      "",
      ...table(
        ["metric", "base", "head", "Δ"],
        DELTA_METRICS.map(([label, value, kind]) => [
          label,
          formatMetric(value(left), kind),
          formatMetric(value(right), kind),
          formatDelta(value(left), value(right), kind),
        ]),
      ),
    );
    const reasons = [
      ...new Set([...Object.keys(left.dropReasons ?? {}), ...Object.keys(right.dropReasons ?? {})]),
    ].sort();
    if (reasons.length) {
      lines.push(
        "",
        ...table(
          ["drop reason", "base", "head", "Δ"],
          reasons.map((reason) => {
            const before = left.dropReasons?.[reason] ?? 0;
            const after = right.dropReasons?.[reason] ?? 0;
            return [reason, before, after, formatDelta(before, after, "count")];
          }),
        ),
      );
    }
  }
  if (unmatched.length) {
    lines.push(
      "",
      "## Unmatched groups",
      "",
      ...table(
        ["side", "group"],
        unmatched.map(({ side, group }) => [side, groupLabel(group.key)]),
      ),
    );
  }
  const before = byFixture(base);
  const after = byFixture(head);
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .map((key) => {
      const [split, fixtureId] = key.split("\u0000");
      return [fixtureId, split, resultSummary(before.get(key)), resultSummary(after.get(key))];
    })
    .filter(([, , left, right]) => left !== right)
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  lines.push("", "## Changed fixtures", "");
  if (changed.length === 0) lines.push("No fixture changed outcome or checks.");
  else lines.push(...table(["fixture", "split", "base", "head"], changed));
  if (judge) lines.push(...judgeSection(judge));
  return `${lines.join("\n")}\n`;
}

export function parseArgs(argv) {
  const args = { files: [], compare: false, judge: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`${arg} needs a file argument`);
      return next;
    };
    if (arg === "--") continue;
    else if (arg === "--compare") args.compare = true;
    else if (arg === "--judge") args.judge = value();
    else if (arg === "--out") args.out = value();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument "${arg}"`);
    else args.files.push(arg);
  }
  if (!args.help && args.files.length !== (args.compare ? 2 : 1)) {
    throw new Error(
      args.compare
        ? "--compare needs <base.json> <head.json>"
        : "expected exactly one <report.json>",
    );
  }
  return args;
}

const USAGE = [
  "Usage: pnpm eval:report <report.json> [-- --judge <judge.json>] [-- --out <file.md>]",
  "       pnpm eval:report -- --compare <base.json> <head.json> [--judge <judge.json>] [--out <file.md>]",
].join("\n");

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`eval-report: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  let markdown;
  try {
    const judge = args.judge ? readJudge(args.judge) : null;
    markdown = args.compare
      ? renderComparison(readReport(args.files[0]), readReport(args.files[1]), { judge })
      : renderReport(readReport(args.files[0]), { judge });
  } catch (error) {
    console.error(`eval-report: ${error.message}`);
    return 1;
  }
  if (args.out) writeFileSync(args.out, markdown);
  else process.stdout.write(markdown);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
