import { describe, expect, it } from "vitest";
import {
  automatedTestEvidenceStrength,
  hasConcreteAutomatedFail,
  hasConcreteAutomatedPass,
  hasConcreteVerification,
  hasExecutedTestCommand,
} from "./verificationGrade";

describe("hasConcreteVerification", () => {
  it("automated test pass counts only when a test command actually ran", () => {
    // AI self-reported pass with no executed command is a weak signal, not concrete.
    expect(hasConcreteVerification({ statusIds: [], testResult: "pass" })).toBe(false);
    expect(hasConcreteVerification({ statusIds: ["automated_tests_passed"] })).toBe(false);
    // A pass backed by an executed command (exit code present) is concrete.
    expect(
      hasConcreteVerification({
        statusIds: [],
        testResult: "pass",
        testCommand: "npm test",
        testExitCode: 0,
      }),
    ).toBe(true);
  });

  it("app launched or preview alone does NOT count", () => {
    expect(hasConcreteVerification({ statusIds: ["app_launched", "preview_checked"] })).toBe(false);
  });

  it("preview/app counts only when the acceptance criterion is confirmed observed", () => {
    expect(
      hasConcreteVerification({
        statusIds: ["preview_checked"],
        manualOrPreviewObserved: true,
        acceptanceCriterionConfirmed: true,
      }),
    ).toBe(true);
  });

  it("ai self-report and diff-viewed never count", () => {
    expect(hasConcreteVerification({ statusIds: ["ai_self_report_only"] })).toBe(false);
    expect(hasConcreteVerification({ statusIds: ["diff_reviewed"] })).toBe(false);
  });

  it("failed test never counts even if confirmed", () => {
    expect(
      hasConcreteVerification({
        statusIds: ["preview_checked"],
        testResult: "fail",
        manualOrPreviewObserved: true,
        acceptanceCriterionConfirmed: true,
      }),
    ).toBe(false);
  });

  it("criterion-linked manual observation counts as concrete evidence", () => {
    expect(
      hasConcreteVerification({
        statusIds: ["manual_observation"],
        manualObservationCount: 1,
        acceptanceCriterionConfirmed: true,
      }),
    ).toBe(true);
  });

  it("manual observation without criterion confirmation does not count", () => {
    expect(
      hasConcreteVerification({
        statusIds: [],
        manualObservationCount: 1,
        acceptanceCriterionConfirmed: false,
      }),
    ).toBe(false);
  });
});

describe("automated test evidence strength (P0 evidence boundary)", () => {
  it("treats pass/fail without an executed command as a weak signal", () => {
    expect(automatedTestEvidenceStrength({ testResult: "pass" })).toBe("weak_signal");
    expect(automatedTestEvidenceStrength({ testResult: "fail" })).toBe("weak_signal");
  });

  it("treats command-backed pass/fail as concrete", () => {
    expect(
      automatedTestEvidenceStrength({
        testResult: "pass",
        testCommand: "npm test",
        testExitCode: 0,
      }),
    ).toBe("concrete");
    expect(
      automatedTestEvidenceStrength({
        testResult: "fail",
        testCommand: "npm test",
        testExitCode: 1,
      }),
    ).toBe("concrete");
  });

  it("treats skipped or absent results as no evidence", () => {
    expect(automatedTestEvidenceStrength({ testResult: "skipped" })).toBe("none");
    expect(automatedTestEvidenceStrength({ testResult: null })).toBe("none");
  });

  it("hasExecutedTestCommand requires both command text and an exit code", () => {
    expect(hasExecutedTestCommand({ testCommand: "npm test", testExitCode: 0 })).toBe(true);
    expect(hasExecutedTestCommand({ testCommand: "npm test", testExitCode: null })).toBe(false);
    expect(hasExecutedTestCommand({ testCommand: "   ", testExitCode: 0 })).toBe(false);
    expect(hasExecutedTestCommand({ testCommand: null, testExitCode: 0 })).toBe(false);
  });

  it("concrete pass/fail helpers require an executed command", () => {
    expect(hasConcreteAutomatedPass({ testResult: "pass" })).toBe(false);
    expect(
      hasConcreteAutomatedPass({ testResult: "pass", testCommand: "npm test", testExitCode: 0 }),
    ).toBe(true);
    expect(hasConcreteAutomatedFail({ testResult: "fail" })).toBe(false);
    expect(
      hasConcreteAutomatedFail({ testResult: "fail", testCommand: "npm test", testExitCode: 1 }),
    ).toBe(true);
  });
});
