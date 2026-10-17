import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
// `fs` is typed by the local ambient shim src/styles/fs-node-shim.d.ts.
import policyJson from "./supervision-policy.json";
import { SUPERVISION_POLICY } from "./policy";
import { buildPlanDraftReviewAssessment, buildRetryLoopReviewAssessment } from "./adapters";

const RUST_POLICY_MODULE = "src-tauri/src/dive/supervision_policy.rs";

function resolveRelative(fromFile: string, relative: string): string {
  const segments = fromFile.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "..") segments.pop();
    else if (part !== ".") segments.push(part);
  }
  return segments.join("/");
}

describe("supervision policy (spec 015 FR-002)", () => {
  it("is the same file the Rust provoke gate embeds", () => {
    const rustSource = readFileSync(RUST_POLICY_MODULE, "utf8");
    const includePath = rustSource.match(/include_str!\(\s*"([^"]+)"\s*\)/)?.[1];
    expect(includePath).toBeTruthy();
    const resolved = resolveRelative(RUST_POLICY_MODULE, includePath!);
    expect(resolved).toBe("src/features/provocation/supervision-policy.json");
    expect(JSON.parse(readFileSync(resolved, "utf8"))).toEqual(policyJson);
  });

  it("pins the released policy values", () => {
    // Changing a threshold is a new policy release: bump policyVersion and
    // update this pin and the Rust pin (supervision_policy.rs) together.
    expect(policyJson).toEqual({
      policyVersion: "1.0.0",
      retryLoopMinFailures: 2,
      broadStepMinExpectedFiles: 4,
      scopeSupervisorDebounceMs: 650,
      evidenceTextMaxChars: 160,
      evidenceListMaxItems: 6,
      planDraftEvidenceRefCap: 16,
      recentAssistantReportCount: 3,
    });
  });

  it("types every key the file defines (the Rust struct denies unknown keys)", () => {
    expect(Object.keys(policyJson).sort()).toEqual(
      [
        "policyVersion",
        "retryLoopMinFailures",
        "broadStepMinExpectedFiles",
        "scopeSupervisorDebounceMs",
        "evidenceTextMaxChars",
        "evidenceListMaxItems",
        "planDraftEvidenceRefCap",
        "recentAssistantReportCount",
      ].sort(),
    );
    expect(SUPERVISION_POLICY.policyVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("drives the retry-loop and broad-step thresholds", () => {
    const retry = (failureCount: number) =>
      buildRetryLoopReviewAssessment({
        failureFingerprint: "typeerror_at_save",
        failureCount,
        lastFailureAt: 1,
        recoveryAvailable: true,
      }).eligible;
    expect(retry(SUPERVISION_POLICY.retryLoopMinFailures)).toBe(true);
    expect(retry(SUPERVISION_POLICY.retryLoopMinFailures - 1)).toBe(false);

    const files = (count: number) => Array.from({ length: count }, (_, i) => `src/f${i}.ts`);
    const broad = (count: number) =>
      buildPlanDraftReviewAssessment({
        planSteps: [
          {
            id: "s1",
            text: "로그인 폼",
            expectedFiles: files(count),
            verificationCommand: "pnpm test",
            linkedCriterionIds: ["AC-1"],
          },
        ],
        acceptanceCriteria: ["로그인된다"],
      }).reasonCodes;
    expect(broad(SUPERVISION_POLICY.broadStepMinExpectedFiles)).toEqual(["broad_step"]);
    expect(broad(SUPERVISION_POLICY.broadStepMinExpectedFiles - 1)).toEqual([]);
  });
});
