import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAIM_NOTE,
  EXEMPLAR_BANNER,
  analyze,
  median,
  parseArgs,
  readJsonl,
  renderMarkdown,
  splitExports,
} from "./analyze-cards.mjs";

const CLI = fileURLToPath(new URL("./analyze-cards.mjs", import.meta.url));

// Synthetic exports shaped like `ExportEngine::export_session` output
// (src-tauri/src/export/mod.rs): record-level ids are salted hashes, event
// payload fields follow contracts/event-log-export.md (S-076).

let nextRecordId = 0;
function hashId(kind) {
  nextRecordId += 1;
  return `id:${kind}:${nextRecordId.toString(16).padStart(16, "0")}`;
}

function sessionMeta(origin) {
  const record = {
    kind: "session_meta",
    session_id: hashId("session"),
    title: "h:0123456789abcdef",
    status: "active",
    started_at: 1759112345000,
    ended_at: null,
  };
  if (origin !== undefined) record.origin = origin;
  return record;
}

function eventRecord(type, payload) {
  return { kind: "event", id: hashId("event"), type, payload, created_at: 1759112345000 };
}

function evaluation(id, overrides = {}) {
  const {
    event = "verify_entered",
    concern = "ai_self_report_only",
    mode = "work",
    outcome = "shown",
    dropReason,
    promptVersion = "1.0.0+256c9520",
    policyVersion = "1.0.0",
    model = "anthropic/claude-sonnet-5",
    question = "변경 내용이나 실행 결과로 목표와 맞는지 볼 수 있나요?",
  } = overrides;
  const payload = {
    schemaVersion: 1,
    event,
    artifactRef: { kind: "step", id: "step-1" },
    contextHash: "sha256:context",
    evidenceHash: "sha256:evidence",
    mode,
    evidenceRefs: [],
    supervisorModel: model,
    latencyMs: 1200,
    validationOutcome: outcome,
    promptVersion,
    policyVersion,
    supervisorEvaluationId: id,
  };
  if (concern !== null) {
    payload.decisionSummary = {
      provoke: outcome === "shown",
      concern,
      severity: "caution",
      evidenceRefIds: [],
      suggestedActionIds: [],
      strippedActionIds: [],
    };
    if (outcome === "shown") payload.decisionSummary.question = question;
  }
  if (dropReason) payload.dropReason = dropReason;
  // Rows written before S-076 have no promptVersion/policyVersion at all.
  if (overrides.legacyVersions) {
    delete payload.promptVersion;
    delete payload.policyVersion;
  }
  if (overrides.policyVersionRust) payload.policyVersionRust = overrides.policyVersionRust;
  if (outcome === "shown") payload.cardId = `card-${id}`;
  return eventRecord("provocation.supervisor_evaluated", payload);
}

function cardEvent(lifecycle, exposureId, overrides = {}) {
  const {
    evaluationId = null,
    event = "verify_entered",
    cardType = "verification_gap",
  } = overrides;
  const payload = {
    schemaVersion: 1,
    eventId: `prov-${lifecycle}`,
    lifecycleEvent: lifecycle,
    exposureId,
    projectId: 1,
    sessionId: 1,
    cardId: evaluationId ? `card-${evaluationId}` : `${cardType}:decompose:draft-1`,
    supervisorEvaluationId: evaluationId,
    supervisorCorrelation: {
      supervisorEvaluationId: evaluationId,
      event: evaluationId ? event : null,
      projectId: 1,
    },
    cardType,
    stage: "verify",
    severity: "caution",
    mode: overrides.mode ?? "work",
    ...overrides.extra,
  };
  return eventRecord(`provocation.${lifecycle}`, payload);
}

function shown(exposureId, overrides = {}) {
  const record = cardEvent("card_shown", exposureId, overrides);
  record.payload.question = overrides.question ?? "무엇으로 확인했나요?";
  return record;
}

function responded(lifecycle, exposureId, responseLatencyMs, overrides = {}) {
  const record = cardEvent(lifecycle, exposureId, overrides);
  record.payload.responseLatencyMs = responseLatencyMs;
  return record;
}

function unanswered(exposureId, visibleMs, reason = "replaced", overrides = {}) {
  const record = cardEvent("card_unanswered", exposureId, overrides);
  record.payload.visibleMs = visibleMs;
  record.payload.unansweredReason = reason;
  return record;
}

