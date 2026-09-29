#!/usr/bin/env node
// `pnpm eval:fixtures` — format + coverage check of the SupervisorAgent golden
// set in dive/eval/supervisor/fixtures/ (spec 015, S-079, FR-030). Format:
// dive/eval/supervisor/README.md. The Rust runner (`eval::supervisor`) runs the
// recordings through the real validation path; this check keeps the files it
// deserializes well-formed and the dev/holdout matrix complete. Runs in CI via
// eval-fixtures.test.mjs.
//
// Usage: node scripts/eval-fixtures.mjs [--root <fixtures dir>] [--rehash]
//   --rehash  rewrite each context.contextHash from its content (after a
//             hand edit), then validate

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "eval",
  "supervisor",
  "fixtures",
);

export const SPLITS = ["dev", "holdout"];
export const LOCALES = ["ko-KR", "en-US"];
export const MODES = ["work", "guided"];
// Serde names of `SupervisorEvent` and the one concern the validator accepts
// for each (`expected_concern_for_event`, src-tauri/src/dive/supervisor).
export const EVENT_CONCERNS = {
  ai_claimed_done: "ai_self_report_only",
  verify_entered: "ai_self_report_only",
  scope_expansion: "scope_expansion",
  plan_drafted: "plan_draft_weakness",
  diff_ready: "diff_scope_drift",
  retry_loop: "retry_loop",
};
export const EVENTS = Object.keys(EVENT_CONCERNS);
// Negative controls the recorded mode must exercise (FR-031).
export const REQUIRED_CONTROL_DROP_REASONS = [
  "not_question",
  "unknown_evidence_ref",
  "parse_error",
  "disallowed_concern",
];
export const MIN_FIXTURES = 30;

const DROP_REASONS = [
  "provoke_false",
  "runtime_unavailable",
  "timeout",
  "sidecar_error",
  "parse_error",
  "schema_version_unsupported",
  "invalid_mode",
  "missing_evidence",
  "unknown_evidence_ref",
  "not_question",
  "unknown_action",
  "disallowed_concern",
  "duplicate",
  "cooldown",
  "ambiguous_decision",
  "context_too_large",
  "content_too_long",
];
const ACTION_IDS = [
  "open_diff",
  "open_preview",
  "run_tests",
  "run_app",
  "link_criterion",
  "split_scope",
  "edit_prd",
  "add_verification_step",
  "ask_ai_for_rationale",
  "revert_unrelated_changes",
  "create_repro_steps",
  "rollback_last_change",
  "dismiss_review",
];
const EVIDENCE_SOURCES = [
  "goal",
  "plan",
  "prompt",
  "diff",
  "verification",
  "terminal",
  "agent",
  "workmap",
  "history",
  "ui_observation",
];
const EVIDENCE_KINDS = [
  "assistant_claim",
  "verify_log",
  "test_result",
  "diff_review",
  "preview_observed",
  "app_launched",
  "manual_check",
  "changed_file",
  "terminal_error",
  "plan_step",
  "acceptance_criteria",
  "prd_scope",
  "add_step_draft",
  "scope_expansion_assessment",
  "plan_draft_assessment",
  "verification_coverage",
  "criterion_linkage",
  "broad_step",
  "expected_file",
  "step_scope",
  "diff_view",
  "diff_ready_assessment",
  "failure_summary",
  "recovery_state",
  "retry_loop_assessment",
  "retry_count",
];
// The per-event assessment field each event carries (and no other).
const ASSESSMENT_FIELD = {
  scope_expansion: "scopeExpansion",
  plan_drafted: "planDraftAssessment",
  diff_ready: "diffReadyAssessment",
  retry_loop: "retryLoopAssessment",
};
const CONTEXT_KEYS = [
  "schemaVersion",
  "event",
  "artifactRef",
  "contextHash",
  "mode",
  "locale",
  "allowedActionIds",
  "goalSummary",
  "planSummary",
  "verificationState",
  "feasibility",
  "evidenceRefs",
  ...Object.values(ASSESSMENT_FIELD),
];
const FIXTURE_KEYS = [
  "schemaVersion",
  "id",
  "event",
  "locale",
  "mode",
  "description",
  "context",
  "expect",
  "recorded",
];
const EXPECT_KEYS = [
  "shouldProvoke",
  "gatePasses",
  "allowedConcerns",
  "requiredEvidenceRefIds",
  "relevantEvidenceRefIds",
  "criterionTerms",
  "locale",
  "expectedDropReason",
];
const RECORDING_KEYS = ["rawOutput", "model", "recordedAt", "source"];
const RECORDING_SOURCES = ["hand-authored", "live"];
const PROMPT_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)\+[0-9a-f]{8}$/;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/;

