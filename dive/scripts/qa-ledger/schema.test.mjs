import { describe, expect, it } from "vitest";
import { validateDefect, validateRunRecord, validateScenario } from "./schema.mjs";

const SHA = "a".repeat(64);

function defect(overrides = {}) {
  return {
    id: "DEF-0001",
    title: "Card question renders in Korean under locale=en",
    status: "open",
    severity: "P1",
    area: "supervision",
    source: { kind: "review", ref: "docs/qa/post-cleanup-review-2026-07-22.md", findingId: "S3" },
    created: "2026-09-29",
    updated: "2026-09-29",
    ...overrides,
  };
}

const GUARD = { kind: "vitest", ref: "dive/src/features/provocation/rules.test.ts::locale > en" };
const VERIFIED = {
  commit: "f371910c",
  buildVersion: "1.0.0-rc.10",
  date: "2026-09-29",
  runId: "2026-09-29-rc10-smoke",
  evidence: [{ path: "docs/qa/ledger/evidence/run.png", sha256: SHA }],
};

function scenario(overrides = {}) {
  return {
    id: "ONB-01",
    title: "First launch on clean data shows onboarding",
    source: { kind: "scenario-catalog", ref: "docs/archive/qa/scenario-catalog.md#ONB-01" },
    areas: ["onboarding"],
    pathGlobs: [],
    priority: "P0",
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    id: "2026-09-29-rc10-smoke",
    date: "2026-09-29",
    startedAt: "2026-09-29T10:00:00Z",
    build: { version: "1.0.0-rc.10", commit: "f371910c", dirty: false },
    platform: "macos-arm64",
    scenarios: [{ id: "ONB-01", result: "pass" }],
    defectsOpened: [],
    defectsVerified: [],
    evidence: [],
    ...overrides,
  };
}

