// QA ledger record schema (spec 015, S-077 / FR-010–FR-011, D-015-07).
//
// Hand-written validators — `dive/` has no JSON-Schema or YAML dependency and
// the ledger must not add one. Each validator takes a parsed JSON value and
// returns a list of path-qualified error strings (`$.guard.kind: must be …`);
// an empty list means the record is valid on its own. Cross-record rules
// (duplicate ids, dangling references) live in load.mjs. Field documentation:
// schema.md next to this file — keep the two in sync.

import { AREA_NAMES } from "./areas.mjs";

export const DEFECT_STATUSES = Object.freeze([
  "open",
  "fixing",
  "fixed",
  "verified",
  "wontfix",
  "duplicate",
]);
export const SEVERITIES = Object.freeze(["P0", "P1", "P2"]);
export const DEFECT_SOURCE_KINDS = Object.freeze(["review", "live-run", "eval", "audit", "user"]);
export const GUARD_KINDS = Object.freeze(["vitest", "cargo", "live-scenario", "eval-fixture"]);
export const SCENARIO_SOURCE_KINDS = Object.freeze(["scenario-catalog", "e2e-journey", "ledger"]);
export const RUN_RESULTS = Object.freeze(["pass", "fail", "blocked", "skipped"]);

/** Statuses that claim the defect no longer reproduces; they need a guard (FR-040). */
export const GUARDED_STATUSES = Object.freeze(["fixed", "verified"]);

export const DEFECT_ID_RE = /^DEF-\d{4,}$/;
export const SCENARIO_ID_RE = /^[A-Z][A-Z0-9]*-\d{2,}$/;
export const RUN_ID_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const VITEST_REF_RE = /^[^\s:][^:]*\.test\.(?:ts|tsx|mjs)::.+$/;
const CARGO_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/;

function checker() {
  const errors = [];
  return {
    errors,
    fail(path, message) {
      errors.push(`${path}: ${message}`);
    },
  };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Each `check*` helper records at most one error and returns whether the value
// passed, so callers can skip dependent checks on a bad value.

function checkObject(c, path, value) {
  if (isObject(value)) return true;
  c.fail(path, `must be an object (got ${describe(value)})`);
  return false;
}

function checkKeys(c, path, value, required, optional) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) c.fail(`${path}.${key}`, "is required");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) c.fail(`${path}.${key}`, "is not a known field");
  }
}

function checkString(c, path, value) {
  if (typeof value === "string" && value.trim() !== "") return true;
  c.fail(path, `must be a non-empty string (got ${describe(value)})`);
  return false;
}

function checkPattern(c, path, value, pattern, label) {
  if (!checkString(c, path, value)) return false;
  if (pattern.test(value)) return true;
  c.fail(path, `must be ${label} (got "${value}")`);
  return false;
}

function checkEnum(c, path, value, allowed) {
  if (allowed.includes(value)) return true;
  c.fail(path, `must be one of ${allowed.join(" | ")} (got ${JSON.stringify(value)})`);
  return false;
}

function checkBoolean(c, path, value) {
  if (typeof value === "boolean") return true;
  c.fail(path, `must be a boolean (got ${describe(value)})`);
  return false;
}

function checkDate(c, path, value) {
  if (!checkPattern(c, path, value, ISO_DATE_RE, "an ISO 8601 date (YYYY-MM-DD[THH:MM[:SS]Z])")) {
    return false;
  }
  if (!Number.isNaN(Date.parse(value))) return true;
  c.fail(path, `is not a real calendar date (got "${value}")`);
  return false;
}

function checkArray(c, path, value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    c.fail(path, `must be an array (got ${describe(value)})`);
    return false;
  }
  if (nonEmpty && value.length === 0) {
    c.fail(path, "must not be empty");
    return false;
  }
  return true;
}