/** Byte-for-byte `serde_json::to_vec` of a `json!` value (BTreeMap: sorted keys). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Port of `SupervisorContext::compute_context_hash` (context.rs). */
export function computeContextHash(context) {
  const ids = (context.evidenceRefs ?? []).map((evidence) => evidence.id);
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const basis = {
    schemaVersion: context.schemaVersion,
    event: context.event,
    artifactRef: { kind: context.artifactRef?.kind, id: context.artifactRef?.id },
    evidenceRefIds: ids,
    verificationState: context.verificationState,
    feasibility: context.feasibility,
    scopeExpansion: context.scopeExpansion ?? null,
    planDraftAssessment: context.planDraftAssessment ?? null,
    diffReadyAssessment: context.diffReadyAssessment ?? null,
    retryLoopAssessment: context.retryLoopAssessment ?? null,
  };
  return `sha256:${createHash("sha256").update(canonicalJson(basis)).digest("hex")}`;
}

/** Text a criterion term may be quoted from: goal, artifact, active step, evidence. */
export function contextText(context) {
  return JSON.stringify([
    context.goalSummary,
    context.artifactRef?.label,
    context.planSummary?.activeStep,
    (context.evidenceRefs ?? []).map((evidence) => [evidence.label, evidence.valueSummary]),
  ]).toLowerCase();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWellFormedEvidenceId(value) {
  return /^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(value);
}

function compareSemver(a, b) {
  const pa = PROMPT_VERSION_RE.exec(a).slice(1, 4).map(Number);
  const pb = PROMPT_VERSION_RE.exec(b).slice(1, 4).map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2] || a.localeCompare(b);
}

