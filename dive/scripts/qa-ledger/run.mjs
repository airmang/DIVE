#!/usr/bin/env node
// `pnpm qa:run` — live-QA run records (spec 015, S-082 / FR-060).
//
//   pnpm qa:run init --scenarios SUP-01,VC-02 [--slug rc11-smoke] [--platform macos-arm64]
//                    [--date YYYY-MM-DD] [--out <draft.json>]
//     Writes a draft (default .harness/work-orders/qa/runs/<run id>.draft.json,
//     gitignored) with the build under test — version from dive/package.json,
//     commit = git HEAD, dirty = uncommitted changes — a startedAt timestamp,
//     and one `"result": "TODO"` entry per scenario.
//
//   pnpm qa:run apply <draft.json>
//     Fill the draft in while testing, then apply it. Apply writes
//     runs/<id>.json and every ledger change the run implies, all-or-nothing:
//       - `opened: [{ title, severity, area, repro?, notes? }]` → new DEF-NNNN
//         records (status open, source live-run = this run);
//       - `verify: ["DEF-0019", ...]` → fixed → verified with a `verified`
//         block (this build, date, runId, evidence). Refused unless the build
//         is clean (build.dirty false), the defect has a `fixCommit` the build
//         contains (git ancestry), and this run passed the defect's
//         live-scenario guard — or, for a test guard, some scenario in the
//         defect's area;
//       - `evidence: ["docs/.../shot.png", ...]` → `{ path, sha256 }` (files
//         must exist; binaries may stay gitignored — the hash pins them);
//       - every `pass` result sets that scenario's `lastPass`.
//     The result is validated as a whole ledger before anything is written,
//     then written temp-file + rename, run record first.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, commitPresence, headCommit, isAncestor, isDirty } from "./git.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger, nextDefectId } from "./load.mjs";
import { RUN_ID_RE, RUN_RESULTS, validateDefect } from "./schema.mjs";

export const DRAFT_DIR = join(REPO_ROOT, ".harness", "work-orders", "qa", "runs");
const LIVE_RUN_SOURCE = "live-run";

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function defaultPlatform(platform = process.platform, arch = process.arch) {
  const os = { darwin: "macos", win32: "windows" }[platform] ?? platform;
  return `${os}-${arch}`;
}

/** Build a run draft. Pure: build info, date and ledger come from the caller. */
export function createDraft(ledger, { scenarios, build, date, startedAt, platform, slug }) {
  const errors = [];
  if (scenarios.length === 0) errors.push("--scenarios must name at least one scenario");
  for (const id of scenarios) {
    if (!ledger.byId.scenarios.has(id)) errors.push(`unknown scenario "${id}"`);
  }
  const id = `${date}-${slugify(slug || build.version)}`;
  if (!RUN_ID_RE.test(id)) errors.push(`run id "${id}" is not YYYY-MM-DD-<slug>`);
  if (ledger.byId.runs.has(id)) errors.push(`run "${id}" already exists; pass another --slug`);
  const draft = {
    _instructions:
      "Set each result to pass|fail|blocked|skipped (notes optional). List new defects in " +
      "`opened` ({ title, severity P0-P2, area, repro?, notes? }), fixed defects this build " +
      "confirmed in `verify`, and evidence file paths in `evidence`. Then: pnpm qa:run apply <this file>",
    id,
    date,
    startedAt,
    build,
    platform,
    scenarios: [...new Set(scenarios)].map((scenario) => ({
      id: scenario,
      result: "TODO",
      notes: "",
    })),
    opened: [],
    verify: [],
    evidence: [],
    notes: "",
  };
  return { draft, errors };
}

/**
 * Compute every ledger write a filled-in draft implies. Pure apart from the
 * injected `isAncestor` / `commitPresence` / `hashFile`. Returns `{ writes, errors }` where each
 * write is `{ path (relative to the ledger root), record }`.
 */
