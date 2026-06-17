import { describe, expect, it } from "vitest";
import { hasConcreteVerification } from "./verificationGrade";

describe("hasConcreteVerification", () => {
  it("automated test pass always counts", () => {
    expect(hasConcreteVerification({ statusIds: [], testResult: "pass" })).toBe(true);
    expect(hasConcreteVerification({ statusIds: ["automated_tests_passed"] })).toBe(true);
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