function unknownKeys(object, allowed) {
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

function validateContext(context, problems) {
  for (const key of unknownKeys(context, CONTEXT_KEYS))
    problems.push(`context: unknown key "${key}"`);
  if (context.schemaVersion !== 1) problems.push("context.schemaVersion must be 1");
  if (!EVENTS.includes(context.event)) problems.push(`context.event "${context.event}" is unknown`);
  const ref = context.artifactRef;
  if (!isObject(ref) || !["kind", "id", "label"].every((key) => typeof ref[key] === "string")) {
    problems.push("context.artifactRef needs string kind, id, label");
  }
  if (!MODES.includes(context.mode)) problems.push(`context.mode "${context.mode}" is unknown`);
  if (!LOCALES.includes(context.locale))
    problems.push(`context.locale "${context.locale}" is unknown`);
  if (
    !isStringArray(context.allowedActionIds) ||
    context.allowedActionIds.some((id) => !ACTION_IDS.includes(id))
  ) {
    problems.push("context.allowedActionIds must list known SupervisorActionId values");
  }
  if (typeof context.goalSummary !== "string")
    problems.push("context.goalSummary must be a string");
  const plan = context.planSummary;
  if (
    !isObject(plan) ||
    !Number.isInteger(plan.stepCount) ||
    !(plan.activeStep === null || typeof plan.activeStep === "string")
  ) {
    problems.push("context.planSummary needs integer stepCount and string|null activeStep");
  }
  const state = context.verificationState;
  if (
    !isObject(state) ||
    typeof state.aiSelfReport !== "boolean" ||
    typeof state.concreteEvidence !== "boolean" ||
    ![null, "pass", "fail", "skipped"].includes(state.testResult)
  ) {
    problems.push("context.verificationState needs aiSelfReport, concreteEvidence, testResult");
  }
  const feasibility = context.feasibility;
  if (
    !isObject(feasibility) ||
    !["runnable", "previewable", "hasTests", "diffAvailable"].every(
      (key) => typeof feasibility[key] === "boolean",
    )
  ) {
    problems.push(
      "context.feasibility needs boolean runnable, previewable, hasTests, diffAvailable",
    );
  }
  if (!Array.isArray(context.evidenceRefs)) {
    problems.push("context.evidenceRefs must be an array");
  } else {
    const seen = new Set();
    for (const evidence of context.evidenceRefs) {
      const where = `context.evidenceRefs "${evidence?.id}"`;
      if (!isObject(evidence) || !isWellFormedEvidenceId(evidence.id ?? "")) {
        problems.push(`${where}: id must be a well-formed dotted id`);
        continue;
      }
      if (seen.has(evidence.id)) problems.push(`${where}: duplicate id`);
      seen.add(evidence.id);
      if (!EVIDENCE_SOURCES.includes(evidence.source)) problems.push(`${where}: unknown source`);
      if (!EVIDENCE_KINDS.includes(evidence.kind)) problems.push(`${where}: unknown kind`);
      if (typeof evidence.label !== "string") problems.push(`${where}: label must be a string`);
      if (!("valueSummary" in evidence)) problems.push(`${where}: missing valueSummary`);
      if (typeof evidence.verificationEvidence !== "boolean") {
        problems.push(`${where}: verificationEvidence must be boolean`);
      }
    }
  }
  for (const [event, field] of Object.entries(ASSESSMENT_FIELD)) {
    const present = context[field] !== undefined && context[field] !== null;
    if (event === context.event && !present)
      problems.push(`context.${field} is required for ${event}`);
    if (event !== context.event && present)
      problems.push(`context.${field} belongs to ${event} only`);
  }
  if (typeof context.contextHash !== "string") {
    problems.push("context.contextHash must be a string");
  } else if (context.contextHash !== computeContextHash(context)) {
    problems.push(
      `context.contextHash does not match its content (expected ${computeContextHash(context)}; ` +
        "run `pnpm eval:fixtures -- --rehash` after an intended edit)",
    );
  }
}

function validateExpect(fixture, problems) {
  const { expect, context } = fixture;
  for (const key of unknownKeys(expect, EXPECT_KEYS)) problems.push(`expect: unknown key "${key}"`);
  if (typeof expect.shouldProvoke !== "boolean")
    problems.push("expect.shouldProvoke must be boolean");
  if (typeof expect.gatePasses !== "boolean") problems.push("expect.gatePasses must be boolean");
  if (expect.shouldProvoke && !expect.gatePasses) {
    problems.push("expect.shouldProvoke needs expect.gatePasses: a closed gate sends no prompt");
  }
  const concern = EVENT_CONCERNS[fixture.event];
  if (
    !isStringArray(expect.allowedConcerns) ||
    !expect.allowedConcerns.includes(concern) ||
    expect.allowedConcerns.some((item) => !Object.values(EVENT_CONCERNS).includes(item))
  ) {
    problems.push(`expect.allowedConcerns must include "${concern}" and only known concerns`);
  }
  const contextIds = new Set((context?.evidenceRefs ?? []).map((evidence) => evidence?.id));
  const checkIds = (field, ids) => {
    for (const id of ids) {
      if (!contextIds.has(id))
        problems.push(`expect.${field}: "${id}" is not in context.evidenceRefs`);
    }
  };
  if (!isStringArray(expect.requiredEvidenceRefIds)) {
    problems.push("expect.requiredEvidenceRefIds must be a string array");
  } else {
    checkIds("requiredEvidenceRefIds", expect.requiredEvidenceRefIds);
  }
  if (expect.locale !== context?.locale) problems.push("expect.locale must equal context.locale");

  if (expect.shouldProvoke) {
    if (!expect.requiredEvidenceRefIds?.length) {
      problems.push("expect.requiredEvidenceRefIds must be non-empty when shouldProvoke");
    }
    if (!isStringArray(expect.relevantEvidenceRefIds) || !expect.relevantEvidenceRefIds.length) {
      problems.push("expect.relevantEvidenceRefIds is required when shouldProvoke");
    } else {
      checkIds("relevantEvidenceRefIds", expect.relevantEvidenceRefIds);
      for (const id of expect.requiredEvidenceRefIds ?? []) {
        if (!expect.relevantEvidenceRefIds.includes(id)) {
          problems.push(`expect.relevantEvidenceRefIds must include required id "${id}"`);
        }
      }
    }
    if (!isStringArray(expect.criterionTerms) || !expect.criterionTerms.length) {
      problems.push("expect.criterionTerms is required when shouldProvoke");
    } else if (context) {
      const text = contextText(context);
      for (const term of expect.criterionTerms) {
        if (!term.trim() || !text.includes(term.toLowerCase())) {
          problems.push(`expect.criterionTerms: "${term}" does not appear in the context`);
        }
      }
    }
  }
  if (expect.expectedDropReason !== undefined) {
    if (!DROP_REASONS.includes(expect.expectedDropReason)) {
      problems.push(`expect.expectedDropReason "${expect.expectedDropReason}" is unknown`);
    }
    if (!expect.shouldProvoke) {
      problems.push(
        "expect.expectedDropReason marks a bad recording on a context that should provoke",
      );
    }
  }
}

function validateRecorded(recorded, problems) {
  if (!isObject(recorded) || Object.keys(recorded).length === 0) {
    problems.push("recorded must map at least one promptVersion to recordings");
    return;
  }
  for (const [version, recordings] of Object.entries(recorded)) {
    if (!PROMPT_VERSION_RE.test(version)) {
      problems.push(`recorded: "${version}" is not a <semver>+<8-hex> promptVersion`);
    }
    if (!Array.isArray(recordings) || recordings.length === 0) {
      problems.push(`recorded["${version}"] must be a non-empty array`);
      continue;
    }
    recordings.forEach((recording, index) => {
      const where = `recorded["${version}"][${index}]`;
      if (!isObject(recording)) {
        problems.push(`${where} must be an object`);
        return;
      }
      for (const key of unknownKeys(recording, RECORDING_KEYS)) {
        problems.push(`${where}: unknown key "${key}"`);
      }
      if (typeof recording.rawOutput !== "string")
        problems.push(`${where}.rawOutput must be a string`);
      if (typeof recording.model !== "string" || !recording.model.trim()) {
        problems.push(`${where}.model must be a non-empty string`);
      }
      if (typeof recording.recordedAt !== "string" || !DATE_RE.test(recording.recordedAt)) {
        problems.push(`${where}.recordedAt must be an ISO date`);
      }
      if (!RECORDING_SOURCES.includes(recording.source)) {
        problems.push(`${where}.source must be one of ${RECORDING_SOURCES.join(", ")}`);
      }
    });
  }
}

/** Problems with one parsed fixture file (`split` = its directory). */
export function validateFixture(fixture, { file, split }) {
  const problems = [];
  if (!isObject(fixture)) return ["fixture must be a JSON object"];
  for (const key of unknownKeys(fixture, FIXTURE_KEYS)) problems.push(`unknown key "${key}"`);
  if (fixture.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (typeof fixture.id !== "string" || !ID_RE.test(fixture.id)) {
    problems.push("id must be kebab-case");
  } else if (file && basename(file) !== `${fixture.id}.json`) {
    problems.push(`file name must be ${fixture.id}.json`);
  }
  if (!SPLITS.includes(split)) problems.push(`fixture must live under ${SPLITS.join("/ or ")}/`);
  if (typeof fixture.description !== "string" || !fixture.description.trim()) {
    problems.push("description must be a non-empty string");
  }
  if (!isObject(fixture.context)) {
    problems.push("context must be a SupervisorContext object");
  } else {
    validateContext(fixture.context, problems);
    for (const key of ["event", "locale", "mode"]) {
      if (fixture[key] !== fixture.context[key]) problems.push(`${key} must equal context.${key}`);
    }
  }
  if (!isObject(fixture.expect)) problems.push("expect must be an object");
  else validateExpect(fixture, problems);
  validateRecorded(fixture.recorded, problems);
  return problems;
}

/** Reads every `<split>/<id>.json` under `root`. */
export function loadFixtures(root = DEFAULT_FIXTURE_ROOT) {
  const fixtures = [];
  const errors = [];
  if (!existsSync(root)) return { fixtures, errors: [`${root} does not exist`] };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (!entry.isDirectory()) {
      errors.push(`${entry.name}: only ${SPLITS.join("/")} directories belong at the root`);
      continue;
    }
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name);
      if (!name.endsWith(".json")) {
        errors.push(`${entry.name}/${name}: not a .json fixture`);
        continue;
      }
      try {
        fixtures.push({ file, split: entry.name, fixture: JSON.parse(readFileSync(file, "utf8")) });
      } catch (error) {
        errors.push(`${entry.name}/${name}: invalid JSON: ${error.message}`);
      }
    }
  }
  return { fixtures, errors };
}

