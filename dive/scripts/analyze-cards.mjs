#!/usr/bin/env node
// `pnpm research:cards` — review-card field aggregates from DIVE JSONL exports
// (spec 015, S-081, FR-050/FR-051). Field names follow
// specs/015-self-improvement-loops/contracts/event-log-export.md.
//
// Each export carries a fresh salt, so ids never correlate across exports:
// card events are joined to their exposure and to `supervisor_evaluated` rows
// inside one export only, and only non-identifying keys (event, concern, mode,
// promptVersion, policyVersion, model) are aggregated across exports. Ids are
// printed only under --exemplars. `promptVersion` has three states that are
// never pooled: a real version, explicit `null` (no prompt reached a model:
// provoke gate false, runtime unavailable, deterministic fallback card), and
// legacy (field missing or empty, rows written before S-076).
//
// Also summarized per prompt version: `verification_coach.evaluated` status /
// reason codes and `prd_interview.turn_evaluated` outcomes.
//
// Usage: node scripts/analyze-cards.mjs <export.jsonl...> [--json] [--exemplars]
//          [--include-origin qa,dev]

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CLAIM_NOTE =
  "Rates are card-quality proxies (how students responded to the cards DIVE showed), " +
  "not evidence of student supervision skill, metacognition, or reduced AI overreliance.";

export const EXEMPLAR_BANNER =
  "Exemplars are candidates only. Promotion into eval fixtures is manual: a human reviews " +
  "each one, resolves it to the local replay record on the machine that holds the corpus, " +
  "and completes an anonymization review before anything is committed (FR-051).";

export const KNOWN_ORIGINS = ["classroom", "qa", "dev"];

const SUPERVISOR_EVALUATED = "provocation.supervisor_evaluated";
const CARD_SHOWN = "provocation.card_shown";
const COACH_EVALUATED = "verification_coach.evaluated";
const PRD_TURN_EVALUATED = "prd_interview.turn_evaluated";

// `superseded` predates the removed/replaced split; it is still counted as-is.
const LEGACY_UNANSWERED_REASON = "superseded";

// Terminal event type → report counter name.
const TERMINALS = {
  "provocation.action_clicked": "action",
  "provocation.dismissed": "dismiss",
  "provocation.marked_irrelevant": "markIrrelevant",
  "provocation.continued_with_risk": "continuedWithRisk",
  "provocation.card_unanswered": "unanswered",
};

const OUTCOMES = ["shown", "none", "dropped", "error"];
const KEY_FIELDS = [
  "event",
  "concern",
  "mode",
  "promptVersion",
  "promptVersionStatus",
  "policyVersion",
  "model",
  "cardType",
];

export function parseArgs(argv) {
  const args = { files: [], json: false, exemplars: false, includeOrigins: ["classroom"] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      // `pnpm research:cards -- --json` forwards the separator itself.
      continue;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--exemplars") {
      args.exemplars = true;
    } else if (arg === "--include-origin" || arg.startsWith("--include-origin=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[(i += 1)];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--include-origin needs a comma-separated list, e.g. qa,dev");
      }
      for (const origin of value.split(",").map((part) => part.trim())) {
        if (!KNOWN_ORIGINS.includes(origin)) {
          throw new Error(`unknown origin "${origin}" (expected ${KNOWN_ORIGINS.join(", ")})`);
        }
        if (!args.includeOrigins.includes(origin)) args.includeOrigins.push(origin);
      }
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument "${arg}"`);
    } else {
      args.files.push(arg);
    }
  }
  return args;
}

export function readJsonl(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim())
    .map(({ line, index }) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${error.message}`);
      }
    });
}

/**
 * One export = one `session_meta` and the records after it. A file normally
 * holds one export; concatenated files are split at each `session_meta` so a
 * join never crosses a salt boundary. Records before any `session_meta` form a
 * unit with no origin (legacy).
 */