describe("validateDefect", () => {
  it("accepts a minimal open defect", () => {
    expect(validateDefect(defect())).toEqual([]);
  });

  it("accepts a verified defect with guard and verified block", () => {
    expect(
      validateDefect(defect({ status: "verified", guard: GUARD, verified: VERIFIED })),
    ).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateDefect([])).toEqual(["$: must be an object (got array)"]);
  });

  it("reports missing required and unknown fields by path", () => {
    const { title: _title, ...rest } = defect();
    const errors = validateDefect({ ...rest, colour: "red" });
    expect(errors).toContain("$.title: is required");
    expect(errors).toContain("$.colour: is not a known field");
  });

  it("checks id format, enums and area names", () => {
    const errors = validateDefect(
      defect({ id: "DEF-1", status: "closed", severity: "P3", area: "nowhere" }),
    );
    expect(errors.some((e) => e.startsWith("$.id: must be DEF-NNNN"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.status: must be one of"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.severity: must be one of"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.area: must be one of"))).toBe(true);
  });

  it("checks source kind", () => {
    const errors = validateDefect(defect({ source: { kind: "rumour", ref: "x" } }));
    expect(errors.some((e) => e.startsWith("$.source.kind: must be one of"))).toBe(true);
  });

  it.each(["fixed", "verified"])("requires a guard when status is %s", (status) => {
    const errors = validateDefect(defect({ status, verified: VERIFIED }));
    expect(errors).toContain(`$.guard: is required when status is "${status}" (FR-040)`);
  });

  it("requires the verified block when status is verified", () => {
    expect(validateDefect(defect({ status: "verified", guard: GUARD }))).toEqual([
      '$.verified: is required when status is "verified"',
    ]);
  });

  it("rejects a verified block on a non-verified defect", () => {
    const errors = validateDefect(defect({ status: "fixed", guard: GUARD, verified: VERIFIED }));
    expect(errors).toEqual([
      '$.verified: is only allowed when status is "verified" (status is "fixed")',
    ]);
  });

  it("requires notes when status is wontfix", () => {
    expect(validateDefect(defect({ status: "wontfix" }))).toEqual([
      '$.notes: is required when status is "wontfix" (record why)',
    ]);
    expect(validateDefect(defect({ status: "wontfix", notes: "Out of scope for v1." }))).toEqual(
      [],
    );
  });

  it("requires duplicateOf iff status is duplicate", () => {
    expect(validateDefect(defect({ status: "duplicate" }))).toEqual([
      '$.duplicateOf: is required when status is "duplicate"',
    ]);
    expect(validateDefect(defect({ status: "duplicate", duplicateOf: "DEF-0002" }))).toEqual([]);
    expect(validateDefect(defect({ duplicateOf: "DEF-0002" }))).toEqual([
      '$.duplicateOf: is only allowed when status is "duplicate" (status is "open")',
    ]);
    expect(validateDefect(defect({ status: "duplicate", duplicateOf: "DEF-0001" }))).toContain(
      "$.duplicateOf: must not point at itself",
    );
  });

  it("checks guard ref shape per kind", () => {
    const bad = (guard) => validateDefect(defect({ status: "fixed", guard }));
    expect(bad({ kind: "vitest", ref: "rules.test.ts" })[0]).toMatch(/^\$\.guard\.ref: must be/);
    expect(bad({ kind: "cargo", ref: "has spaces in it" })[0]).toMatch(/^\$\.guard\.ref: must be/);
    expect(bad({ kind: "live-scenario", ref: "onb-1" })[0]).toMatch(/^\$\.guard\.ref: must be/);
    expect(bad({ kind: "manual", ref: "x" })[0]).toMatch(/^\$\.guard\.kind: must be one of/);
    expect(bad({ kind: "cargo", ref: "dive::supervisor::tests::rejects_static_fallback" })).toEqual(
      [],
    );
    expect(bad({ kind: "live-scenario", ref: "SUP-01" })).toEqual([]);
    expect(bad({ kind: "eval-fixture", ref: "verify-claim-done-ko-work" })).toEqual([]);
  });

  it("requires verified.runId to be a run id", () => {
    const { runId: _r, ...noRun } = VERIFIED;
    expect(validateDefect(defect({ status: "verified", guard: GUARD, verified: noRun }))).toEqual([
      "$.verified.runId: is required",
    ]);
    const bad = { ...VERIFIED, runId: "yesterday" };
    expect(validateDefect(defect({ status: "verified", guard: GUARD, verified: bad }))[0]).toMatch(
      /^\$\.verified\.runId: must be a run id/,
    );
  });

  it("checks the verified block fields", () => {
    const errors = validateDefect(
      defect({
        status: "verified",
        guard: GUARD,
        verified: {
          commit: "HEAD",
          buildVersion: "",
          date: "2026-13-01",
          evidence: [{ path: "/abs/shot.png", sha256: "abc" }],
        },
      }),
    );
    expect(errors.some((e) => e.startsWith("$.verified.commit:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.verified.buildVersion:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.verified.date:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.verified.evidence[0].path:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.verified.evidence[0].sha256:"))).toBe(true);
  });

  it("checks dates and their order", () => {
    expect(validateDefect(defect({ created: "29/09/2026" }))[0]).toMatch(/^\$\.created: must be/);
    expect(validateDefect(defect({ created: "2026-09-30", updated: "2026-09-29" }))).toEqual([
      "$.updated: must not be earlier than $.created",
    ]);
    expect(validateDefect(defect({ updated: "2026-09-29T10:15:00Z" }))).toEqual([]);
  });

  it.each([
    "2026-02-30",
    "2026-04-31",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-09-29T24:00Z",
    "2026-09-29T23:60Z",
    "2026-09-29T23:59:60Z",
    "2026-09-29T10:00+24:00",
  ])("rejects the impossible date/time %s instead of rolling it over", (updated) => {
    expect(validateDefect(defect({ updated }))).toEqual([
      `$.updated: is not a real calendar date/time (got "${updated}")`,
    ]);
  });

  it.each(["2028-02-29", "2026-12-31T23:59:59.999Z", "2026-09-29T09:00+09:00"])(
    "accepts the real date/time %s",
    (updated) => {
      expect(validateDefect(defect({ updated }))).toEqual([]);
    },
  );
});

describe("validateScenario", () => {
  it("accepts a minimal scenario", () => {
    expect(validateScenario(scenario())).toEqual([]);
  });

  it("accepts every optional field", () => {
    const full = scenario({
      requiresLlm: false,
      preconditions: "App data backed up",
      steps: ["Launch DIVE"],
      expected: "Onboarding renders",
      tags: ["visibility"],
      notes: "Back up dive.db first.",
      pathGlobs: ["dive/src/components/onboarding/OnboardingDialog.tsx"],
      lastPass: { runId: "2026-09-29-rc10-smoke", date: "2026-09-29" },
    });
    expect(validateScenario(full)).toEqual([]);
  });

  it("rejects unknown or duplicate areas and empty area lists", () => {
    expect(validateScenario(scenario({ areas: [] }))).toEqual(["$.areas: must not be empty"]);
    const errors = validateScenario(scenario({ areas: ["onboarding", "onboarding", "nope"] }));
    expect(errors).toContain('$.areas[1]: duplicate entry "onboarding"');
    expect(errors.some((e) => e.startsWith("$.areas[2]: must be one of"))).toBe(true);
  });

  it("rejects absolute or escaping path globs", () => {
    const errors = validateScenario(scenario({ pathGlobs: ["/etc/**", "../x/**"] }));
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^\$\.pathGlobs\[0\]: must be a repo-relative/);
  });

  it("checks id, priority, source kind, steps and lastPass", () => {
    const errors = validateScenario(
      scenario({
        id: "onb-01",
        priority: "high",
        source: { kind: "wiki", ref: "x" },
        steps: [],
        lastPass: { runId: "yesterday", date: "2026-09-29" },
      }),
    );
    expect(errors.some((e) => e.startsWith("$.id: must be AREA-NN"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.priority: must be one of"))).toBe(true);
    expect(errors.some((e) => e.startsWith("$.source.kind: must be one of"))).toBe(true);
    expect(errors).toContain("$.steps: must not be empty");
    expect(errors.some((e) => e.startsWith("$.lastPass.runId: must be a run id"))).toBe(true);
  });
});

describe("validateRunRecord", () => {
  it("accepts a well-formed run", () => {
    expect(validateRunRecord(run())).toEqual([]);
    expect(
      validateRunRecord(
        run({
          defectsOpened: ["DEF-0003"],
          defectsVerified: ["DEF-0001"],
          evidence: [{ path: "docs/qa/ledger/runs/shot.png", sha256: SHA }],
          notes: "Release .app + computer-use.",
        }),
      ),
    ).toEqual([]);
  });

  it("requires a full startedAt timestamp and a boolean build.dirty", () => {
    expect(validateRunRecord(run({ startedAt: "2026-09-29" }))).toEqual([
      '$.startedAt: must be a full ISO 8601 timestamp (got "2026-09-29")',
    ]);
    const { startedAt: _s, ...noStart } = run();
    expect(validateRunRecord(noStart)).toEqual(["$.startedAt: is required"]);
    expect(
      validateRunRecord(run({ build: { version: "1", commit: "f371910c", dirty: "no" } })),
    ).toEqual(["$.build.dirty: must be a boolean (got string)"]);
  });

  it("requires the id date prefix to match the run date", () => {
    expect(validateRunRecord(run({ date: "2026-09-30" }))).toEqual([
      "$.id: date prefix must match $.date (2026-09-30)",
    ]);
  });

  it("checks scenario results and duplicate scenario ids", () => {
    const errors = validateRunRecord(
      run({
        scenarios: [
          { id: "ONB-01", result: "pass" },
          { id: "ONB-01", result: "flaky" },
        ],
      }),
    );
    expect(errors.some((e) => e.startsWith("$.scenarios[1].result: must be one of"))).toBe(true);
    expect(errors).toContain('$.scenarios[].id[1]: duplicate entry "ONB-01"');
    expect(validateRunRecord(run({ scenarios: [] }))).toEqual(["$.scenarios: must not be empty"]);
  });

  it("checks build, defect id lists and evidence", () => {
    const errors = validateRunRecord(
      run({
        build: { version: "1.0.0-rc.10" },
        defectsOpened: ["BUG-1"],
        evidence: [{ path: "shot.png" }],
      }),
    );
    expect(errors).toContain("$.build.commit: is required");
    expect(errors.some((e) => e.startsWith("$.defectsOpened[0]: must be DEF-NNNN"))).toBe(true);
    expect(errors).toContain("$.evidence[0].sha256: is required");
  });
});
