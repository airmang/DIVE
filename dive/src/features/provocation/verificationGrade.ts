import type { VerificationStatusId } from "./types";

/**
 * Evidence strong enough to call a result "verified" — i.e. enough to approve
 * without first writing a risk reason.
 *
 * Design rule (Sarkar, criterion-linked verification): "the app booted" or
 * "I glanced at the preview" does NOT demonstrate the acceptance criterion was
 * met. app_launched / preview_checked count only when the student has actively
 * confirmed they observed the acceptance criterion. Automated test pass always
 * counts. ai_self_report_only and diff_reviewed never count.
 */
export const ALWAYS_CONCRETE_IDS: ReadonlySet<VerificationStatusId> = new Set([
  "automated_tests_passed",
]);

export interface VerificationGradeInput {
  statusIds: Iterable<VerificationStatusId>;
  testResult?: "pass" | "fail" | "skipped" | null;
  /** app_launched || preview_checked || a manual check was recorded */
  manualOrPreviewObserved?: boolean;
  /** student explicitly confirmed they saw the acceptance criterion hold */
  acceptanceCriterionConfirmed?: boolean;
}

export function hasConcreteVerification(input: VerificationGradeInput): boolean {
  if (input.testResult === "fail") return false;
  const ids = new Set(input.statusIds);
  if (input.testResult === "pass") return true;
  for (const id of ALWAYS_CONCRETE_IDS) {
    if (ids.has(id)) return true;
  }
  return Boolean(input.manualOrPreviewObserved && input.acceptanceCriterionConfirmed);
}