export function splitExports(records, file) {
  const units = [];
  let current = null;
  for (const record of records) {
    if (record?.kind === "session_meta" || current === null) {
      current = {
        file,
        index: units.length,
        origin: record?.kind === "session_meta" ? (record.origin ?? null) : null,
        records: [],
      };
      units.push(current);
    }
    if (record?.kind !== "session_meta") current.records.push(record);
  }
  return units;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * `versioned` — a prompt was sent under this version; `no_llm` — explicit
 * `null`, no prompt reached a model; `legacy` — missing or empty (pre-S-076).
 */
export function promptVersionOf(payload) {
  if (payload.promptVersion === null) {
    return { promptVersion: null, promptVersionStatus: "no_llm" };
  }
  const version = stringOrNull(payload.promptVersion);
  return version
    ? { promptVersion: version, promptVersionStatus: "versioned" }
    : { promptVersion: null, promptVersionStatus: "legacy" };
}

function evaluationKey(payload) {
  return {
    event: stringOrNull(payload.event),
    concern: stringOrNull(payload.decisionSummary?.concern),
    mode: stringOrNull(payload.mode),
    ...promptVersionOf(payload),
    policyVersion: stringOrNull(payload.policyVersion),
    model: stringOrNull(payload.supervisorModel),
    cardType: null,
  };
}

/** Joins one export's card events into exposures and indexes its evaluations. */
export function analyzeExport(unit) {
  const evaluations = new Map();
  const exposures = new Map();
  const coachEvaluations = [];
  const prdTurns = [];
  const integrity = {
    duplicateCardShown: 0,
    responsesWithoutExposure: 0,
    legacyCardEventsWithoutExposureId: 0,
    sessionResolvedByExposure: 0,
    sessionResolvedByProjectLatest: 0,
    nullPayloads: 0,
  };

  for (const record of unit.records) {
    if (record?.kind !== "event" || typeof record.type !== "string") continue;
    const isCardEvent = record.type === CARD_SHOWN || record.type in TERMINALS;
    const isOtherTracked = [SUPERVISOR_EVALUATED, COACH_EVALUATED, PRD_TURN_EVALUATED].includes(
      record.type,
    );
    if (!isCardEvent && !isOtherTracked) continue;
    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      integrity.nullPayloads += 1;
      continue;
    }

    if (record.type === COACH_EVALUATED) {
      coachEvaluations.push(payload);
      continue;
    }
    if (record.type === PRD_TURN_EVALUATED) {
      prdTurns.push(payload);
      continue;
    }
    if (record.type === SUPERVISOR_EVALUATED) {
      const id = stringOrNull(payload.supervisorEvaluationId);
      // Every attempt (retries included) has its own id; the first row wins
      // if a malformed export repeats one.
      if (id && !evaluations.has(id)) evaluations.set(id, payload);
      else if (!id) evaluations.set(Symbol("unidentified"), payload);
      continue;
    }

    // Rows the client sent without a session id, attributed by the backend
    // (FR-005). `project_latest` is a guess; `exposure` follows card_shown.
    if (payload.sessionResolvedBy === "exposure") integrity.sessionResolvedByExposure += 1;
    if (payload.sessionResolvedBy === "project_latest") {
      integrity.sessionResolvedByProjectLatest += 1;
    }

    const exposureId = stringOrNull(payload.exposureId);
    if (!exposureId) {
      // Pre-S-076 card events: no exposure to join, so no rate is computed.
      integrity.legacyCardEventsWithoutExposureId += 1;
      continue;
    }
    if (record.type === CARD_SHOWN) {
      if (exposures.has(exposureId)) {
        integrity.duplicateCardShown += 1;
        continue;
      }
      exposures.set(exposureId, {
        exposureId,
        evaluationId: stringOrNull(payload.supervisorEvaluationId),
        correlationEvent: stringOrNull(payload.supervisorCorrelation?.event),
        cardType: stringOrNull(payload.cardType),
        mode: stringOrNull(payload.mode),
        question: stringOrNull(payload.question),
        terminal: null,
      });
      continue;
    }
    const exposure = exposures.get(exposureId);
    if (!exposure) {
      integrity.responsesWithoutExposure += 1;
    } else if (!exposure.terminal) {
      // The first response (or card_unanswered) is terminal; later responses
      // on the same exposure are logged but do not change the outcome.
      exposure.terminal = {
        outcome: TERMINALS[record.type],
        responseLatencyMs: numberOrNull(payload.responseLatencyMs),
        visibleMs: numberOrNull(payload.visibleMs),
        unansweredReason: stringOrNull(payload.unansweredReason),
      };
    }
  }

  return {
    evaluations,
    exposures: [...exposures.values()],
    coachEvaluations,
    prdTurns,
    integrity,
  };
}

