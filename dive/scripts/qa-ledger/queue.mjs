#!/usr/bin/env node
// `pnpm qa:queue [--since <ref>]` — pick the next live-QA run set and write a
// work order (spec 015, S-082 / FR-061). A scenario is selected when:
//
//   (a) it can verify a fixed-but-unverified defect — the defect's
//       live-scenario guard names it, or (other guards) it is one of the 3
//       narrowest scenarios (fewest areas) whose areas include the defect's;
//   (b) files changed since its last pass (the lastPass run's build commit, or
//       `--since <ref>` for every scenario) match its areas' globs — a base
//       commit git can't resolve selects the scenario and warns;
//   (c) it is stale — never passed in a recorded run, or last passed more than
//       `--stale-days` (default 30) days ago;
//   (d) a changed file is cross-cutting (area app-core) or maps to no area at
//       all — then every scenario is selected (unmapped also warns: extend
//       areas.mjs or NON_PRODUCT so it does not happen again).
//
// Non-product files (tests, docs, dev-only demo routes, tooling —
// NON_PRODUCT in areas.mjs) never select anything. Output: a Markdown work
// order at .harness/work-orders/qa/<date>.md (gitignored) with the reasons,
// steps and expected result per scenario plus the release-.app recipe.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AREAS, CROSS_CUTTING_AREA, isNonProduct, matchesGlob, scenarioGlobs } from "./areas.mjs";
import { REPO_ROOT, changedFilesSince, headCommit } from "./git.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger } from "./load.mjs";

export const DEFAULT_STALE_DAYS = 30;
/** Rule (a): scenarios picked per fixed defect whose guard is not a live scenario. */
export const NARROWEST_PER_DEFECT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2 };

/**
 * Split changed files (`{ path, deleted }`) into non-product, cross-cutting,
 * mapped, unmapped, and deleted-unmapped paths. A deleted file that matched no
 * area can't be traced to its former area, so it is unmapped too, but gets its
 * own warning (the fix is not "add it to areas.mjs").
 */
export function classifyFiles(changes) {
  const out = { nonProduct: [], crossCutting: [], unmapped: [], deletedUnmapped: [], mapped: [] };
  const allGlobs = Object.entries(AREAS).filter(([area]) => area !== CROSS_CUTTING_AREA);
  for (const { path: file, deleted } of changes) {
    if (isNonProduct(file)) out.nonProduct.push(file);
    else if (AREAS[CROSS_CUTTING_AREA].some((glob) => matchesGlob(file, glob))) {
      out.crossCutting.push(file);
    } else if (allGlobs.some(([, globs]) => globs.some((glob) => matchesGlob(file, glob)))) {
      out.mapped.push(file);
    } else (deleted ? out.deletedUnmapped : out.unmapped).push(file);
  }
  return out;
}

const listSome = (files, max = 3) =>
  files.slice(0, max).join(", ") + (files.length > max ? ` (+${files.length - max} more)` : "");

/**
 * Select scenarios. Pure apart from the injected `changedFilesSince(ref)`,
 * which returns `[{ path, deleted }]`.
 * Returns `{ selected: [{ scenario, reasons }], warnings }`, sorted by
 * priority then id.
 */
