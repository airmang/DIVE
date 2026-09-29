// QA ledger loader (spec 015, S-077).
//
// Reads every record under docs/qa/ledger/{defects,scenarios,runs}/, runs the
// per-record validators from schema.mjs, and adds the cross-record rules a
// single file cannot check: filename == `<id>.json`, unique ids, and that
// references (duplicateOf, live-scenario guards, run → scenario/defect ids,
// lastPass → run) point at records that exist. A missing collection directory
// is an empty collection — git does not track empty directories.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFECT_ID_RE, validateDefect, validateRunRecord, validateScenario } from "./schema.mjs";

export const DEFAULT_LEDGER_ROOT = fileURLToPath(
  new URL("../../../docs/qa/ledger", import.meta.url),
);

const COLLECTIONS = Object.freeze({
  defects: validateDefect,
  scenarios: validateScenario,
  runs: validateRunRecord,
});

// Non-record files allowed inside a collection directory.
const IGNORED_FILES = new Set(["README.md", ".DS_Store"]);

function readCollection(root, name, validate, errors) {
  const dir = join(root, name);
  if (!existsSync(dir)) return [];
  const entries = [];
  for (const file of readdirSync(dir).sort()) {
    const where = `${name}/${file}`;
    if (IGNORED_FILES.has(file)) continue;
    if (!file.endsWith(".json")) {
      errors.push(`${where}: only <id>.json records belong in ${name}/`);
      continue;
    }
    let record;
    try {
      record = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      errors.push(`${where}: invalid JSON (${error.message})`);
      continue;
    }
    for (const message of validate(record)) errors.push(`${where}: ${message}`);
    const id = record && typeof record === "object" ? record.id : undefined;
    if (typeof id === "string" && file !== `${id}.json`) {
      errors.push(`${where}: filename must be "${id}.json" to match $.id`);
    }
    entries.push({ file: where, record });
  }
  return entries;
}

function indexById(entries, errors) {
  const byId = new Map();
  for (const entry of entries) {
    const { id } = entry.record ?? {};
    if (typeof id !== "string") continue;
    const first = byId.get(id);
    if (first) {
      errors.push(`${entry.file}: duplicate id "${id}" (also in ${first.file})`);
    } else {
      byId.set(id, entry);
    }
  }
  return byId;
}

function checkReferences(ledger, errors) {
  const { defects, scenarios, runs } = ledger.byId;
  for (const { file, record } of ledger.defects) {
    if (record?.duplicateOf && DEFECT_ID_RE.test(record.duplicateOf)) {
      const target = defects.get(record.duplicateOf);
      if (!target) {
        errors.push(`${file}: $.duplicateOf: unknown defect "${record.duplicateOf}"`);
      } else if (target.record.status === "duplicate") {
        errors.push(`${file}: $.duplicateOf: "${record.duplicateOf}" is itself a duplicate`);
      }
    }
    const verifiedRun = record?.verified?.runId;
    if (typeof verifiedRun === "string") {
      const run = runs.get(verifiedRun)?.record;
      if (!run) {
        errors.push(`${file}: $.verified.runId: unknown run "${verifiedRun}"`);
      } else if (!run.defectsVerified?.includes(record.id)) {
        errors.push(
          `${file}: $.verified.runId: run "${verifiedRun}" does not list it in defectsVerified`,
        );
      }
    }
    if (record?.guard?.kind === "live-scenario" && !scenarios.has(record.guard.ref)) {
      errors.push(`${file}: $.guard.ref: unknown scenario "${record.guard.ref}"`);
    }
  }
  for (const { file, record } of ledger.scenarios) {
    const runId = record?.lastPass?.runId;
    if (typeof runId !== "string") continue;
    const run = runs.get(runId)?.record;
    if (!run) {
      errors.push(`${file}: $.lastPass.runId: unknown run "${runId}"`);
      continue;
    }
    const result = (Array.isArray(run.scenarios) ? run.scenarios : []).find(
      (entry) => entry?.id === record.id,
    )?.result;
    if (result !== "pass") {
      const got = result === undefined ? "does not include this scenario" : `recorded "${result}"`;
      errors.push(`${file}: $.lastPass.runId: run "${runId}" ${got}, not "pass"`);
    }
    if (record.lastPass.date !== run.date) {
      errors.push(`${file}: $.lastPass.date: must equal the run's date "${run.date}"`);
    }
  }
  for (const { file, record } of ledger.runs) {
    (Array.isArray(record?.scenarios) ? record.scenarios : []).forEach((entry, i) => {
      if (typeof entry?.id === "string" && !scenarios.has(entry.id)) {
        errors.push(`${file}: $.scenarios[${i}].id: unknown scenario "${entry.id}"`);
      }
    });
    for (const key of ["defectsOpened", "defectsVerified"]) {
      (Array.isArray(record?.[key]) ? record[key] : []).forEach((id, i) => {
        if (typeof id === "string" && !defects.has(id)) {
          errors.push(`${file}: $.${key}[${i}]: unknown defect "${id}"`);
        }
      });
    }
  }
}

/**
 * Load and check the whole ledger. Returns `{ root, defects, scenarios, runs,
 * byId, errors }`; `errors` is empty iff every record and reference is valid.
 */
export function loadLedger(root = DEFAULT_LEDGER_ROOT) {
  const errors = [];
  if (!existsSync(root)) {
    errors.push(`${root}: ledger root does not exist`);
  } else if (!existsSync(join(root, "defects")) && !existsSync(join(root, "scenarios"))) {
    errors.push(`${root}: not a QA ledger (no defects/ or scenarios/ directory)`);
  }
  const ledger = { root, errors, byId: {} };
  for (const [name, validate] of Object.entries(COLLECTIONS)) {
    ledger[name] = readCollection(root, name, validate, errors);
    ledger.byId[name] = indexById(ledger[name], errors);
  }
  checkReferences(ledger, errors);
  return ledger;
}

/** Next free defect id: one past the highest existing number, zero-padded to 4. */
export function nextDefectId(ledger) {
  let max = 0;
  for (const id of ledger.byId.defects.keys()) {
    if (DEFECT_ID_RE.test(id)) max = Math.max(max, Number(id.slice(4)));
  }
  return `DEF-${String(max + 1).padStart(4, "0")}`;
}