function exposureKey(exposure, evaluations, integrity) {
  if (exposure.evaluationId) {
    const evaluation = evaluations.get(exposure.evaluationId);
    if (evaluation) return evaluationKey(evaluation);
    integrity.evaluationNotInExport += 1;
    return {
      event: exposure.correlationEvent,
      concern: null,
      mode: exposure.mode,
      promptVersion: null,
      promptVersionStatus: null,
      policyVersion: null,
      model: null,
      cardType: null,
    };
  }
  // Deterministic (non-supervisor) cards have no evaluation; keep them apart
  // by card type rather than pooling them into one null-keyed group.
  return {
    event: null,
    concern: null,
    mode: exposure.mode,
    promptVersion: null,
    promptVersionStatus: null,
    policyVersion: null,
    model: null,
    cardType: exposure.cardType,
  };
}

function newGroup(key) {
  return {
    key,
    exposures: 0,
    counts: {
      action: 0,
      dismiss: 0,
      markIrrelevant: 0,
      continuedWithRisk: 0,
      unanswered: 0,
      missingTerminal: 0,
    },
    latencies: [],
    visible: [],
    unansweredReasons: {},
    supervisor: {
      evaluations: 0,
      outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
      dropReasons: {},
      shownWithoutExposure: 0,
    },
  };
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rate(count, denominator) {
  return denominator ? Math.round((count / denominator) * 10000) / 10000 : null;
}

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function versionRowFor(rows, payload, init) {
  const key = { ...promptVersionOf(payload), model: stringOrNull(payload.model) };
  const id = JSON.stringify(key);
  if (!rows.has(id)) rows.set(id, { key, ...init() });
  return rows.get(id);
}

function sortedRows(rows) {
  return [...rows.values()].sort(
    (a, b) => b.count - a.count || JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)),
  );
}

/**
 * @param units  output of splitExports() over every input file
 * @param options { includeOrigins: string[], exemplars: boolean }
 */