function run(fileRecords, options) {
  const units = Object.entries(fileRecords).flatMap(([file, records]) =>
    splitExports(records, file),
  );
  return analyze(units, options);
}

function groupOf(report, match) {
  return report.groups.find((group) =>
    Object.entries(match).every(([field, value]) => group.key[field] === value),
  );
}

// A classroom export: e1/e2 shown with exposures, e3 shown under a second
// concern, e4 provoke_false (no card), one retry pair (e5 dropped → e6 shown).
function classroomExport() {
  return [
    sessionMeta("classroom"),
    evaluation("e1"),
    shown("x1", { evaluationId: "e1" }),
    responded("action_clicked", "x1", 800, { evaluationId: "e1" }),
    // Later response on the same exposure: logged, not terminal.
    responded("dismissed", "x1", 5000, { evaluationId: "e1" }),
    evaluation("e2"),
    shown("x2", { evaluationId: "e2", question: "테스트를 직접 실행해 봤나요?" }),
    responded("marked_irrelevant", "x2", 1200, { evaluationId: "e2" }),
    evaluation("e3", { concern: "scope_drift", event: "diff_ready" }),
    shown("x3", { evaluationId: "e3", event: "diff_ready" }),
    unanswered("x3", 4200, "replaced", { evaluationId: "e3", event: "diff_ready" }),
    evaluation("e4", { outcome: "none", concern: "none" }),
    evaluation("e5", { outcome: "dropped", dropReason: "parse_error", concern: null }),
    evaluation("e6"),
    shown("x6", { evaluationId: "e6" }),
    responded("continued_with_risk", "x6", 3000, { evaluationId: "e6" }),
  ];
}