export function applyDraft(
  ledger,
  draft,
  { isAncestor: ancestor, commitPresence: presence = () => "present", hashFile },
) {
  const errors = [];
  const writes = [];
  const runId = draft.id;
  const date = draft.date;
  if (ledger.byId.runs.has(runId)) errors.push(`run "${runId}" already exists`);

  const scenarios = (draft.scenarios ?? []).map((entry) => {
    if (!RUN_RESULTS.includes(entry.result)) {
      errors.push(`scenario ${entry.id}: result must be one of ${RUN_RESULTS.join(" | ")}`);
    }
    const notes = entry.notes?.trim();
    return { id: entry.id, result: entry.result, ...(notes ? { notes } : {}) };
  });
  const passed = new Set(scenarios.filter((s) => s.result === "pass").map((s) => s.id));

  const evidence = [];
  for (const path of draft.evidence ?? []) {
    try {
      evidence.push({ path, sha256: hashFile(path) });
    } catch (error) {
      errors.push(`evidence ${path}: ${error.message}`);
    }
  }

  // Opened defects get consecutive ids after the current highest.
  const defectsOpened = [];
  let next = Number(nextDefectId(ledger).slice(4));
  for (const [i, opened] of (draft.opened ?? []).entries()) {
    const id = `DEF-${String(next).padStart(4, "0")}`;
    next += 1;
    const record = {
      id,
      title: opened.title,
      status: "open",
      severity: opened.severity,
      area: opened.area,
      source: { kind: LIVE_RUN_SOURCE, ref: runId },
      ...(opened.repro ? { repro: opened.repro } : {}),
      ...(opened.notes ? { notes: opened.notes } : {}),
      created: date,
      updated: date,
    };
    for (const message of validateDefect(record)) errors.push(`opened[${i}]: ${message}`);
    defectsOpened.push(id);
    writes.push({ path: `defects/${id}.json`, record });
  }

  const defectsVerified = [];
  for (const id of draft.verify ?? []) {
    const record = ledger.byId.defects.get(id)?.record;
    if (!record) {
      errors.push(`verify ${id}: unknown defect`);
      continue;
    }
    if (record.status !== "fixed") {
      errors.push(`verify ${id}: status is "${record.status}", only "fixed" can become verified`);
      continue;
    }
    if (draft.build?.dirty !== false) {
      errors.push(
        `verify ${id}: the build under test was made from a dirty tree (build.dirty), so it ` +
          "is not exactly the recorded commit; rebuild from a clean checkout",
      );
      continue;
    }
    if (!record.fixCommit) {
      errors.push(`verify ${id}: no fixCommit, so this build cannot be shown to contain the fix`);
      continue;
    }
    const fixPresence = presence(record.fixCommit);
    if (fixPresence !== "present") {
      errors.push(
        fixPresence === "shallow"
          ? `verify ${id}: fix commit ${record.fixCommit} is not in this shallow clone; fetch full history`
          : `verify ${id}: fix commit ${record.fixCommit} not in history (squashed/rebased?)`,
      );
      continue;
    }
    if (!ancestor(record.fixCommit, draft.build?.commit)) {
      errors.push(
        `verify ${id}: build ${draft.build?.commit} does not contain fix commit ${record.fixCommit}`,
      );
      continue;
    }
    if (record.guard?.kind === "live-scenario") {
      if (!passed.has(record.guard.ref)) {
        errors.push(
          `verify ${id}: its guard scenario ${record.guard.ref} did not pass in this run`,
        );
        continue;
      }
    } else {
      // A test guard proves the fix in CI; the live run must still have
      // exercised the defect's area in the built app.
      const covering = [...passed].filter((sid) =>
        ledger.byId.scenarios.get(sid)?.record.areas.includes(record.area),
      );
      if (covering.length === 0) {
        errors.push(
          `verify ${id}: no scenario in area "${record.area}" passed in this run, so the ` +
            "built app never exercised the fix",
        );
        continue;
      }
    }
    defectsVerified.push(id);
    writes.push({
      path: `defects/${id}.json`,
      record: {
        ...record,
        status: "verified",
        verified: {
          commit: draft.build.commit,
          buildVersion: draft.build.version,
          date,
          runId,
          ...(evidence.length > 0 ? { evidence } : {}),
        },
        updated: date,
      },
    });
  }

  for (const id of passed) {
    const record = ledger.byId.scenarios.get(id)?.record;
    if (record) {
      writes.push({
        path: `scenarios/${id}.json`,
        record: { ...record, lastPass: { runId, date } },
      });
    }
  }

  const run = {
    id: runId,
    date,
    startedAt: draft.startedAt,
    build: draft.build,
    platform: draft.platform,
    scenarios,
    defectsOpened,
    defectsVerified,
    evidence,
    ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
  };
  writes.push({ path: `runs/${runId}.json`, record: run });
  return { writes, errors };
}

