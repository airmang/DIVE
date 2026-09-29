#!/usr/bin/env node
// `pnpm qa:triage` — turn open ledger defects into fix-work drafts (spec 015,
// S-084 / FR-080). Drafts only: nothing is registered in Wily and no spec is
// edited — a human (or root) reviews the drafts and does that.
//
//   pnpm qa:triage [--from-eval <eval-gate-result.json>] [--json] [--date YYYY-MM-DD]
//                  [--out <dir>] [--root <ledger dir>]
//
// Clustering: open/fixing defects are grouped by area; areas whose defects
// share a specRef or stageRef are merged into one cluster (same governing
// spec/Stage ⇒ one piece of work). A cluster's priority comes from its most
// severe defect. For each cluster the draft directory
// (default .harness/triage/<date>/, gitignored) gets:
//   <cluster>.md                 spec-theme stub (umbrella-spec style): defects
//                                with source refs, proposed acceptance and
//                                proposed guard per defect
//   <cluster>.design_stage.json  Wily design_stage payload (scope from the
//                                cluster's area globs, Korean title)
// plus index.md. `--json` prints the summary as JSON instead of text.
//
// --from-eval first turns each eval-gate regression into an open defect
// (source kind eval, eval-fixture guard) through run.mjs's validated,
// crash-safe writer, skipping regressions already open in the ledger. The
// input shape is documented in schema.md (§ Eval-gate result).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AREAS } from "./areas.mjs";
import { REPO_ROOT } from "./git.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger, nextDefectId } from "./load.mjs";
import { commitWrites } from "./run.mjs";
import { SEVERITIES, validateDefect, validateEvalGateResult } from "./schema.mjs";

export const PROJECT_ID = "dive-2";
export const REPO_SLUG = "airmang/DIVE-2";
/** Wily Stage priority is an integer (default 50); higher = sooner. */
export const PRIORITY_BY_SEVERITY = Object.freeze({ P0: 90, P1: 70, P2: 50 });
const TRIAGE_STATUSES = ["open", "fixing"];
const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

/** Korean area labels — Wily requires Korean in Stage titles. */
export const AREA_LABELS_KO = Object.freeze({
  onboarding: "온보딩",
  "project-session": "프로젝트·세션",
  "provider-settings": "AI 연결 설정",
  "pi-sidecar": "Pi 사이드카",
  i18n: "다국어",
  "theme-ui": "테마·UI",
  "shell-layout": "앱 셸·레이아웃",
  chat: "대화",
  "prompt-helper": "프롬프트 도우미",
  permission: "권한 승인",
  "agent-tools": "에이전트 도구",
  "web-egress": "웹 접근",
  mcp: "MCP",
  prd: "PRD",
  plan: "계획",
  roadmap: "로드맵",
  supervision: "감독 카드",
  verification: "검증",
  recovery: "복구·체크포인트",
  "slide-in": "슬라이드 패널",
  preview: "미리보기",
  terminal: "터미널",
  workmap: "작업 맵",
  "eventlog-export": "이벤트 로그·내보내기",
  persistence: "저장소",
  "build-release": "빌드·릴리스",
  "docs-spec": "문서·스펙",
  "app-core": "앱 코어",
});

const bySeverityThenId = (a, b) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id);

/**
 * Cluster open/fixing defects: one cluster per area, then areas linked by a
 * shared specRef/stageRef are merged (union-find). Returns clusters sorted by
 * top severity, then size, then name.
 */
export function clusterDefects(defects) {
  const active = defects.filter((d) => TRIAGE_STATUSES.includes(d.status));
  const parent = new Map(active.map((d) => [d.area, d.area]));
  const find = (area) => (parent.get(area) === area ? area : find(parent.get(area)));
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)].sort();
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const key of ["specRef", "stageRef"]) {
    const firstArea = new Map();
    for (const defect of active) {
      const ref = defect[key];
      if (!ref) continue;
      if (firstArea.has(ref)) union(firstArea.get(ref), defect.area);
      else firstArea.set(ref, defect.area);
    }
  }
  const groups = new Map();
  for (const defect of active) {
    const root = find(defect.area);
    groups.set(root, [...(groups.get(root) ?? []), defect]);
  }
  return [...groups.values()]
    .map((members) => {
      const sorted = [...members].sort(bySeverityThenId);
      const areas = [...new Set(sorted.map((d) => d.area))].sort();
      const severity = sorted[0].severity;
      return {
        id: areas.join("+"),
        areas,
        severity,
        priority: PRIORITY_BY_SEVERITY[severity],
        defects: sorted,
        refs: [...new Set(sorted.flatMap((d) => [d.specRef, d.stageRef].filter(Boolean)))],
      };
    })
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.defects.length - a.defects.length ||
        a.id.localeCompare(b.id),
    );
}