function checkUnique(c, path, values) {
  const seen = new Set();
  values.forEach((value, i) => {
    if (seen.has(value)) c.fail(`${path}[${i}]`, `duplicate entry ${JSON.stringify(value)}`);
    seen.add(value);
  });
}

function checkStringList(c, path, value, { nonEmpty = false } = {}) {
  if (!checkArray(c, path, value, { nonEmpty })) return false;
  value.forEach((item, i) => checkString(c, `${path}[${i}]`, item));
  checkUnique(c, path, value);
  return true;
}

function checkRepoPath(c, path, value) {
  if (!checkString(c, path, value)) return false;
  if (value.startsWith("/") || value.split("/").includes("..") || value.includes("\\")) {
    c.fail(path, `must be a repo-relative POSIX path without ".." (got "${value}")`);
    return false;
  }
  return true;
}

function checkEvidenceList(c, path, value) {
  if (!checkArray(c, path, value)) return;
  value.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    if (!checkObject(c, itemPath, item)) return;
    checkKeys(c, itemPath, item, ["path", "sha256"], []);
    if ("path" in item) checkRepoPath(c, `${itemPath}.path`, item.path);
    if ("sha256" in item) {
      checkPattern(c, `${itemPath}.sha256`, item.sha256, SHA256_RE, "a lowercase hex sha256");
    }
  });
}

function checkAreas(c, path, value) {
  if (!checkArray(c, path, value, { nonEmpty: true })) return;
  value.forEach((area, i) => checkEnum(c, `${path}[${i}]`, area, AREA_NAMES));
  checkUnique(c, path, value);
}

function checkGuard(c, path, guard) {
  if (!checkObject(c, path, guard)) return;
  checkKeys(c, path, guard, ["kind", "ref"], []);
  if (!("kind" in guard) || !checkEnum(c, `${path}.kind`, guard.kind, GUARD_KINDS)) return;
  if (!("ref" in guard)) return;
  const refPath = `${path}.ref`;
  switch (guard.kind) {
    case "vitest":
      checkPattern(
        c,
        refPath,
        guard.ref,
        VITEST_REF_RE,
        '"<repo path>.test.{ts,tsx,mjs}::<test name>"',
      );
      break;
    case "cargo":
      checkPattern(c, refPath, guard.ref, CARGO_REF_RE, 'a cargo test path ("module::test_name")');
      break;
    case "live-scenario":
      checkPattern(c, refPath, guard.ref, SCENARIO_ID_RE, "a scenario id (e.g. SUP-01)");
      break;
    case "eval-fixture":
      checkString(c, refPath, guard.ref);
      break;
  }
}

function checkVerifiedBlock(c, path, verified) {
  if (!checkObject(c, path, verified)) return;
  checkKeys(c, path, verified, ["commit", "buildVersion", "date"], ["evidence"]);
  if ("commit" in verified) {
    checkPattern(c, `${path}.commit`, verified.commit, COMMIT_RE, "a 7–40 char lowercase git sha");
  }
  if ("buildVersion" in verified) checkString(c, `${path}.buildVersion`, verified.buildVersion);
  if ("date" in verified) checkDate(c, `${path}.date`, verified.date);
  if ("evidence" in verified) checkEvidenceList(c, `${path}.evidence`, verified.evidence);
}

const DEFECT_REQUIRED = [
  "id",
  "title",
  "status",
  "severity",
  "area",
  "source",
  "created",
  "updated",
];
const DEFECT_OPTIONAL = [
  "specRef",
  "stageRef",
  "repro",
  "notes",
  "duplicateOf",
  "guard",
  "verified",
];