const toJson = (record) => `${JSON.stringify(record, null, 2)}\n`;

/**
 * Validate `writes` against a scratch copy of the ledger, then commit them to
 * `root` crash-safely: every file is first written as a temp file next to its
 * target, then renamed into place (rename is atomic per file) — the run record
 * first, so an interrupted apply leaves a run that names what it was applying.
 */
export function commitWrites(root, writes, { rename = renameSync } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "qa-ledger-apply-"));
  try {
    cpSync(root, scratch, { recursive: true });
    for (const { path, record } of writes) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), toJson(record));
    }
    const { errors } = loadLedger(scratch);
    if (errors.length > 0) return errors;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const ordered = [
    ...writes.filter(({ path }) => path.startsWith("runs/")),
    ...writes.filter(({ path }) => !path.startsWith("runs/")),
  ];
  const staged = ordered.map(({ path, record }) => {
    const target = join(root, path);
    const temp = `${target}.tmp-${process.pid}`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temp, toJson(record));
    return { temp, target };
  });
  for (const { temp, target } of staged) rename(temp, target);
  return [];
}

function hashRepoFile(path) {
  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) throw new Error("file does not exist (paths are repo-relative)");
  return createHash("sha256").update(readFileSync(full)).digest("hex");
}

function parseArgs(argv) {
  const [command, ...rest] = argv.filter((arg) => arg !== "--");
  const args = { command, positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      args.positional.push(arg);
      continue;
    }
    const value = rest[(i += 1)];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    args[arg.slice(2)] = value;
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`qa:run: ${error.message}`);
    return 2;
  }
  const root = args.root ? resolve(args.root) : DEFAULT_LEDGER_ROOT;
  const ledger = loadLedger(root);
  if (ledger.errors.length > 0) {
    console.error("qa:run: the ledger is invalid; run pnpm qa:ledger:validate first");
    return 1;
  }

  if (args.command === "init") {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "dive", "package.json"), "utf8"));
    const { draft, errors } = createDraft(ledger, {
      scenarios: (args.scenarios ?? "").split(",").filter(Boolean),
      build: { version: pkg.version, commit: headCommit(), dirty: isDirty() },
      date: args.date ?? new Date().toISOString().slice(0, 10),
      startedAt: new Date().toISOString(),
      platform: args.platform ?? defaultPlatform(),
      slug: args.slug,
    });
    if (errors.length > 0) {
      for (const error of errors) console.error(`qa:run: ${error}`);
      return 1;
    }
    const out = resolve(args.out ?? join(DRAFT_DIR, `${draft.id}.draft.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, toJson(draft));
    console.log(`qa:run: draft written to ${out}`);
    if (draft.build.dirty) {
      console.warn(
        "qa:run: warning — the working tree has uncommitted changes (build.dirty = true); a " +
          `build from it is not exactly ${draft.build.commit}, so this run can record results ` +
          "and open defects but cannot verify fixes. Commit and rebuild to verify.",
      );
    }
    return 0;
  }

  if (args.command === "apply" && args.positional.length === 1) {
    const draft = JSON.parse(readFileSync(resolve(args.positional[0]), "utf8"));
    const { writes, errors } = applyDraft(ledger, draft, {
      isAncestor,
      commitPresence,
      hashFile: hashRepoFile,
    });
    const problems = errors.length > 0 ? errors : commitWrites(root, writes);
    if (problems.length > 0) {
      console.error(`qa:run: nothing written — ${problems.length} problem(s):`);
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }
    for (const { path } of writes) console.log(`  wrote ${path}`);
    console.log(`qa:run: applied ${draft.id}`);
    return 0;
  }

  console.error("Usage: pnpm qa:run init --scenarios A-01,B-02 [...] | pnpm qa:run apply <draft>");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