/**
 * Set-level checks: unique ids, ≥30 fixtures, every event × locale × mode,
 * every event in both splits with at least one negative, the required
 * negative-control drop reasons, a roughly 2:1 split, and recordings for the
 * newest promptVersion on every fixture.
 */
export function checkCoverage(entries) {
  const problems = [];
  const ids = new Map();
  for (const { fixture, split } of entries) {
    if (ids.has(fixture.id))
      problems.push(`duplicate id "${fixture.id}" (${ids.get(fixture.id)}, ${split})`);
    else ids.set(fixture.id, split);
  }
  if (entries.length < MIN_FIXTURES) {
    problems.push(`${entries.length} fixtures; at least ${MIN_FIXTURES} are required`);
  }
  for (const event of EVENTS) {
    for (const locale of LOCALES) {
      for (const mode of MODES) {
        if (
          !entries.some(
            ({ fixture }) =>
              fixture.event === event && fixture.locale === locale && fixture.mode === mode,
          )
        ) {
          problems.push(`no fixture for ${event} × ${locale} × ${mode}`);
        }
      }
    }
    for (const split of SPLITS) {
      if (!entries.some(({ fixture, split: s }) => fixture.event === event && s === split)) {
        problems.push(`no ${split} fixture for ${event}`);
      }
    }
    if (
      !entries.some(
        ({ fixture }) => fixture.event === event && fixture.expect?.shouldProvoke === false,
      )
    ) {
      problems.push(`no negative (shouldProvoke: false) fixture for ${event}`);
    }
  }
  for (const reason of REQUIRED_CONTROL_DROP_REASONS) {
    if (!entries.some(({ fixture }) => fixture.expect?.expectedDropReason === reason)) {
      problems.push(`no negative-control fixture with expectedDropReason "${reason}"`);
    }
  }
  const holdout = entries.filter(({ split }) => split === "holdout").length;
  const share = entries.length ? holdout / entries.length : 0;
  if (share < 0.25 || share > 0.4) {
    problems.push(
      `holdout is ${Math.round(share * 100)}% of fixtures; keep it between 25% and 40% (≈2:1)`,
    );
  }
  const versions = new Set(
    entries.flatMap(({ fixture }) =>
      isObject(fixture.recorded)
        ? Object.keys(fixture.recorded).filter((v) => PROMPT_VERSION_RE.test(v))
        : [],
    ),
  );
  const latest = [...versions].sort(compareSemver).at(-1);
  if (latest) {
    for (const { fixture } of entries) {
      if (!fixture.recorded?.[latest]?.length) {
        problems.push(`${fixture.id}: no recording for the newest promptVersion ${latest}`);
      }
    }
  }
  return problems;
}