describe("analyze-cards grouping and rates", () => {
  it("groups exposures by (event, concern, mode, promptVersion, policyVersion, model)", () => {
    const report = run({ "a.jsonl": classroomExport() });
    const verify = groupOf(report, { event: "verify_entered", concern: "ai_self_report_only" });
    expect(verify.key).toEqual({
      event: "verify_entered",
      concern: "ai_self_report_only",
      mode: "work",
      promptVersion: "1.0.0+256c9520",
      promptVersionStatus: "versioned",
      policyVersion: "1.0.0",
      model: "anthropic/claude-sonnet-5",
      cardType: null,
    });
    expect(verify.exposures).toBe(3);
    expect(verify.counts).toEqual({
      action: 1,
      dismiss: 0,
      markIrrelevant: 1,
      continuedWithRisk: 1,
      unanswered: 0,
      missingTerminal: 0,
    });
    expect(verify.rates).toEqual({
      action: 0.3333,
      dismiss: 0,
      markIrrelevant: 0.3333,
      continuedWithRisk: 0.3333,
      unanswered: 0,
    });
    // Terminal latencies only (800, 1200, 3000); the later dismiss (5000) is ignored.
    expect(verify.medianResponseLatencyMs).toBe(1200);
    expect(verify.medianUnansweredVisibleMs).toBeNull();

    const diff = groupOf(report, { event: "diff_ready" });
    expect(diff.exposures).toBe(1);
    expect(diff.counts.unanswered).toBe(1);
    expect(diff.rates.unanswered).toBe(1);
    expect(diff.medianUnansweredVisibleMs).toBe(4200);
    expect(diff.unansweredReasons).toEqual({ replaced: 1 });
    expect(diff.medianResponseLatencyMs).toBeNull();
  });

  it("reports supervisor outcomes and drop reasons per group, including evaluations with no card", () => {
    const report = run({ "a.jsonl": classroomExport() });
    const verify = groupOf(report, { event: "verify_entered", concern: "ai_self_report_only" });
    expect(verify.supervisor.evaluations).toBe(3);
    expect(verify.supervisor.outcomes).toEqual({ shown: 3, none: 0, dropped: 0, error: 0 });

    const noCard = groupOf(report, { concern: "none" });
    expect(noCard.exposures).toBe(0);
    expect(noCard.supervisor.outcomes.none).toBe(1);
    expect(noCard.rates.action).toBeNull();

    const dropped = groupOf(report, { concern: null, event: "verify_entered" });
    expect(dropped.supervisor.outcomes.dropped).toBe(1);
    expect(dropped.supervisor.dropReasons).toEqual({ parse_error: 1 });
    expect(report.totals).toEqual({
      exposures: 4,
      evaluations: 6,
      coachEvaluations: 0,
      prdTurns: 0,
    });
  });

  it("separates prompt versions and models into their own groups", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        evaluation("e1"),
        shown("x1", { evaluationId: "e1" }),
        responded("action_clicked", "x1", 100, { evaluationId: "e1" }),
        evaluation("e2", { promptVersion: "1.1.0+deadbeef" }),
        shown("x2", { evaluationId: "e2" }),
        responded("dismissed", "x2", 100, { evaluationId: "e2" }),
        evaluation("e3", { model: "openai/gpt-5.4-mini" }),
        shown("x3", { evaluationId: "e3" }),
        responded("dismissed", "x3", 100, { evaluationId: "e3" }),
      ],
    });
    expect(report.groups).toHaveLength(3);
    expect(groupOf(report, { promptVersion: "1.1.0+deadbeef" }).counts.dismiss).toBe(1);
    expect(groupOf(report, { model: "openai/gpt-5.4-mini" }).counts.dismiss).toBe(1);
  });

  it("keeps deterministic (non-supervisor) cards apart by card type", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        shown("x1", { cardType: "prd_intent_check" }),
        responded("dismissed", "x1", 700, { cardType: "prd_intent_check" }),
      ],
    });
    const group = groupOf(report, { cardType: "prd_intent_check" });
    expect(group.key.event).toBeNull();
    expect(group.counts.dismiss).toBe(1);
    expect(report.integrity.evaluationNotInExport).toBe(0);
  });

  it("computes medians over odd and even counts", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("analyze-cards origin filter and legacy records", () => {
  const qaExport = () => [
    sessionMeta("qa"),
    evaluation("q1"),
    shown("y1", { evaluationId: "q1" }),
    responded("dismissed", "y1", 400, { evaluationId: "q1" }),
  ];
  const legacyExport = () => [
    sessionMeta(undefined),
    evaluation("l1", { promptVersion: "", policyVersion: "" }),
    shown("z1", { evaluationId: "l1" }),
    responded("action_clicked", "z1", 600, { evaluationId: "l1" }),
    // Pre-S-076 card events carry no exposureId.
    cardEvent("card_shown", null, { evaluationId: "l1" }),
  ];

  it("includes classroom only by default and counts excluded exports per origin", () => {
    const report = run({ "c.jsonl": classroomExport(), "q.jsonl": qaExport() });
    expect(report.inputs.includedExports).toBe(1);
    expect(report.inputs.excludedExportsByOrigin).toEqual({ qa: 1 });
    expect(report.totals.exposures).toBe(4);
  });

  it("adds qa/dev exports with --include-origin", () => {
    const options = parseArgs(["c.jsonl", "--include-origin", "qa,dev"]);
    expect(options.includeOrigins).toEqual(["classroom", "qa", "dev"]);
    const report = run({ "c.jsonl": classroomExport(), "q.jsonl": qaExport() }, options);
    expect(report.inputs.includedExports).toBe(2);
    expect(report.totals.exposures).toBe(5);
  });

  it("rejects unknown origins", () => {
    expect(() => parseArgs(["--include-origin=qa,staging"])).toThrow(/unknown origin "staging"/);
    expect(() => parseArgs(["--include-origin"])).toThrow(/needs a comma-separated list/);
  });

  it("includes exports without origin as legacy and flags them", () => {
    const report = run({ "c.jsonl": classroomExport(), "l.jsonl": legacyExport() });
    expect(report.inputs.legacy).toEqual({ exports: 1, exposures: 1, evaluations: 1 });
    expect(report.integrity.legacyCardEventsWithoutExposureId).toBe(1);
    // An empty promptVersion (serde default on old rows) groups as legacy.
    const legacy = groupOf(report, { promptVersionStatus: "legacy", event: "verify_entered" });
    expect(legacy.counts.action).toBe(1);
  });
});

describe("analyze-cards data integrity", () => {
  it("warns about exposures without a terminal event and orphan responses", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        evaluation("e1"),
        shown("x1", { evaluationId: "e1" }),
        shown("x1", { evaluationId: "e1" }),
        responded("action_clicked", "x-orphan", 100, { evaluationId: "e1" }),
        shown("x2", { evaluationId: "e-missing" }),
        unanswered("x2", 900, "page_hidden", { evaluationId: "e-missing" }),
      ],
    });
    expect(report.integrity).toMatchObject({
      exposuresMissingTerminal: 1,
      duplicateCardShown: 1,
      responsesWithoutExposure: 1,
      evaluationNotInExport: 1,
    });
    const group = groupOf(report, { concern: "ai_self_report_only" });
    expect(group.counts.missingTerminal).toBe(1);
    // Rates keep exposures as the denominator, so they do not sum to 1 here.
    expect(group.rates.action).toBe(0);

    const markdown = renderMarkdown(report);
    expect(markdown).toContain("Exposures missing a terminal event: 1 — WARNING: expected 0");
  });

  it("counts a shown evaluation that never reached a card_shown", () => {
    const report = run({ "a.jsonl": [sessionMeta("classroom"), evaluation("e1")] });
    expect(report.groups[0].supervisor.shownWithoutExposure).toBe(1);
  });
});