const sourceRef = (defect) => {
  const { kind, ref, findingId } = defect.source;
  const where = ref.startsWith("docs/") ? ref.split("/").pop() : ref;
  return `${kind}: ${where}${findingId ? ` ${findingId}` : ""}`;
};

/** A guard the fix should land with — the defect's own if it has one. */
export function proposedGuard(defect) {
  if (defect.guard) return `${defect.guard.kind} \`${defect.guard.ref}\` (already set)`;
  const globs = AREAS[defect.area] ?? [];
  const rust = globs.some((g) => g.startsWith("dive/src-tauri/"));
  const frontend = globs.some((g) => g.startsWith("dive/src/"));
  if (rust && frontend) return "vitest or cargo test at the layer the fix lands in";
  if (rust) return "cargo test (`--features dev-mock`) through the fixed code path";
  if (frontend) return "vitest (`*.test.ts[x]`) through the fixed code path";
  return "a `dive/scripts/**/*.test.mjs` check (runs under `pnpm test:unit`)";
}

export function proposedAcceptance(defect) {
  return `${defect.id} no longer reproduces — ${defect.title}`;
}

export function clusterTitle(cluster) {
  const labels = cluster.areas.map((area) => AREA_LABELS_KO[area] ?? area).join("·");
  return `QA 원장 정비 — ${labels} 결함 ${cluster.defects.length}건 (${cluster.severity})`;
}

/** The cluster's code footprint for the Stage scope: area globs + the ledger. */
export function scopePaths(cluster) {
  const paths = new Set(cluster.areas.flatMap((area) => AREAS[area] ?? []));
  paths.add("docs/qa/ledger/**");
  return [...paths].sort();
}

export function designStagePayload(cluster) {
  const ids = cluster.defects.map((d) => d.id);
  return {
    project_id: PROJECT_ID,
    title: clusterTitle(cluster),
    intent:
      `Fix ${ids.length} open QA-ledger defect(s) in ${cluster.areas.join(", ")} ` +
      `(${ids.join(", ")}), each closed with a runner-resolvable guard (spec 015 Loop B).`,
    acceptance: [
      ...cluster.defects.map(proposedAcceptance),
      "Each defect moves to fixed with fixCommit set and a guard that pnpm verify:qa-ledger resolves",
    ],
    scope: scopePaths(cluster).map((path) => ({ repo_slug: REPO_SLUG, path })),
    dependency_stage_ids: [],
    code_changes_expected: true,
    priority: cluster.priority,
  };
}

export function specStub(cluster, { date }) {
  const lines = [
    `### Theme — ${clusterTitle(cluster)} → Stage **S-???** (draft)`,
    "",
    `Draft from \`pnpm qa:triage\` on ${date} — not registered, not part of any spec yet.`,
    `Defects: ${cluster.defects.map((d) => `${d.id} (${d.severity})`).join(", ")}.`,
    cluster.refs.length > 0 ? `Governing refs: ${cluster.refs.join(", ")}.` : "",
    `Areas: ${cluster.areas.join(", ")}. Wily priority ${cluster.priority} (top severity ` +
      `${cluster.severity}).`,
    "",
    "| Defect | Sev | Source | Proposed acceptance | Proposed guard |",
    "| ------ | --- | ------ | ------------------- | -------------- |",
    ...cluster.defects.map((d) =>
      [
        "",
        d.id,
        d.severity,
        sourceRef(d),
        proposedAcceptance(d).replace(/\|/g, "\\|"),
        proposedGuard(d).replace(/\|/g, "\\|"),
        "",
      ]
        .join(" | ")
        .trim(),
    ),
    "",
  ];
  const withRepro = cluster.defects.filter((d) => d.repro);
  if (withRepro.length > 0) {
    lines.push("Repro notes:", ...withRepro.map((d) => `- ${d.id}: ${d.repro}`), "");
  }
  return `${lines
    .filter((line, i) => line !== "" || lines[i - 1] !== "")
    .join("\n")
    .trim()}\n`;
}

/**
 * Eval-gate regressions → open defect writes. Skips a regression whose
 * (fixtureId, metric) already has an open/fixing eval defect. Pure: returns
 * `{ writes, skipped, errors }` for commitWrites.
 */