/** Counts per event / locale / mode / split, for the README and reports. */
export function coverageSummary(entries) {
  const count = (keyOf) => {
    const out = {};
    for (const entry of entries) out[keyOf(entry)] = (out[keyOf(entry)] ?? 0) + 1;
    return out;
  };
  return {
    total: entries.length,
    byEvent: count(({ fixture }) => fixture.event),
    byLocale: count(({ fixture }) => fixture.locale),
    byMode: count(({ fixture }) => fixture.mode),
    bySplit: count(({ split }) => split),
    negatives: entries.filter(({ fixture }) => fixture.expect?.shouldProvoke === false).length,
    negativeControls: entries.filter(({ fixture }) => fixture.expect?.expectedDropReason).length,
  };
}

/** Validates the whole tree; returns every problem as "<split>/<file>: <problem>". */
export function validateTree(root = DEFAULT_FIXTURE_ROOT) {
  const { fixtures, errors } = loadFixtures(root);
  const problems = [...errors];
  for (const { file, split, fixture } of fixtures) {
    for (const problem of validateFixture(fixture, { file, split })) {
      problems.push(`${split}/${basename(file)}: ${problem}`);
    }
  }
  problems.push(...checkCoverage(fixtures));
  return { fixtures, problems };
}

function rehash(root) {
  const { fixtures } = loadFixtures(root);
  let changed = 0;
  for (const { file, fixture } of fixtures) {
    if (!isObject(fixture.context)) continue;
    const hash = computeContextHash(fixture.context);
    if (fixture.context.contextHash === hash) continue;
    fixture.context.contextHash = hash;
    writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
    changed += 1;
  }
  return changed;
}

function parseArgs(argv) {
  const args = { root: DEFAULT_FIXTURE_ROOT, rehash: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    else if (arg === "--rehash") args.rehash = true;
    else if (arg === "--root") {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith("--"))
        throw new Error("--root needs a directory");
      args.root = resolve(value);
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`unknown argument "${arg}"`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`eval-fixtures: ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log("Usage: pnpm eval:fixtures [-- --root <fixtures dir>] [-- --rehash]");
    return 0;
  }
  if (args.rehash) {
    // Re-run prettier on the fixtures afterwards: this writes plain JSON.stringify.
    console.log(`eval-fixtures: rehashed ${rehash(args.root)} fixture(s)`);
  }
  const { fixtures, problems } = validateTree(args.root);
  if (problems.length > 0) {
    console.error(`eval-fixtures: ${problems.length} problem(s) in ${args.root}`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  const summary = coverageSummary(fixtures);
  console.log(
    `eval-fixtures: OK — ${summary.total} fixture(s) (dev ${summary.bySplit.dev ?? 0}, ` +
      `holdout ${summary.bySplit.holdout ?? 0}; ${summary.negatives} negative, ` +
      `${summary.negativeControls} negative-control recording(s))`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