describe("analyze-cards multi-export aggregation", () => {
  it("aggregates on non-identifying keys and never joins across exports", () => {
    // The second export reuses evaluation/exposure ids; they must not join
    // with the first export's rows (fresh salt per export).
    const second = [
      sessionMeta("classroom"),
      shown("x1", { evaluationId: "e1" }),
      unanswered("x1", 2000, "unmounted", { evaluationId: "e1" }),
    ];
    const report = run({ "a.jsonl": classroomExport(), "b.jsonl": second });
    expect(report.inputs).toMatchObject({ files: 2, exports: 2, includedExports: 2 });
    expect(report.integrity.evaluationNotInExport).toBe(1);
    const unjoined = groupOf(report, {
      event: "verify_entered",
      concern: null,
      promptVersionStatus: null,
    });
    expect(unjoined.counts.unanswered).toBe(1);
    expect(groupOf(report, { concern: "ai_self_report_only" }).exposures).toBe(3);
  });

  it("merges the same key across exports", () => {
    const report = run({ "a.jsonl": classroomExport(), "b.jsonl": classroomExport() });
    const verify = groupOf(report, { event: "verify_entered", concern: "ai_self_report_only" });
    expect(verify.exposures).toBe(6);
    expect(verify.supervisor.evaluations).toBe(6);
  });

  it("splits a concatenated file at each session_meta", () => {
    const units = splitExports([...classroomExport(), ...classroomExport()], "cat.jsonl");
    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.origin)).toEqual(["classroom", "classroom"]);
  });

  it("outputs no ids or question text without --exemplars", () => {
    const report = run({ "a.jsonl": classroomExport() });
    const encoded = JSON.stringify(report);
    for (const needle of ["e1", "x1", "id:session", "id:event", "무엇으로 확인했나요", "a.jsonl"]) {
      expect(encoded).not.toContain(needle);
    }
    expect(report.note).toBe(CLAIM_NOTE);
    expect(report.exemplars).toBeUndefined();
  });
});

describe("analyze-cards exemplars", () => {
  it("lists mark-irrelevant and unanswered exposures with their question for human review", () => {
    const report = run({ "a.jsonl": classroomExport() }, { exemplars: true });
    expect(report.exemplars.banner).toBe(EXEMPLAR_BANNER);
    expect(report.exemplars.items).toEqual([
      expect.objectContaining({
        file: "a.jsonl",
        exportIndex: 0,
        evaluationId: "e2",
        exposureId: "x2",
        outcome: "markIrrelevant",
        question: "테스트를 직접 실행해 봤나요?",
      }),
      expect.objectContaining({
        evaluationId: "e3",
        exposureId: "x3",
        outcome: "unanswered",
        unansweredReason: "replaced",
      }),
    ]);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("## Exemplar candidates");
    expect(markdown).toContain("Promotion into eval fixtures is manual");
    expect(markdown).toContain("| a.jsonl | 0 | e2 | x2 | verify_entered | markIrrelevant |");
  });
});

function coachEvaluated(overrides = {}) {
  const payload = {
    eventId: "coach-1",
    status: "shown",
    validationOutcome: "valid",
    reasonCode: "ok",
    evidenceRefs: [],
    model: "anthropic/claude-sonnet-5",
    latencyMs: 900,
    promptVersion: "1.0.0+aa11bb22",
    guideSummary: null,
    ...overrides,
  };
  return eventRecord("verification_coach.evaluated", payload);
}