export function analyze(units, { includeOrigins = ["classroom"], exemplars = false } = {}) {
  const groups = new Map();
  const groupFor = (key) => {
    const id = JSON.stringify(KEY_FIELDS.map((field) => key[field]));
    if (!groups.has(id)) groups.set(id, newGroup(key));
    return groups.get(id);
  };
  const inputs = {
    files: new Set(units.map((unit) => unit.file)).size,
    exports: units.length,
    includedExports: 0,
    includeOrigins,
    excludedExportsByOrigin: {},
    legacy: { exports: 0, exposures: 0, evaluations: 0 },
  };
  const integrity = {
    exposuresMissingTerminal: 0,
    responsesWithoutExposure: 0,
    duplicateCardShown: 0,
    legacyCardEventsWithoutExposureId: 0,
    legacyUnansweredSuperseded: 0,
    evaluationNotInExport: 0,
    sessionResolvedByExposure: 0,
    sessionResolvedByProjectLatest: 0,
    policyVersionMismatch: 0,
    nullPayloads: 0,
  };
  const policyVersionMismatches = {};
  const totals = { exposures: 0, evaluations: 0, coachEvaluations: 0, prdTurns: 0 };
  const coachRows = new Map();
  const prdRows = new Map();
  const exemplarItems = [];

  for (const unit of units) {
    const legacy = unit.origin === null;
    if (!legacy && !includeOrigins.includes(unit.origin)) {
      increment(inputs.excludedExportsByOrigin, unit.origin);
      continue;
    }
    inputs.includedExports += 1;
    if (legacy) inputs.legacy.exports += 1;

    const {
      evaluations,
      exposures,
      coachEvaluations,
      prdTurns,
      integrity: unitIntegrity,
    } = analyzeExport(unit);
    for (const [field, count] of Object.entries(unitIntegrity)) integrity[field] += count;

    const exposedEvaluationIds = new Set(exposures.map((exposure) => exposure.evaluationId));
    for (const [id, evaluation] of evaluations) {
      const group = groupFor(evaluationKey(evaluation));
      const outcome = stringOrNull(evaluation.validationOutcome) ?? "unknown";
      group.supervisor.evaluations += 1;
      increment(group.supervisor.outcomes, outcome);
      const dropReason = stringOrNull(evaluation.dropReason);
      if (dropReason) increment(group.supervisor.dropReasons, dropReason);
      if (outcome === "shown" && !exposedEvaluationIds.has(id)) {
        group.supervisor.shownWithoutExposure += 1;
      }
      // Present only when a stale frontend bundle sent a different policy
      // version than the Rust binary embeds; `policyVersion` is then the FE's.
      const rustPolicy = stringOrNull(evaluation.policyVersionRust);
      if (rustPolicy && rustPolicy !== evaluation.policyVersion) {
        integrity.policyVersionMismatch += 1;
        increment(
          policyVersionMismatches,
          `frontend ${evaluation.policyVersion ?? "?"} / rust ${rustPolicy}`,
        );
      }
      totals.evaluations += 1;
      if (legacy) inputs.legacy.evaluations += 1;
    }

    for (const exposure of exposures) {
      const key = exposureKey(exposure, evaluations, integrity);
      const group = groupFor(key);
      group.exposures += 1;
      totals.exposures += 1;
      if (legacy) inputs.legacy.exposures += 1;
      const terminal = exposure.terminal;
      if (!terminal) {
        group.counts.missingTerminal += 1;
        integrity.exposuresMissingTerminal += 1;
        continue;
      }
      group.counts[terminal.outcome] += 1;
      if (terminal.outcome === "unanswered") {
        if (terminal.visibleMs !== null) group.visible.push(terminal.visibleMs);
        increment(group.unansweredReasons, terminal.unansweredReason ?? "unknown");
        if (terminal.unansweredReason === LEGACY_UNANSWERED_REASON) {
          integrity.legacyUnansweredSuperseded += 1;
        }
      } else if (terminal.responseLatencyMs !== null) {
        group.latencies.push(terminal.responseLatencyMs);
      }
      if (
        exemplars &&
        (terminal.outcome === "markIrrelevant" || terminal.outcome === "unanswered")
      ) {
        exemplarItems.push({
          file: unit.file,
          exportIndex: unit.index,
          evaluationId: exposure.evaluationId,
          exposureId: exposure.exposureId,
          outcome: terminal.outcome,
          unansweredReason: terminal.unansweredReason,
          question: exposure.question,
          key,
        });
      }
    }

    for (const payload of coachEvaluations) {
      const row = versionRowFor(coachRows, payload, () => ({
        count: 0,
        status: {},
        reasonCode: {},
      }));
      row.count += 1;
      increment(row.status, stringOrNull(payload.status) ?? "unknown");
      increment(row.reasonCode, stringOrNull(payload.reasonCode) ?? "unknown");
      totals.coachEvaluations += 1;
    }
    for (const payload of prdTurns) {
      const row = versionRowFor(prdRows, payload, () => ({
        count: 0,
        validationOutcome: {},
        errorClass: {},
        contractRetries: 0,
        patchesProposed: 0,
      }));
      row.count += 1;
      increment(row.validationOutcome, stringOrNull(payload.validationOutcome) ?? "unknown");
      const errorClass = stringOrNull(payload.errorClass);
      if (errorClass) increment(row.errorClass, errorClass);
      if (payload.contractRetryAttempted === true) row.contractRetries += 1;
      if (payload.patchProposed === true) row.patchesProposed += 1;
      totals.prdTurns += 1;
    }
  }

  const report = {
    schemaVersion: 1,
    note: CLAIM_NOTE,
    inputs,
    totals,
    integrity,
    policyVersionMismatches,
    groups: [...groups.values()]
      .map((group) => ({
        key: group.key,
        exposures: group.exposures,
        counts: group.counts,
        rates: {
          action: rate(group.counts.action, group.exposures),
          dismiss: rate(group.counts.dismiss, group.exposures),
          markIrrelevant: rate(group.counts.markIrrelevant, group.exposures),
          continuedWithRisk: rate(group.counts.continuedWithRisk, group.exposures),
          unanswered: rate(group.counts.unanswered, group.exposures),
        },
        medianResponseLatencyMs: median(group.latencies),
        medianUnansweredVisibleMs: median(group.visible),
        unansweredReasons: group.unansweredReasons,
        supervisor: group.supervisor,
      }))
      .sort(
        (a, b) =>
          b.exposures - a.exposures ||
          b.supervisor.evaluations - a.supervisor.evaluations ||
          JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)),
      ),
  };
  report.verificationCoach = sortedRows(coachRows);
  report.prdInterviewTurns = sortedRows(prdRows);
  if (exemplars) report.exemplars = { banner: EXEMPLAR_BANNER, items: exemplarItems };
  return report;
}

