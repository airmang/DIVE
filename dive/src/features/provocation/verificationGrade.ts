import type { VerificationStatusId } from "./types";

/**
 * Evidence strong enough to call a result "verified" — i.e. enough to approve
 * without first writing a risk reason.
 *
 * Design rule (Sarkar, criterion-linked verification): "the app booted" or
 * "I glanced at the preview" does NOT demonstrate the acceptance criterion was
 * met. app_launched / preview_checked count only when the student has actively
 * confirmed they observed the acceptance criterion. Automated test pass counts
 * only when a test command actually ran and produced an exit code.
 * ai_self_report_only and diff_reviewed never count.
 */
export const ALWAYS_CONCRETE_IDS: ReadonlySet<VerificationStatusId> = new Set([
  "manual_observation",
]);

export type VerificationEvidenceStrength = "concrete" | "weak_signal" | "none";

export interface VerificationGradeInput {
  statusIds: Iterable<VerificationStatusId>;
  testResult?: "pass" | "fail" | "skipped" | null;
  testCommand?: string | null;
  testExitCode?: number | null;
  /** app_launched || preview_checked || a manual check was recorded */
  manualOrPreviewObserved?: boolean;
  /** student explicitly confirmed they saw the acceptance criterion hold */
  acceptanceCriterionConfirmed?: boolean;
  /** criterion-linked student-authored observations */
  manualObservationCount?: number;
}

export function hasExecutedTestCommand(
  input: Pick<VerificationGradeInput, "testCommand" | "testExitCode">,
): boolean {
  return Boolean(
    typeof input.testCommand === "string" &&
    input.testCommand.trim().length > 0 &&
    input.testExitCode !== null &&
    input.testExitCode !== undefined,
  );
}

export function automatedTestEvidenceStrength(
  input: Pick<VerificationGradeInput, "testResult" | "testCommand" | "testExitCode">,
): VerificationEvidenceStrength {
  if (input.testResult !== "pass" && input.testResult !== "fail") return "none";
  return hasExecutedTestCommand(input) ? "concrete" : "weak_signal";
}

export function hasConcreteAutomatedPass(
  input: Pick<VerificationGradeInput, "testResult" | "testCommand" | "testExitCode">,
): boolean {
  return input.testResult === "pass" && hasExecutedTestCommand(input);
}

export function hasConcreteAutomatedFail(
  input: Pick<VerificationGradeInput, "testResult" | "testCommand" | "testExitCode">,
): boolean {
  return input.testResult === "fail" && hasExecutedTestCommand(input);
}

export function hasConcreteVerification(input: VerificationGradeInput): boolean {
  if (input.testResult === "fail") return false;
  const ids = new Set(input.statusIds);
  if (hasConcreteAutomatedPass(input)) return true;
  for (const id of ALWAYS_CONCRETE_IDS) {
    if (ids.has(id)) return true;
  }
  if ((input.manualObservationCount ?? 0) > 0 && input.acceptanceCriterionConfirmed) return true;
  return Boolean(input.manualOrPreviewObserved && input.acceptanceCriterionConfirmed);
}