function prdTurn(overrides = {}) {
  return eventRecord("prd_interview.turn_evaluated", {
    schemaVersion: 1,
    projectId: 1,
    projectSpecId: "prd-1",
    draftId: "draft-1",
    turnId: "prd-turn-1759112345000",
    validationOutcome: "none",
    parseFailureKind: null,
    contractRetryAttempted: false,
    errorClass: null,
    patchProposed: false,
    appliedFieldCount: 0,
    rejectedReasonCount: 0,
    architectureProposalCount: 0,
    provider: "openrouter",
    model: "anthropic/claude-sonnet-5",
    promptVersion: "1.1.0+2cd96df7",
    ...overrides,
  });
}

describe("analyze-cards prompt version states", () => {
  it("never pools a real version, explicit null (no LLM), and legacy (missing/empty)", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        evaluation("v1"),
        shown("x1", { evaluationId: "v1" }),
        responded("action_clicked", "x1", 100, { evaluationId: "v1" }),
        // Deterministic fallback card: shown, but no prompt reached a model.
        evaluation("n1", { promptVersion: null }),
        shown("x2", { evaluationId: "n1" }),
        responded("dismissed", "x2", 100, { evaluationId: "n1" }),
        evaluation("n2", { promptVersion: null, outcome: "none", concern: null }),
        evaluation("l1", { legacyVersions: true }),
        shown("x3", { evaluationId: "l1" }),
        responded("marked_irrelevant", "x3", 100, { evaluationId: "l1" }),
      ],
    });
    const byStatus = (status) =>
      report.groups.filter((group) => group.key.promptVersionStatus === status);
    expect(byStatus("versioned").map((group) => group.counts.action)).toEqual([1]);
    const noLlm = byStatus("no_llm");
    expect(noLlm.map((group) => group.exposures).sort()).toEqual([0, 1]);
    expect(noLlm.find((group) => group.exposures === 1).counts.dismiss).toBe(1);
    expect(byStatus("legacy").map((group) => group.counts.markIrrelevant)).toEqual([1]);
    for (const group of [...byStatus("no_llm"), ...byStatus("legacy")]) {
      expect(group.key.promptVersion).toBeNull();
    }

    const markdown = renderMarkdown(report);
    expect(markdown).toContain("| (no LLM) |");
    expect(markdown).toContain("| (legacy) |");
  });
});

describe("analyze-cards S-076 integrity signals", () => {
  it("counts fallback session attribution and warns on project_latest", () => {
    const resolved = (by) => ({ evaluationId: "e1", extra: { sessionResolvedBy: by } });
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        evaluation("e1"),
        shown("x1", resolved("project_latest")),
        responded("action_clicked", "x1", 100, resolved("exposure")),
        responded("dismissed", "x1", 200, resolved("exposure")),
      ],
    });
    expect(report.integrity.sessionResolvedByExposure).toBe(2);
    expect(report.integrity.sessionResolvedByProjectLatest).toBe(1);
    expect(renderMarkdown(report)).toContain(
      "1 via project latest session — WARNING: project_latest is a best guess",
    );
  });

  it("warns on frontend/Rust policy version mismatches", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        evaluation("e1", { policyVersionRust: "1.1.0" }),
        evaluation("e2"),
      ],
    });
    expect(report.integrity.policyVersionMismatch).toBe(1);
    expect(report.policyVersionMismatches).toEqual({ "frontend 1.0.0 / rust 1.1.0": 1 });
    expect(renderMarkdown(report)).toContain(
      "policy version mismatch: 1 — WARNING: stale frontend bundle (frontend 1.0.0 / rust 1.1.0: 1)",
    );
  });

  it("distinguishes removed/replaced and flags the legacy superseded reason", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        evaluation("e1"),
        shown("x1", { evaluationId: "e1" }),
        unanswered("x1", 1000, "removed", { evaluationId: "e1" }),
        // A same-id card whose question changed closes as `replaced` and
        // opens a new exposure.
        shown("x2", { evaluationId: "e1", question: "첫 질문" }),
        unanswered("x2", 3000, "replaced", { evaluationId: "e1" }),
        shown("x3", { evaluationId: "e1", question: "바뀐 질문" }),
        unanswered("x3", 5000, "superseded", { evaluationId: "e1" }),
      ],
    });
    const group = groupOf(report, { concern: "ai_self_report_only" });
    expect(group.exposures).toBe(3);
    expect(group.unansweredReasons).toEqual({ removed: 1, replaced: 1, superseded: 1 });
    expect(group.medianUnansweredVisibleMs).toBe(3000);
    expect(report.integrity.legacyUnansweredSuperseded).toBe(1);
    expect(renderMarkdown(report)).toContain("removed: 1, replaced: 1, superseded: 1");
  });
});