export function selectScenarios(
  ledger,
  { since, staleDays = DEFAULT_STALE_DAYS, today, changedFilesSince: diff },
) {
  const scenarios = ledger.scenarios.map((entry) => entry.record);
  const reasons = new Map(scenarios.map((s) => [s.id, []]));
  const warnings = [];
  const add = (id, reason) => reasons.get(id)?.push(reason);

  // (a) fixed-but-unverified defects.
  const fixed = ledger.defects.map((e) => e.record).filter((d) => d.status === "fixed");
  for (const defect of fixed) {
    if (defect.guard?.kind === "live-scenario") {
      add(defect.guard.ref, `verifies fixed ${defect.id} (its live-scenario guard)`);
    }
  }
  // Test-guarded fixes still need one live pass through their area before
  // they can be verified, but not every scenario in that area: take the
  // narrowest (fewest areas, then priority, then id).
  const byScenario = new Map();
  for (const defect of fixed.filter((d) => d.guard?.kind !== "live-scenario")) {
    const narrowest = scenarios
      .filter((scenario) => scenario.areas.includes(defect.area))
      .sort(
        (a, b) =>
          a.areas.length - b.areas.length ||
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          a.id.localeCompare(b.id),
      )
      .slice(0, NARROWEST_PER_DEFECT);
    for (const scenario of narrowest) {
      byScenario.set(scenario.id, [...(byScenario.get(scenario.id) ?? []), defect.id]);
    }
  }
  for (const [id, defectIds] of byScenario) {
    add(id, `can verify fixed ${listSome(defectIds, 5)} (narrowest scenario in the defect's area)`);
  }

  // (b) + (d) changed files, one diff per base ref.
  const diffs = new Map();
  const unknownBases = new Map();
  const classified = (ref) => {
    if (!diffs.has(ref)) {
      try {
        diffs.set(ref, classifyFiles(diff(ref)));
      } catch (error) {
        // e.g. a lastPass build commit that was rebased away or is absent from
        // a shallow clone: select the scenario rather than abort the queue.
        diffs.set(ref, null);
        unknownBases.set(ref, error.message.split("\n")[0]);
      }
    }
    return diffs.get(ref);
  };
  const baseOf = (scenario) => {
    if (since) return since;
    const runId = scenario.lastPass?.runId;
    return runId ? ledger.byId.runs.get(runId)?.record.build.commit : undefined;
  };
  const selectAll = new Map();
  for (const scenario of scenarios) {
    const ref = baseOf(scenario);
    if (!ref) continue;
    const files = classified(ref);
    if (files === null) {
      add(scenario.id, `base commit ${ref} unknown — cannot diff since its last pass`);
      continue;
    }
    if (files.crossCutting.length > 0) {
      add(scenario.id, `cross-cutting change since ${ref}: ${listSome(files.crossCutting)}`);
    }
    const unmapped = [...files.unmapped, ...files.deletedUnmapped];
    if (unmapped.length > 0) {
      selectAll.set(ref, files);
      add(scenario.id, `unmapped change since ${ref}: ${listSome(unmapped)}`);
    }
    const globs = scenarioGlobs(scenario);
    const hits = files.mapped.filter((file) => globs.some((glob) => matchesGlob(file, glob)));
    if (hits.length > 0) add(scenario.id, `its areas changed since ${ref}: ${listSome(hits)}`);
  }
  for (const [ref, { unmapped, deletedUnmapped }] of selectAll) {
    if (unmapped.length > 0) {
      warnings.push(
        `${unmapped.length} changed file(s) since ${ref} map to no area ` +
          `(${listSome(unmapped, 5)}); selected every scenario that runs from that base. ` +
          "Add them to areas.mjs or NON_PRODUCT.",
      );
    }
    if (deletedUnmapped.length > 0) {
      warnings.push(
        `${deletedUnmapped.length} file(s) deleted since ${ref} matched no current area ` +
          `(${listSome(deletedUnmapped, 5)}); their former area is unknown, so every scenario ` +
          "that runs from that base is selected.",
      );
    }
  }

  for (const [ref, message] of unknownBases) {
    warnings.push(
      `cannot diff from ${ref} (${message}); scenarios based on it were selected. ` +
        "Fetch full history or pass --since <ref>.",
    );
  }

  // (c) stale.
  for (const scenario of scenarios) {
    if (!scenario.lastPass) {
      add(scenario.id, "never passed in a recorded run");
      continue;
    }
    const age = Math.floor((Date.parse(today) - Date.parse(scenario.lastPass.date)) / DAY_MS);
    if (age > staleDays) add(scenario.id, `last pass ${scenario.lastPass.date} (${age} days ago)`);
  }

  const selected = scenarios
    .filter((s) => reasons.get(s.id).length > 0)
    .map((scenario) => ({ scenario, reasons: reasons.get(scenario.id) }))
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.scenario.priority] - PRIORITY_ORDER[b.scenario.priority] ||
        a.scenario.id.localeCompare(b.scenario.id),
    );
  return { selected, warnings };
}