export function validateDefect(record) {
  const c = checker();
  if (!checkObject(c, "$", record)) return c.errors;
  checkKeys(c, "$", record, DEFECT_REQUIRED, DEFECT_OPTIONAL);

  if ("id" in record) checkPattern(c, "$.id", record.id, DEFECT_ID_RE, "DEF-NNNN");
  if ("title" in record) checkString(c, "$.title", record.title);
  const statusOk = "status" in record && checkEnum(c, "$.status", record.status, DEFECT_STATUSES);
  if ("severity" in record) checkEnum(c, "$.severity", record.severity, SEVERITIES);
  if ("area" in record) checkEnum(c, "$.area", record.area, AREA_NAMES);

  if ("source" in record && checkObject(c, "$.source", record.source)) {
    checkKeys(c, "$.source", record.source, ["kind", "ref"], ["findingId"]);
    if ("kind" in record.source) {
      checkEnum(c, "$.source.kind", record.source.kind, DEFECT_SOURCE_KINDS);
    }
    if ("ref" in record.source) checkString(c, "$.source.ref", record.source.ref);
    if ("findingId" in record.source) checkString(c, "$.source.findingId", record.source.findingId);
  }

  for (const key of ["specRef", "stageRef", "repro", "notes"]) {
    if (key in record) checkString(c, `$.${key}`, record[key]);
  }
  if ("guard" in record) checkGuard(c, "$.guard", record.guard);
  if ("verified" in record) checkVerifiedBlock(c, "$.verified", record.verified);
  if ("duplicateOf" in record) {
    checkPattern(c, "$.duplicateOf", record.duplicateOf, DEFECT_ID_RE, "DEF-NNNN");
    if (record.duplicateOf === record.id) c.fail("$.duplicateOf", "must not point at itself");
  }

  const createdOk = "created" in record && checkDate(c, "$.created", record.created);
  const updatedOk = "updated" in record && checkDate(c, "$.updated", record.updated);
  if (createdOk && updatedOk && Date.parse(record.updated) < Date.parse(record.created)) {
    c.fail("$.updated", "must not be earlier than $.created");
  }

  if (statusOk) {
    const { status } = record;
    if (GUARDED_STATUSES.includes(status) && !("guard" in record)) {
      c.fail("$.guard", `is required when status is "${status}" (FR-040)`);
    }
    if (status === "verified" && !("verified" in record)) {
      c.fail("$.verified", 'is required when status is "verified"');
    }
    if (status !== "verified" && "verified" in record) {
      c.fail("$.verified", `is only allowed when status is "verified" (status is "${status}")`);
    }
    if (status === "wontfix" && !("notes" in record)) {
      c.fail("$.notes", 'is required when status is "wontfix" (record why)');
    }
    if (status === "duplicate" && !("duplicateOf" in record)) {
      c.fail("$.duplicateOf", 'is required when status is "duplicate"');
    }
    if (status !== "duplicate" && "duplicateOf" in record) {
      c.fail("$.duplicateOf", `is only allowed when status is "duplicate" (status is "${status}")`);
    }
  }
  return c.errors;
}

const SCENARIO_REQUIRED = ["id", "title", "source", "areas", "pathGlobs", "priority"];
const SCENARIO_OPTIONAL = [
  "requiresLlm",
  "preconditions",
  "steps",
  "expected",
  "tags",
  "notes",
  "lastPass",
];