describe("analyze-cards coach and PRD interview tables", () => {
  it("tallies verification coach status and reason codes per prompt version", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        coachEvaluated(),
        coachEvaluated({
          status: "dropped",
          validationOutcome: "dropped",
          reasonCode: "generic_guidance",
        }),
        coachEvaluated({
          status: "unavailable",
          reasonCode: "runtime_unavailable",
          promptVersion: null,
          model: null,
        }),
      ],
    });
    expect(report.totals.coachEvaluations).toBe(3);
    const [versioned, noLlm] = report.verificationCoach;
    expect(versioned).toMatchObject({
      key: { promptVersion: "1.0.0+aa11bb22", promptVersionStatus: "versioned" },
      count: 2,
      status: { shown: 1, dropped: 1 },
      reasonCode: { ok: 1, generic_guidance: 1 },
    });
    expect(noLlm).toMatchObject({
      key: { promptVersion: null, promptVersionStatus: "no_llm", model: null },
      status: { unavailable: 1 },
    });
    expect(renderMarkdown(report)).toContain(
      "| (no LLM) | — | 1 | unavailable: 1 | runtime_unavailable: 1 |",
    );
  });

  it("tallies PRD interview outcomes including model_error per prompt version", () => {
    const report = run({
      "a.jsonl": [
        sessionMeta("classroom"),
        prdTurn(),
        prdTurn({
          validationOutcome: "applied",
          patchProposed: true,
          contractRetryAttempted: true,
        }),
        prdTurn({ validationOutcome: "model_error", errorClass: "stream_error" }),
        prdTurn({ validationOutcome: "model_error", errorClass: "request_failed" }),
        prdTurn({ promptVersion: "1.0.0+79eaddb8" }),
      ],
    });
    expect(report.totals.prdTurns).toBe(5);
    const current = report.prdInterviewTurns.find(
      (row) => row.key.promptVersion === "1.1.0+2cd96df7",
    );
    expect(current).toMatchObject({
      count: 4,
      validationOutcome: { none: 1, applied: 1, model_error: 2 },
      errorClass: { stream_error: 1, request_failed: 1 },
      contractRetries: 1,
      patchesProposed: 1,
    });
    expect(report.prdInterviewTurns).toHaveLength(2);
    expect(renderMarkdown(report)).toContain("model_error: 2, applied: 1, none: 1");
  });

  it("applies the origin filter to coach and PRD rows too", () => {
    const report = run({ "q.jsonl": [sessionMeta("qa"), coachEvaluated(), prdTurn()] });
    expect(report.verificationCoach).toEqual([]);
    expect(report.prdInterviewTurns).toEqual([]);
  });
});

describe("analyze-cards CLI", () => {
  const tempDirs = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function writeExport(records) {
    const dir = mkdtempSync(join(tmpdir(), "analyze-cards-"));
    tempDirs.push(dir);
    const file = join(dir, "export.jsonl");
    writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    return file;
  }

  function runCli(...args) {
    return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  }

  it("prints a Markdown report with the claim-discipline note by default", () => {
    const result = runCli(writeExport(classroomExport()));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Review-card field aggregates");
    expect(result.stdout).toContain(CLAIM_NOTE);
    expect(result.stdout).toContain("| verify_entered | ai_self_report_only | work |");
  });

  it("prints JSON with --json (after pnpm's forwarded --)", () => {
    const result = runCli("--", writeExport(classroomExport()), "--json", "--exemplars");
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.totals.exposures).toBe(4);
    expect(report.exemplars.items).toHaveLength(2);
    expect(result.stderr).toContain("Promotion into eval fixtures is manual");
  });

  it("exits 2 without input and 1 on invalid JSONL", () => {
    expect(runCli().status).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), "analyze-cards-"));
    tempDirs.push(dir);
    const file = join(dir, "bad.jsonl");
    writeFileSync(file, '{"kind":"session_meta"}\nnot json\n');
    const result = runCli(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bad.jsonl:2: invalid JSONL");
    expect(() => readJsonl(file)).toThrow(/bad\.jsonl:2/);
  });
});