export function renderWorkOrder({ selected, warnings }, { date, head, since, staleDays, total }) {
  const llm = selected.filter(({ scenario }) => scenario.requiresLlm).length;
  const ids = selected.map(({ scenario }) => scenario.id).join(",");
  const lines = [
    `# Live QA work order — ${date}`,
    "",
    `Generated by \`pnpm qa:queue${since ? ` --since ${since}` : ""}\` at HEAD \`${head}\` ` +
      `(spec 015, S-082). ${selected.length} of ${total} scenarios selected ` +
      `(${llm} need a live LLM call); stale after ${staleDays} days.`,
    "",
  ];
  if (warnings.length > 0) {
    lines.push("## Warnings", "", ...warnings.map((w) => `- ${w}`), "");
  }
  lines.push(
    "## Recipe",
    "",
    "Drive the **release `.app`**, never `tauri dev` (dev builds have no LaunchServices",
    "registration and re-prompt the keychain).",
    "",
    "1. Build: `cd dive && pnpm build:sidecar && pnpm tauri build --bundles app`.",
    "2. Launch the binary directly so the environment reaches the app (`open` drops it).",
    "   `DIVE_SESSION_ORIGIN=qa` tags every session as QA so research aggregates exclude it",
    "   (S-076); `DIVE_QA_APP_DATA_DIR` isolates app data for clean-state scenarios:",
    "",
    "   ```sh",
    "   DIVE_SESSION_ORIGIN=qa DIVE_QA_APP_DATA_DIR=/tmp/dive-qa-" + date + " \\",
    "     dive/src-tauri/target/release/bundle/macos/DIVE.app/Contents/MacOS/dive",
    "   ```",
    "",
    "   The direct launch does not inherit `launchctl setenv` variables: if this machine",
    "   uses the local-file secret backend (LaunchAgent `com.coreelab.dive.qa-env`), also pass",
    "   `DIVE_SECRET_BACKEND=local-file DIVE_LOCAL_SECRET_PATH=<its qa-secrets.json>`, or the",
    "   app falls back to the OS keychain.",
    "",
    "   Launching via `open`/Finder instead (no env): write `qa` into",
    "   `$DIVE_QA_APP_DATA_DIR/session-origin` (or `session-origin` in the default app-data",
    "   dir) first, so the persisted override still tags the sessions as QA.",
    "",
    "3. Drive it with macOS computer-use. Take a fresh screenshot before each click;",
    '   cross-check "control does nothing" against the component source before logging it.',
    "4. Record results: `pnpm qa:run init --scenarios " + (ids || "<ids>") + "`, fill in the",
    "   draft (results, new defects under `opened`, confirmed fixes under `verify`, evidence",
    "   paths), then `pnpm qa:run apply <draft>`.",
    "",
    "## Scenarios",
    "",
  );
  for (const { scenario, reasons } of selected) {
    const tags = [scenario.priority, scenario.requiresLlm ? "LLM" : null].filter(Boolean);
    lines.push(`### ${scenario.id} — ${scenario.title} (${tags.join(", ")})`, "");
    lines.push("Why:", ...reasons.map((r) => `- ${r}`), "");
    if (scenario.preconditions) lines.push(`Preconditions: ${scenario.preconditions}`, "");
    if (scenario.steps?.length) {
      lines.push("Steps:", ...scenario.steps.map((step, i) => `${i + 1}. ${step}`), "");
    }
    if (scenario.expected) lines.push(`Expected: ${scenario.expected}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The selection rule behind a reason line, for the stdout summary. */
export function reasonKind(reason) {
  if (reason.startsWith("verifies fixed")) return "(a) live-scenario guard of a fixed defect";
  if (reason.startsWith("can verify fixed")) return "(a) narrowest scenario for a fixed defect";
  if (reason.startsWith("its areas changed")) return "(b) its areas changed";
  if (reason.startsWith("base commit")) return "(b) base commit unknown";
  if (reason.startsWith("cross-cutting")) return "(d) cross-cutting change";
  if (reason.startsWith("unmapped")) return "(d) unmapped change";
  if (reason.startsWith("never passed")) return "(c) never passed";
  if (reason.startsWith("last pass")) return "(c) stale";
  return reason;
}

export function parseQueueArgs(argv) {
  const args = { root: DEFAULT_LEDGER_ROOT, staleDays: DEFAULT_STALE_DAYS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--since") args.since = value();
    else if (arg === "--root") args.root = resolve(value());
    else if (arg === "--out") args.out = resolve(value());
    else if (arg === "--today") args.today = value();
    else if (arg === "--stale-days") {
      args.staleDays = Number(value());
      if (!Number.isInteger(args.staleDays) || args.staleDays < 0) {
        throw new Error("--stale-days takes a non-negative integer");
      }
    } else throw new Error(`unknown argument "${arg}"`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseQueueArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`qa:queue: ${error.message}`);
    return 2;
  }
  const ledger = loadLedger(args.root);
  if (ledger.errors.length > 0) {
    console.error("qa:queue: the ledger is invalid; run pnpm qa:ledger:validate first");
    return 1;
  }
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  let result;
  try {
    result = selectScenarios(ledger, {
      since: args.since,
      staleDays: args.staleDays,
      today,
      changedFilesSince,
    });
  } catch (error) {
    console.error(`qa:queue: ${error.message}`);
    return 1;
  }
  const markdown = renderWorkOrder(result, {
    date: today,
    head: headCommit(),
    since: args.since,
    staleDays: args.staleDays,
    total: ledger.scenarios.length,
  });
  const out = args.out ?? join(REPO_ROOT, ".harness", "work-orders", "qa", `${today}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdown);
  for (const warning of result.warnings) console.warn(`qa:queue: warning — ${warning}`);
  console.log(
    `qa:queue: ${result.selected.length} of ${ledger.scenarios.length} scenario(s) selected → ${out}`,
  );
  const tally = new Map();
  for (const { reasons } of result.selected) {
    for (const reason of reasons) {
      tally.set(reasonKind(reason), (tally.get(reasonKind(reason)) ?? 0) + 1);
    }
  }
  for (const [kind, count] of tally) console.log(`  ${count} × ${kind}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