export function evalDefects(ledger, result, { date }) {
  const errors = validateEvalGateResult(result).map((e) => `eval-gate result ${e}`);
  if (errors.length > 0) return { writes: [], skipped: [], errors };
  const openKeys = new Set(
    ledger.defects
      .map((e) => e.record)
      .filter((d) => d.source?.kind === "eval" && TRIAGE_STATUSES.includes(d.status))
      .map((d) => d.source.findingId),
  );
  const writes = [];
  const skipped = [];
  let next = Number(nextDefectId(ledger).slice(4));
  for (const regression of result.regressions) {
    const key = `${regression.fixtureId}:${regression.metric}`;
    if (openKeys.has(key)) {
      skipped.push(key);
      continue;
    }
    openKeys.add(key);
    const id = `DEF-${String(next).padStart(4, "0")}`;
    next += 1;
    const record = {
      id,
      title:
        `Eval regression: ${regression.metric} on ${regression.fixtureId} ` +
        `(${regression.before} → ${regression.after}) at ${result.promptVersion}`,
      status: "open",
      severity: regression.severity,
      area: regression.area ?? "supervision",
      source: {
        kind: "eval",
        ref: `${result.promptVersion} vs ${result.baseline}`,
        findingId: key,
      },
      guard: { kind: "eval-fixture", ref: regression.fixtureId },
      created: date,
      updated: date,
    };
    for (const message of validateDefect(record)) errors.push(`${id}: ${message}`);
    writes.push({ path: `defects/${id}.json`, record });
  }
  return { writes, skipped, errors };
}

export function writeDrafts(clusters, { dir, date }) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const cluster of clusters) {
    const stub = join(dir, `${cluster.id}.md`);
    const payload = join(dir, `${cluster.id}.design_stage.json`);
    writeFileSync(stub, specStub(cluster, { date }));
    writeFileSync(payload, `${JSON.stringify(designStagePayload(cluster), null, 2)}\n`);
    files.push({ cluster: cluster.id, stub, payload });
  }
  const index = [
    `# QA triage drafts — ${date}`,
    "",
    "Drafts only (spec 015 S-084): review, then register Stages / edit specs by hand.",
    "",
    ...clusters.map(
      (c) =>
        `- **${c.id}** — ${c.defects.length} defect(s), top ${c.severity}, priority ` +
        `${c.priority}: \`${c.id}.md\`, \`${c.id}.design_stage.json\``,
    ),
    "",
  ].join("\n");
  writeFileSync(join(dir, "index.md"), index);
  return files;
}

export function summarize(clusters) {
  return clusters.map((c) => ({
    cluster: c.id,
    areas: c.areas,
    severity: c.severity,
    priority: c.priority,
    defects: c.defects.map((d) => d.id),
    title: clusterTitle(c),
  }));
}

export function parseTriageArgs(argv) {
  const args = { root: DEFAULT_LEDGER_ROOT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    const next = argv[(i += 1)];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(
        ["--from-eval", "--date", "--out", "--root"].includes(arg)
          ? `${arg} needs a value`
          : `unknown argument "${arg}"`,
      );
    }
    if (arg === "--from-eval") args.fromEval = resolve(next);
    else if (arg === "--date") args.date = next;
    else if (arg === "--out") args.out = resolve(next);
    else if (arg === "--root") args.root = resolve(next);
    else throw new Error(`unknown argument "${arg}"`);
  }
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date))
    throw new Error("--date takes YYYY-MM-DD");
  return args;
}

function main() {
  let args;
  try {
    args = parseTriageArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`qa:triage: ${error.message}`);
    return 2;
  }
  const date = args.date ?? new Date().toISOString().slice(0, 10);
  let ledger = loadLedger(args.root);
  if (ledger.errors.length > 0) {
    console.error("qa:triage: the ledger is invalid; run pnpm qa:ledger:validate first");
    return 1;
  }

  let opened = [];
  let skipped = [];
  if (args.fromEval) {
    let result;
    try {
      result = JSON.parse(readFileSync(args.fromEval, "utf8"));
    } catch (error) {
      console.error(`qa:triage: cannot read ${args.fromEval}: ${error.message}`);
      return 1;
    }
    const plan = evalDefects(ledger, result, { date });
    const problems = plan.errors.length > 0 ? plan.errors : commitWrites(args.root, plan.writes);
    if (problems.length > 0) {
      console.error(`qa:triage: no eval defects written — ${problems.length} problem(s):`);
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }
    opened = plan.writes.map((w) => w.record.id);
    skipped = plan.skipped;
    ledger = loadLedger(args.root);
  }

  const clusters = clusterDefects(ledger.defects.map((e) => e.record));
  const dir = args.out ?? join(REPO_ROOT, ".harness", "triage", date);
  writeDrafts(clusters, { dir, date });
  const summary = summarize(clusters);
  if (args.json) {
    console.log(
      JSON.stringify(
        { date, dir, evalOpened: opened, evalSkipped: skipped, clusters: summary },
        null,
        2,
      ),
    );
    return 0;
  }
  if (args.fromEval) {
    console.log(
      `qa:triage: ${opened.length} eval defect(s) opened` +
        (skipped.length > 0 ? `, ${skipped.length} already open (${skipped.join(", ")})` : ""),
    );
  }
  const total = clusters.reduce((n, c) => n + c.defects.length, 0);
  console.log(
    `qa:triage: ${total} open/fixing defect(s) in ${clusters.length} cluster(s) → ${dir}`,
  );
  for (const c of summary) {
    console.log(`  [${c.severity} p${c.priority}] ${c.cluster}: ${c.defects.join(", ")}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