export function validateScenario(record) {
  const c = checker();
  if (!checkObject(c, "$", record)) return c.errors;
  checkKeys(c, "$", record, SCENARIO_REQUIRED, SCENARIO_OPTIONAL);

  if ("id" in record) checkPattern(c, "$.id", record.id, SCENARIO_ID_RE, "AREA-NN (e.g. ONB-01)");
  if ("title" in record) checkString(c, "$.title", record.title);
  if ("source" in record && checkObject(c, "$.source", record.source)) {
    checkKeys(c, "$.source", record.source, ["kind", "ref"], []);
    if ("kind" in record.source) {
      checkEnum(c, "$.source.kind", record.source.kind, SCENARIO_SOURCE_KINDS);
    }
    if ("ref" in record.source) checkString(c, "$.source.ref", record.source.ref);
  }
  if ("areas" in record) checkAreas(c, "$.areas", record.areas);
  if ("pathGlobs" in record && checkArray(c, "$.pathGlobs", record.pathGlobs)) {
    record.pathGlobs.forEach((glob, i) => checkRepoPath(c, `$.pathGlobs[${i}]`, glob));
    checkUnique(c, "$.pathGlobs", record.pathGlobs);
  }
  if ("priority" in record) checkEnum(c, "$.priority", record.priority, SEVERITIES);
  if ("requiresLlm" in record) checkBoolean(c, "$.requiresLlm", record.requiresLlm);
  for (const key of ["preconditions", "expected", "notes"]) {
    if (key in record) checkString(c, `$.${key}`, record[key]);
  }
  if ("steps" in record) checkStringList(c, "$.steps", record.steps, { nonEmpty: true });
  if ("tags" in record) checkStringList(c, "$.tags", record.tags);
  if ("lastPass" in record && checkObject(c, "$.lastPass", record.lastPass)) {
    checkKeys(c, "$.lastPass", record.lastPass, ["runId", "date"], []);
    if ("runId" in record.lastPass) {
      checkPattern(c, "$.lastPass.runId", record.lastPass.runId, RUN_ID_RE, "a run id");
    }
    if ("date" in record.lastPass) checkDate(c, "$.lastPass.date", record.lastPass.date);
  }
  return c.errors;
}

const RUN_REQUIRED = [
  "id",
  "date",
  "build",
  "platform",
  "scenarios",
  "defectsOpened",
  "defectsVerified",
  "evidence",
];

export function validateRunRecord(record) {
  const c = checker();
  if (!checkObject(c, "$", record)) return c.errors;
  checkKeys(c, "$", record, RUN_REQUIRED, ["notes"]);

  const idOk = "id" in record && checkPattern(c, "$.id", record.id, RUN_ID_RE, "YYYY-MM-DD-<slug>");
  const dateOk = "date" in record && checkDate(c, "$.date", record.date);
  if (idOk && dateOk && !record.date.startsWith(RUN_ID_RE.exec(record.id)[1])) {
    c.fail("$.id", `date prefix must match $.date (${record.date.slice(0, 10)})`);
  }
  if ("build" in record && checkObject(c, "$.build", record.build)) {
    checkKeys(c, "$.build", record.build, ["version", "commit"], []);
    if ("version" in record.build) checkString(c, "$.build.version", record.build.version);
    if ("commit" in record.build) {
      checkPattern(c, "$.build.commit", record.build.commit, COMMIT_RE, "a 7–40 char git sha");
    }
  }
  if ("platform" in record) checkString(c, "$.platform", record.platform);
  if ("notes" in record) checkString(c, "$.notes", record.notes);

  if ("scenarios" in record && checkArray(c, "$.scenarios", record.scenarios, { nonEmpty: true })) {
    const ids = [];
    record.scenarios.forEach((entry, i) => {
      const path = `$.scenarios[${i}]`;
      if (!checkObject(c, path, entry)) return;
      checkKeys(c, path, entry, ["id", "result"], ["notes"]);
      if (
        "id" in entry &&
        checkPattern(c, `${path}.id`, entry.id, SCENARIO_ID_RE, "a scenario id")
      ) {
        ids.push(entry.id);
      }
      if ("result" in entry) checkEnum(c, `${path}.result`, entry.result, RUN_RESULTS);
      if ("notes" in entry) checkString(c, `${path}.notes`, entry.notes);
    });
    checkUnique(c, "$.scenarios[].id", ids);
  }
  for (const key of ["defectsOpened", "defectsVerified"]) {
    if (!(key in record) || !checkArray(c, `$.${key}`, record[key])) continue;
    record[key].forEach((id, i) => checkPattern(c, `$.${key}[${i}]`, id, DEFECT_ID_RE, "DEF-NNNN"));
    checkUnique(c, `$.${key}`, record[key]);
  }
  if ("evidence" in record) checkEvidenceList(c, "$.evidence", record.evidence);
  return c.errors;
}