function cell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function eventLabel(key) {
  if (key.event) return key.event;
  return key.cardType ? `(card) ${key.cardType}` : null;
}

function promptVersionLabel(key) {
  if (key.promptVersionStatus === "no_llm") return "(no LLM)";
  if (key.promptVersionStatus === "legacy") return "(legacy)";
  return key.promptVersion;
}

function countWithRate(count, ratio) {
  return ratio === null ? String(count) : `${count} (${Math.round(ratio * 100)}%)`;
}

function distribution(map) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([name, count]) => `${name}: ${count}`).join(", ") : null;
}

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

export function renderMarkdown(report) {
  const { inputs, integrity, totals } = report;
  const keyCells = (key) => [
    eventLabel(key),
    key.concern,
    key.mode,
    promptVersionLabel(key),
    key.policyVersion,
    key.model,
  ];
  const excluded = distribution(inputs.excludedExportsByOrigin) ?? "none";
  const lines = [
    "# Review-card field aggregates",
    "",
    `> ${report.note}`,
    "",
    `- Inputs: ${inputs.files} file(s), ${inputs.exports} export(s); included ${inputs.includedExports} ` +
      `(origins: ${inputs.includeOrigins.join(", ")}); excluded by origin: ${excluded}.`,
    `- Legacy exports without \`origin\` (included): ${inputs.legacy.exports} ` +
      `(${inputs.legacy.exposures} exposure(s), ${inputs.legacy.evaluations} evaluation(s)).`,
    `- Totals: ${totals.exposures} exposure(s), ${totals.evaluations} supervisor evaluation(s), ` +
      `${totals.coachEvaluations} coach evaluation(s), ${totals.prdTurns} PRD interview turn(s).`,
    "- promptVersion `(no LLM)`: no prompt reached a model (provoke gate false, runtime " +
      "unavailable, deterministic fallback); `(legacy)`: row predates prompt versioning.",
    "",
    "## Data integrity",
    "",
    `- Exposures missing a terminal event: ${integrity.exposuresMissingTerminal}` +
      (integrity.exposuresMissingTerminal ? " — WARNING: expected 0 (FR-004)" : " (expected 0)"),
    `- Responses without a \`card_shown\` in the same export: ${integrity.responsesWithoutExposure}`,
    `- Duplicate \`card_shown\` for one exposure: ${integrity.duplicateCardShown}`,
    `- Supervisor cards whose evaluation row is not in the same export: ${integrity.evaluationNotInExport}`,
    `- Legacy card events without \`exposureId\` (not rated): ${integrity.legacyCardEventsWithoutExposureId}`,
    `- Card events attributed to a session by fallback: ${integrity.sessionResolvedByExposure} via ` +
      `exposure, ${integrity.sessionResolvedByProjectLatest} via project latest session` +
      (integrity.sessionResolvedByProjectLatest
        ? " — WARNING: project_latest is a best guess"
        : ""),
    `- Frontend/Rust policy version mismatch: ${integrity.policyVersionMismatch}` +
      (integrity.policyVersionMismatch
        ? ` — WARNING: stale frontend bundle (${distribution(report.policyVersionMismatches)})`
        : ""),
    `- Unanswered with legacy reason \`superseded\` (pre removed/replaced split): ${integrity.legacyUnansweredSuperseded}`,
    `- Card/evaluation events with an unparseable payload: ${integrity.nullPayloads}`,
    "",
    "## Card exposures",
    "",
    "Rates use exposures as the denominator.",
    "",
  ];
  const exposed = report.groups.filter((group) => group.exposures > 0);
  if (exposed.length === 0) {
    lines.push("No card exposures in the included exports.");
  } else {
    lines.push(
      ...table(
        [
          "event",
          "concern",
          "mode",
          "promptVersion",
          "policyVersion",
          "model",
          "exposures",
          "action",
          "dismiss",
          "irrelevant",
          "continued w/ risk",
          "unanswered",
          "no terminal",
          "median latency ms",
          "median unanswered visible ms",
          "unanswered reasons",
        ],
        exposed.map((group) => [
          ...keyCells(group.key),
          group.exposures,
          countWithRate(group.counts.action, group.rates.action),
          countWithRate(group.counts.dismiss, group.rates.dismiss),
          countWithRate(group.counts.markIrrelevant, group.rates.markIrrelevant),
          countWithRate(group.counts.continuedWithRisk, group.rates.continuedWithRisk),
          countWithRate(group.counts.unanswered, group.rates.unanswered),
          group.counts.missingTerminal,
          group.medianResponseLatencyMs,
          group.medianUnansweredVisibleMs,
          distribution(group.unansweredReasons),
        ]),
      ),
    );
  }
  lines.push("", "## Supervisor outcomes", "");
  const evaluated = report.groups.filter((group) => group.supervisor.evaluations > 0);
  if (evaluated.length === 0) {
    lines.push("No supervisor evaluations in the included exports.");
  } else {
    lines.push(
      ...table(
        [
          "event",
          "concern",
          "mode",
          "promptVersion",
          "policyVersion",
          "model",
          "evaluations",
          "shown",
          "none",
          "dropped",
          "error",
          "drop reasons",
          "shown, no exposure",
        ],
        evaluated.map((group) => {
          const { outcomes } = group.supervisor;
          return [
            ...keyCells(group.key),
            group.supervisor.evaluations,
            outcomes.shown,
            outcomes.none,
            outcomes.dropped,
            outcomes.error,
            distribution(group.supervisor.dropReasons),
            group.supervisor.shownWithoutExposure,
          ];
        }),
      ),
    );
  }
  lines.push("", "## Verification coach", "");
  if (report.verificationCoach.length === 0) {
    lines.push("No verification coach evaluations in the included exports.");
  } else {
    lines.push(
      ...table(
        ["promptVersion", "model", "evaluations", "status", "reason codes"],
        report.verificationCoach.map((row) => [
          promptVersionLabel(row.key),
          row.key.model,
          row.count,
          distribution(row.status),
          distribution(row.reasonCode),
        ]),
      ),
    );
  }
  lines.push("", "## PRD interview turns", "");
  if (report.prdInterviewTurns.length === 0) {
    lines.push("No PRD interview turns in the included exports.");
  } else {
    lines.push(
      ...table(
        [
          "promptVersion",
          "model",
          "turns",
          "outcomes",
          "error classes",
          "contract retries",
          "patches proposed",
        ],
        report.prdInterviewTurns.map((row) => [
          promptVersionLabel(row.key),
          row.key.model,
          row.count,
          distribution(row.validationOutcome),
          distribution(row.errorClass),
          row.contractRetries,
          row.patchesProposed,
        ]),
      ),
    );
  }
  if (report.exemplars) {
    lines.push("", "## Exemplar candidates", "", `> ${report.exemplars.banner}`, "");
    if (report.exemplars.items.length === 0) {
      lines.push("No marked-irrelevant or unanswered exposures in the included exports.");
    } else {
      lines.push(
        ...table(
          ["file", "export", "evaluationId", "exposureId", "event", "outcome", "question"],
          report.exemplars.items.map((item) => [
            item.file,
            item.exportIndex,
            item.evaluationId,
            item.exposureId,
            eventLabel(item.key),
            item.unansweredReason ? `${item.outcome} (${item.unansweredReason})` : item.outcome,
            item.question,
          ]),
        ),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const USAGE =
  "Usage: pnpm research:cards <export.jsonl...> [-- --json] [-- --exemplars] " +
  "[-- --include-origin qa,dev]";

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`analyze-cards: ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.files.length === 0) {
    console.error(USAGE);
    return 2;
  }

  let units;
  try {
    units = args.files.flatMap((file) => splitExports(readJsonl(file), file));
  } catch (error) {
    console.error(`analyze-cards: ${error.message}`);
    return 1;
  }
  const report = analyze(units, args);
  if (args.json) {
    if (report.exemplars) console.error(`analyze-cards: ${EXEMPLAR_BANNER}`);
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderMarkdown(report));
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
